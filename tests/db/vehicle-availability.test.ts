import { randomUUID } from "node:crypto";

import { eq } from "drizzle-orm";
import postgres, { type TransactionSql } from "postgres";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { transitionVehicleToAvailable } from "@/db/queries/mark-vehicle-available";
import { getStockList } from "@/db/queries/vehicles";
import { vehicles } from "@/db/schema";
import { withTenant, type TenantContext } from "@/db/tenant";
import { countByStatus, groupByStatus } from "@/domains/vehicles/stock";
import { ACTIVE_ORGANIZATION_COOKIE } from "@/lib/tenant/cookie";
import { markVehicleAvailable } from "@/lib/vehicles/actions";
import type { MarkVehicleAvailableState } from "@/lib/vehicles/availability";

import { cookieJar, type CookieJar } from "../unit/support/cookie-jar";
import { policies } from "./support/catalog";
import {
  runMigrations,
  startTestServer,
  type TestDatabase,
  type TestServer,
} from "./support/postgres";
import { closeRuntimePool, runtimePool } from "./support/runtime";
import {
  ORG_1,
  ORG_2,
  ORG_3,
  seedTenants,
  tenantContext,
  USER_A,
  USER_B,
  USER_C,
  USER_D,
  USER_E,
} from "./support/tenants";
import { seedVehicles } from "./support/vehicles";

/*
 * Disponibilidad de unidades (H1.3C) de punta a punta contra PostgreSQL 17
 * con las migraciones aplicadas:
 *
 *   Server Action → requireTenant() → validación del id → withTenant() →
 *   UPDATE … AND status = 'in_preparation' → RLS (USING / WITH CHECK) →
 *   la unidad pasa a Disponibles en la Stock List real
 *
 * La acción, la escritura y el loader son los reales, conectados como
 * app_runtime. Supabase Auth (claims ya verificados), la cookie, redirect()
 * y revalidatePath() de Next son simulados, como en create-vehicle.test.ts.
 *
 * Tenants (support/tenants.ts): A: admin de ORG_1 · B: admin de ORG_2 · C:
 * seller de ORG_1 y admin de ORG_3, seller inactivo de ORG_2 · D: solo
 * inactiva en ORG_1 · E: sin memberships.
 *
 * Cada caso usa sus propias unidades (insertadas con el superusuario, en el
 * estado que necesita) para no depender del orden de los demás.
 */

vi.mock("server-only", () => ({}));

const mocks = vi.hoisted(() => {
  class RedirectSignal extends Error {
    constructor(readonly path: string) {
      super(`redirect(${path})`);
    }
  }
  return {
    RedirectSignal,
    claims: null as Record<string, unknown> | null,
    jar: null as CookieJar | null,
    /** Simula una Tenant Resolution salteada o con un bug (A-03). */
    forged: null as unknown,
    revalidated: [] as string[],
    redirect: (path: string): never => {
      throw new RedirectSignal(path);
    },
  };
});

vi.mock("@/lib/supabase/server", () => ({
  createAuthClient: async () => ({
    getClaims: async () =>
      mocks.claims
        ? { data: { claims: mocks.claims }, error: null }
        : { data: null, error: null },
  }),
}));
vi.mock("next/headers", () => ({
  cookies: async () => {
    if (!mocks.jar) throw new Error("no cookie jar");
    return mocks.jar.store;
  },
}));
vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));
vi.mock("next/cache", () => ({
  revalidatePath: (path: string) => {
    mocks.revalidated.push(path);
  },
}));
// requireTenant() es el real salvo cuando un test fuerza un contexto.
vi.mock("@/lib/tenant/session", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/tenant/session")>();
  return {
    ...actual,
    requireTenant: async () =>
      (mocks.forged as TenantContext | null) ?? actual.requireTenant(),
  };
});

let server: TestServer;
let db: TestDatabase;

beforeAll(async () => {
  server = await startTestServer();
  db = await server.createDatabase();
  await runMigrations(db.migrationUrl);
  await seedTenants(db.admin);
  await seedVehicles(db.admin);
  vi.stubEnv("RUNTIME_DATABASE_URL", await db.runtimeUrl());
});

afterAll(async () => {
  await closeRuntimePool();
  vi.unstubAllEnvs();
  await server?.close();
});

/** Nueva request: usuario autenticado (o ninguno) y cookie de organización. */
function request(userId: string | null, cookie?: string): void {
  mocks.forged = null;
  mocks.revalidated.length = 0;
  mocks.claims = userId
    ? {
        iss: "https://testref.supabase.co/auth/v1",
        sub: userId,
        aud: "authenticated",
        exp: 1_900_000_000,
        iat: 1_899_996_400,
        role: "authenticated",
        aal: "aal1",
        session_id: "00000000-0000-4000-8000-0000000000e1",
      }
    : null;
  mocks.jar = cookieJar(
    cookie === undefined ? {} : { [ACTIVE_ORGANIZATION_COOKIE]: cookie },
  );
}

type Status = "in_preparation" | "available" | "reserved" | "sold";

let sequence = 0;

/**
 * Una unidad propia del caso, en `status`, ingresada (y actualizada por
 * última vez) hace un día: así se ve si la transición toca `updated_at`.
 */
async function unit(
  organizationId: string,
  status: Status = "in_preparation",
): Promise<string> {
  sequence += 1;
  const id = randomUUID();
  await db.admin`
    INSERT INTO public.vehicles (id, organization_id, brand, model, version,
      year, km, price, currency, status, created_at, updated_at)
    VALUES (${id}, ${organizationId}, 'Toyota', 'Hilux',
      ${`Prueba H1.3C ${sequence}`}, 2021, 142000, 31500, 'USD', ${status},
      now() - interval '1 day', now() - interval '1 day')
  `;
  return id;
}

type VehicleRow = {
  organizationId: string;
  brand: string;
  model: string;
  version: string | null;
  year: number;
  km: number | null;
  price: string | null;
  currency: string | null;
  status: Status;
  createdAt: Date;
  updatedAt: Date;
};

/** La fila tal como está en la base (sin RLS). */
async function row(id: string): Promise<VehicleRow | undefined> {
  const [found] = await db.admin<VehicleRow[]>`
    SELECT organization_id AS "organizationId", brand, model, version, year,
      km, price::text AS price, currency, status,
      created_at AS "createdAt", updated_at AS "updatedAt"
    FROM public.vehicles WHERE id = ${id}
  `;
  return found;
}

async function statusOf(id: string): Promise<Status | undefined> {
  return (await row(id))?.status;
}

function form(fields: Record<string, string>): FormData {
  const data = new FormData();
  for (const [name, value] of Object.entries(fields)) data.append(name, value);
  return data;
}

async function mark(
  vehicleId: string,
  extra: Record<string, string> = {},
): Promise<MarkVehicleAvailableState> {
  return markVehicleAvailable(null, form({ vehicleId, ...extra }));
}

async function redirectOf(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof mocks.RedirectSignal) return error.path;
    throw error;
  }
  throw new Error("expected a redirect");
}

async function expectSqlError(
  promise: Promise<unknown>,
  code: string,
): Promise<void> {
  // Drizzle envuelve el error del driver: el SQLSTATE queda en `cause`.
  await expect(promise).rejects.toMatchObject({ cause: { code } });
}

/** UPDATE directo por el boundary, solo por id (sin filtro de organización). */
function directUpdate(
  ctx: TenantContext,
  id: string,
  set: Partial<typeof vehicles.$inferInsert>,
) {
  return withTenant(ctx, (tx) =>
    tx
      .update(vehicles)
      .set(set)
      .where(eq(vehicles.id, id))
      .returning({ id: vehicles.id, status: vehicles.status }),
  );
}

const HILUX = { brand: "Toyota", model: "Hilux", year: 2021 } as const;

describe("Server Action: requireTenant() → validación → withTenant() → UPDATE", () => {
  it("admin (A) marca disponible una unidad en preparación de su organización y revalida /stock", async () => {
    const id = await unit(ORG_1);
    const before = await row(id);
    request(USER_A);

    expect(await mark(id)).toEqual({
      status: "available",
      vehicleId: id,
      ...HILUX,
    });
    expect(mocks.revalidated).toEqual(["/stock"]);

    const after = await row(id);
    expect(after).toEqual({
      ...before,
      status: "available",
      updatedAt: expect.any(Date),
    });
    // Solo cambian el estado y su updated_at; created_at queda intacto.
    expect(after!.updatedAt.getTime()).toBeGreaterThan(
      before!.updatedAt.getTime(),
    );
    expect(after!.createdAt).toEqual(before!.createdAt);
  });

  it("seller (C con ORG_1 activa) también marca disponible", async () => {
    const id = await unit(ORG_1);
    request(USER_C, ORG_1);
    expect(await mark(id)).toMatchObject({ status: "available" });
    expect(await statusOf(id)).toBe("available");
  });

  it("C con ORG_3 activa (admin) marca disponible una unidad de ORG_3", async () => {
    const id = await unit(ORG_3);
    request(USER_C, ORG_3);
    expect(await mark(id)).toMatchObject({ status: "available" });
    expect(await statusOf(id)).toBe("available");
  });

  it.each([["sold"], ["reserved"], ["in_preparation"], ["available"]])(
    "el destino es siempre `available`, aunque el pedido diga status = %s",
    async (status) => {
      const id = await unit(ORG_1);
      request(USER_A);
      expect(await mark(id, { status, to: status })).toMatchObject({
        status: "available",
      });
      expect(await statusOf(id)).toBe("available");
    },
  );

  it("organización y datos de la unidad del pedido no tienen efecto", async () => {
    const id = await unit(ORG_1);
    const before = await row(id);
    request(USER_A);
    await mark(id, {
      organizationId: ORG_2,
      organization_id: ORG_2,
      brand: "Pisada",
      model: "X",
      price: "1",
      currency: "PYG",
      km: "0",
      year: "1999",
    });
    expect(await row(id)).toEqual({
      ...before,
      status: "available",
      updatedAt: expect.any(Date),
    });
  });

  it("sin sesión o sin membership activa no llega a la base", async () => {
    const id = await unit(ORG_1);
    for (const [userId, path] of [
      [null, "/login"],
      [USER_D, "/no-access"],
      [USER_E, "/no-access"],
    ] as const) {
      request(userId);
      expect(await redirectOf(mark(id))).toBe(path);
    }
    // Una cookie con una organización donde la membership está inactiva no
    // elige organización.
    request(USER_C, ORG_2);
    expect(await redirectOf(mark(id))).toBe("/select-organization");
    expect(await statusOf(id)).toBe("in_preparation");
    expect(mocks.revalidated).toEqual([]);
  });

  it("un id malformado es not_found sin llegar a la base; uno que no existe, not_found", async () => {
    request(USER_A);
    expect(await mark("no-es-un-uuid")).toEqual({ status: "not_found" });
    expect(mocks.revalidated).toEqual([]);
    expect(await mark(randomUUID())).toEqual({ status: "not_found" });
    expect(mocks.revalidated).toEqual(["/stock"]);
  });
});

describe("solo in_preparation → available", () => {
  it("available → available no hace una transición: unchanged, sin escribir", async () => {
    const id = await unit(ORG_1, "available");
    const before = await row(id);
    request(USER_A);
    expect(await mark(id)).toEqual({
      status: "unchanged",
      vehicleId: id,
      ...HILUX,
      current: "available",
    });
    // Ni el estado ni updated_at cambian: el UPDATE no encontró la fila.
    expect(await row(id)).toEqual(before);
    expect(mocks.revalidated).toEqual(["/stock"]);
  });

  it.each([["reserved"], ["sold"]] as const)(
    "una unidad %s no se convierte en disponible por este flujo",
    async (status) => {
      const id = await unit(ORG_1, status);
      const before = await row(id);
      request(USER_A);
      expect(await mark(id)).toEqual({
        status: "unchanged",
        vehicleId: id,
        ...HILUX,
        current: status,
      });
      expect(await row(id)).toEqual(before);

      // Tampoco con un UPDATE directo por el boundary: RLS (USING) no la deja
      // tocar, sin error y sin filas.
      expect(
        await directUpdate(tenantContext(USER_A, ORG_1), id, {
          status: "available",
        }),
      ).toEqual([]);
      expect(await row(id)).toEqual(before);
    },
  );

  it("marcar dos veces seguidas: la primera hace la transición, la segunda no", async () => {
    const id = await unit(ORG_1);
    request(USER_A);
    expect(await mark(id)).toMatchObject({ status: "available" });
    const afterFirst = await row(id);
    request(USER_C, ORG_1);
    expect(await mark(id)).toMatchObject({
      status: "unchanged",
      current: "available",
    });
    expect(await row(id)).toEqual(afterFirst);
  });
});

describe("aislamiento: la organización sale del contexto, nunca del pedido", () => {
  it("cross-tenant: B (ORG_2) no marca una unidad de ORG_1; la ve como inexistente", async () => {
    const id = await unit(ORG_1);
    request(USER_B);
    expect(await mark(id)).toEqual({ status: "not_found" });
    expect(await statusOf(id)).toBe("in_preparation");
  });

  it("C con ORG_1 activa no marca una unidad de ORG_3, aunque RLS se lo permitiría: el filtro explícito lo impide", async () => {
    const id = await unit(ORG_3);
    request(USER_C, ORG_1);
    expect(
      await mark(id, { organizationId: ORG_3, organization_id: ORG_3 }),
    ).toEqual({ status: "not_found" });
    expect(await statusOf(id)).toBe("in_preparation");

    // Sin el filtro por organización (solo RLS), C sí podría: es admin de
    // ORG_3. Es la defensa en profundidad que hace no inyectable la
    // organización.
    expect(
      await directUpdate(tenantContext(USER_C, ORG_1), id, {
        status: "available",
      }),
    ).toEqual([{ id, status: "available" }]);
  });

  it.each([
    ["A con ORG_2 (sin membership)", USER_A, ORG_2, ORG_2],
    ["B con ORG_1 (sin membership)", USER_B, ORG_1, ORG_1],
    ["C con ORG_2 (membership inactiva)", USER_C, ORG_2, ORG_2],
    ["D con ORG_1 (solo membership inactiva)", USER_D, ORG_1, ORG_1],
    ["E con ORG_1 (sin memberships)", USER_E, ORG_1, ORG_1],
  ])(
    "un contexto falsificado no marca nada: %s",
    async (_, userId, orgId, unitOrg) => {
      const id = await unit(unitOrg);
      // Por la Server Action (Tenant Resolution salteada)…
      request(null);
      mocks.forged = tenantContext(userId, orgId);
      try {
        expect(await mark(id)).toEqual({ status: "not_found" });
      } finally {
        mocks.forged = null;
      }
      // …y por la escritura directa: RLS no la deja ver ni tocar.
      expect(
        await transitionVehicleToAvailable(tenantContext(userId, orgId), id),
      ).toEqual({ outcome: "not_found" });
      expect(await statusOf(id)).toBe("in_preparation");
    },
  );

  it("revocar la membership corta la transición, aun con un contexto viejo (A-09)", async () => {
    const ctx = tenantContext(USER_A, ORG_1);
    const id = await unit(ORG_1);
    const setActive = (active: boolean) => db.admin`
      UPDATE public.memberships SET active = ${active}
      WHERE organization_id = ${ORG_1} AND user_id = ${USER_A}
    `;
    await setActive(false);
    try {
      expect(await transitionVehicleToAvailable(ctx, id)).toEqual({
        outcome: "not_found",
      });
    } finally {
      await setActive(true);
    }
    expect(await statusOf(id)).toBe("in_preparation");
    expect(await transitionVehicleToAvailable(ctx, id)).toMatchObject({
      outcome: "became_available",
    });
  });
});

/*
 * Regla de autorización (H1.3B, misma en H1.3C): membership activa AND role
 * IN ('admin', 'seller'). Hoy membership_role contiene exactamente esos dos
 * valores, así que requireTenant() y la policy de UPDATE (organización con
 * membership activa) la cumplen sin un chequeo de rol adicional.
 */
describe("autorización: membership activa AND role IN ('admin', 'seller')", () => {
  it("membership_role contiene exactamente los roles autorizados: un rol nuevo exige revisar markVehicleAvailable() y su policy", async () => {
    const [found] = await db.admin<{ labels: string[] }[]>`
      SELECT array_agg(enumlabel::text ORDER BY enumsortorder) AS labels
      FROM pg_enum WHERE enumtypid = 'public.membership_role'::regtype
    `;
    expect(found?.labels).toEqual(["admin", "seller"]);
  });

  it("admin y seller activos de ORG_1 marcan; las memberships inactivas no, cualquiera sea su rol", async () => {
    for (const userId of [USER_A, USER_C]) {
      const id = await unit(ORG_1);
      expect(
        await transitionVehicleToAvailable(tenantContext(userId, ORG_1), id),
      ).toMatchObject({ outcome: "became_available" });
    }
    const inactive = await db.admin<{ userId: string; orgId: string }[]>`
      SELECT user_id AS "userId", organization_id AS "orgId"
      FROM public.memberships WHERE NOT active ORDER BY user_id
    `;
    expect(inactive.length).toBeGreaterThan(0);
    for (const { userId, orgId } of inactive) {
      const id = await unit(orgId);
      expect(
        await transitionVehicleToAvailable(tenantContext(userId, orgId), id),
      ).toEqual({ outcome: "not_found" });
      expect(await statusOf(id)).toBe("in_preparation");
    }
  });
});

describe("RLS y privilegios: la base rechaza lo que el flujo no permite", () => {
  const ctx = () => tenantContext(USER_A, ORG_1);

  it.each([["reserved"], ["sold"], ["in_preparation"]] as const)(
    "in_preparation → %s falla por el WITH CHECK de la policy (42501)",
    async (status) => {
      const id = await unit(ORG_1);
      const before = await row(id);
      await expectSqlError(directUpdate(ctx(), id, { status }), "42501");
      expect(await row(id)).toEqual(before);
    },
  );

  it("available → in_preparation (volver atrás) no toca la fila", async () => {
    const id = await unit(ORG_1, "available");
    expect(await directUpdate(ctx(), id, { status: "in_preparation" })).toEqual(
      [],
    );
    expect(await statusOf(id)).toBe("available");
  });

  it("updated_at solo se escribe dentro de la transición: sin cambiar el estado, falla", async () => {
    const id = await unit(ORG_1);
    const before = await row(id);
    await expectSqlError(
      directUpdate(ctx(), id, { updatedAt: new Date() }),
      "42501",
    );
    expect(await row(id)).toEqual(before);
  });

  it.each([
    ["brand", { brand: "Pisada" }],
    ["model", { model: "Pisada" }],
    ["version", { version: "Pisada" }],
    ["year", { year: 1999 }],
    ["km", { km: 0 }],
    ["price y currency", { price: "1.00", currency: "USD" as const }],
    ["organization_id", { organizationId: ORG_2 }],
    ["id", { id: randomUUID() }],
    ["created_at", { createdAt: new Date("2020-01-01T00:00:00Z") }],
  ] as const)(
    "UPDATE de %s sigue prohibido (sin privilegio de columna), aun junto con la transición",
    async (_, set) => {
      const id = await unit(ORG_1);
      const before = await row(id);
      await expectSqlError(directUpdate(ctx(), id, set), "42501");
      await expectSqlError(
        directUpdate(ctx(), id, { ...set, status: "available" }),
        "42501",
      );
      expect(await row(id)).toEqual(before);
    },
  );

  it("DELETE sigue prohibido, también en la organización propia y en cualquier estado", async () => {
    for (const status of [
      "in_preparation",
      "available",
      "reserved",
      "sold",
    ] as const) {
      const id = await unit(ORG_1, status);
      await expectSqlError(
        withTenant(ctx(), (tx) =>
          tx.delete(vehicles).where(eq(vehicles.id, id)),
        ),
        "42501",
      );
      expect(await statusOf(id)).toBe(status);
    }
  });

  it("app_runtime fuera del boundary no actualiza vehículos (42501)", async () => {
    const id = await unit(ORG_1);
    await expect(
      runtimePool()`
        UPDATE public.vehicles SET status = 'available' WHERE id = ${id}
      `,
    ).rejects.toMatchObject({ code: "42501" });
    expect(await statusOf(id)).toBe("in_preparation");
  });

  it("anon no actualiza (sin grants)", async () => {
    const id = await unit(ORG_1);
    await expect(
      db.admin.begin(async (tx) => {
        await tx`SET LOCAL ROLE anon`;
        await tx`UPDATE public.vehicles SET status = 'available' WHERE id = ${id}`;
      }),
    ).rejects.toMatchObject({ code: "42501" });
    expect(await statusOf(id)).toBe("in_preparation");
  });

  it("authenticated sin claims no actualiza nada: la policy no encuentra organizaciones", async () => {
    const id = await unit(ORG_1);
    const updated = await runtimePool().begin(async (tx) => {
      await tx`SELECT set_config('role', 'authenticated', true)`;
      return tx`
        UPDATE public.vehicles SET status = 'available', updated_at = now()
        WHERE id = ${id} RETURNING id
      `;
    });
    expect([...updated]).toEqual([]);
    expect(await statusOf(id)).toBe("in_preparation");
  });

  /*
   * Mutaciones: cada una rompe una condición de la policy y muestra que los
   * tests de arriba la detectan. La policy se restaura siempre.
   */
  const ORIGINAL_USING =
    "organization_id IN (SELECT private.user_org_ids()) AND status = 'in_preparation'";
  const ORIGINAL_CHECK =
    "organization_id IN (SELECT private.user_org_ids()) AND status = 'available'";

  async function updatePolicy() {
    return (await policies(db.admin)).find(
      (policy) => policy.name === "vehicles_update_mark_available",
    );
  }

  async function withPolicy<T>(
    using: string,
    check: string,
    fn: () => Promise<T>,
  ): Promise<T> {
    const original = await updatePolicy();
    await db.admin.unsafe(
      `ALTER POLICY vehicles_update_mark_available ON public.vehicles USING (${using}) WITH CHECK (${check})`,
    );
    try {
      return await fn();
    } finally {
      await db.admin.unsafe(
        `ALTER POLICY vehicles_update_mark_available ON public.vehicles USING (${ORIGINAL_USING}) WITH CHECK (${ORIGINAL_CHECK})`,
      );
      expect(await updatePolicy()).toEqual(original);
    }
  }

  it("mutación: sin status = 'in_preparation' en USING, una unidad reservada pasaría a disponible", async () => {
    const id = await unit(ORG_1, "reserved");
    await withPolicy(
      "organization_id IN (SELECT private.user_org_ids())",
      ORIGINAL_CHECK,
      async () => {
        expect(await directUpdate(ctx(), id, { status: "available" })).toEqual([
          { id, status: "available" },
        ]);
      },
    );
    const other = await unit(ORG_1, "reserved");
    expect(await directUpdate(ctx(), other, { status: "available" })).toEqual(
      [],
    );
  });

  it("mutación: sin status = 'available' en WITH CHECK, una unidad en preparación pasaría a vendida", async () => {
    const id = await unit(ORG_1);
    await withPolicy(
      ORIGINAL_USING,
      "organization_id IN (SELECT private.user_org_ids())",
      async () => {
        expect(await directUpdate(ctx(), id, { status: "sold" })).toEqual([
          { id, status: "sold" },
        ]);
      },
    );
    await expectSqlError(
      directUpdate(ctx(), await unit(ORG_1), { status: "sold" }),
      "42501",
    );
  });

  /*
   * Un UPDATE sin WHERE ni RETURNING no necesita leer filas: la policy de
   * lectura no aplica y la de UPDATE es la única barrera de organización.
   */
  it("un UPDATE sin WHERE de un usuario sin memberships no toca nada", async () => {
    const id = await unit(ORG_2);
    await withTenant(tenantContext(USER_E, ORG_1), (tx) =>
      tx.update(vehicles).set({ status: "available" }),
    );
    expect(await statusOf(id)).toBe("in_preparation");
  });

  it("mutación: sin la organización en la policy, ese UPDATE sin WHERE tocaría todas las organizaciones", async () => {
    const id = await unit(ORG_2);
    const unbounded = () =>
      withTenant(tenantContext(USER_E, ORG_1), (tx) =>
        tx.update(vehicles).set({ status: "available" }),
      );
    // Sin la organización solo en USING, el WITH CHECK todavía la exige: el
    // UPDATE falla en vez de pasar en silencio.
    await withPolicy("status = 'in_preparation'", ORIGINAL_CHECK, async () => {
      await expectSqlError(unbounded(), "42501");
    });
    expect(await statusOf(id)).toBe("in_preparation");
    await withPolicy(
      "status = 'in_preparation'",
      "status = 'available'",
      async () => {
        await unbounded();
      },
    );
    expect(await statusOf(id)).toBe("available");
    const other = await unit(ORG_2);
    await unbounded();
    expect(await statusOf(other)).toBe("in_preparation");
  });
});

/*
 * Dos usuarios marcan la misma unidad casi a la vez. El UPDATE depende del
 * estado actual: el que llega segundo espera el lock de la fila, re-evalúa
 * el WHERE sobre la versión confirmada y no encuentra nada que actualizar.
 * Una sola transición, sin error ni sobrescritura.
 */
describe("concurrencia: una sola transición por unidad", () => {
  /** Espera a que `count` conexiones de app_runtime queden esperando un lock. */
  async function waitForLockWaits(count: number): Promise<void> {
    for (let attempt = 0; attempt < 250; attempt++) {
      const [found] = await db.admin<{ waiting: number }[]>`
        SELECT count(*)::int AS waiting FROM pg_stat_activity
        WHERE datname = current_database() AND usename = 'app_runtime'
          AND wait_event_type = 'Lock'
      `;
      if ((found?.waiting ?? 0) >= count) return;
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    throw new Error(`expected ${count} requests waiting on the row lock`);
  }

  /**
   * Retiene la fila con otra transacción (como postgres) mientras corre
   * `start`; `hold` decide qué hace esa transacción antes de soltarla.
   */
  async function whileRowIsHeld<T>(
    id: string,
    hold: (tx: TransactionSql) => Promise<void>,
    start: () => Promise<T>,
    waiting: number,
  ): Promise<T> {
    const holder = postgres(db.migrationUrl, { max: 1, onnotice: () => {} });
    let release!: () => void;
    const released = new Promise<void>((resolve) => (release = resolve));
    let locked!: () => void;
    const rowLocked = new Promise<void>((resolve) => (locked = resolve));
    const holding = holder.begin(async (tx) => {
      await tx`SELECT id FROM public.vehicles WHERE id = ${id} FOR UPDATE`;
      await hold(tx);
      locked();
      await released;
    });
    try {
      await rowLocked;
      const running = start();
      await waitForLockWaits(waiting);
      release();
      await holding;
      return await running;
    } finally {
      release();
      await holding.catch(() => {});
      await holder.end();
    }
  }

  it("admin y seller a la vez (dos pedidos cada uno): exactamente una transición, los demás unchanged", async () => {
    const id = await unit(ORG_1);
    const contexts = [
      tenantContext(USER_A, ORG_1),
      tenantContext(USER_C, ORG_1),
      tenantContext(USER_A, ORG_1),
      tenantContext(USER_C, ORG_1),
    ];
    const results = await whileRowIsHeld(
      id,
      async () => {},
      () =>
        Promise.all(
          contexts.map((ctx) => transitionVehicleToAvailable(ctx, id)),
        ),
      contexts.length,
    );
    expect(
      results.filter((result) => result.outcome === "became_available"),
    ).toHaveLength(1);
    expect(results.filter((result) => result.outcome === "unchanged")).toEqual(
      Array.from({ length: 3 }, () =>
        expect.objectContaining({ status: "available" }),
      ),
    );
    expect(await statusOf(id)).toBe("available");
  });

  it("si otra transacción la marca disponible mientras el pedido espera, el pedido no hace una segunda transición", async () => {
    const id = await unit(ORG_1);
    const result = await whileRowIsHeld(
      id,
      async (tx) => {
        await tx`UPDATE public.vehicles SET status = 'available' WHERE id = ${id}`;
      },
      () => transitionVehicleToAvailable(tenantContext(USER_A, ORG_1), id),
      1,
    );
    expect(result).toMatchObject({ outcome: "unchanged", status: "available" });
  });

  it("si otra transacción la reserva mientras el pedido espera, el pedido no la sobrescribe", async () => {
    const id = await unit(ORG_1);
    const result = await whileRowIsHeld(
      id,
      async (tx) => {
        await tx`UPDATE public.vehicles SET status = 'reserved' WHERE id = ${id}`;
      },
      () => transitionVehicleToAvailable(tenantContext(USER_C, ORG_1), id),
      1,
    );
    expect(result).toMatchObject({ outcome: "unchanged", status: "reserved" });
    expect(await statusOf(id)).toBe("reserved");
  });

  it("por la Server Action, dos pedidos simultáneos del mismo usuario: uno available y otro unchanged", async () => {
    const id = await unit(ORG_1);
    request(USER_A);
    const results = await whileRowIsHeld(
      id,
      async () => {},
      () => Promise.all([mark(id), mark(id)]),
      2,
    );
    expect(results.map((result) => result?.status).sort()).toEqual([
      "available",
      "unchanged",
    ]);
    expect(await statusOf(id)).toBe("available");
  });
});

describe("Stock refleja la transición: nuevo grupo y conteos", () => {
  it("la unidad pasa de En preparación a Disponibles, con los conteos actualizados, solo en su organización", async () => {
    const id = await unit(ORG_1);
    request(USER_A);
    const before = await getStockList();
    request(USER_B);
    const otherBefore = await getStockList();

    const inGroup = (stock: typeof before, status: string) =>
      groupByStatus(stock)
        .find((group) => group.status === status)
        ?.vehicles.map((vehicle) => vehicle.id) ?? [];
    expect(inGroup(before, "inPreparation")).toContain(id);
    expect(inGroup(before, "available")).not.toContain(id);

    request(USER_A);
    expect(await mark(id)).toMatchObject({ status: "available" });

    request(USER_A);
    const after = await getStockList();
    expect(after).toHaveLength(before.length);
    expect(after.find((vehicle) => vehicle.id === id)).toStrictEqual({
      ...before.find((vehicle) => vehicle.id === id),
      status: "available",
    });
    expect(inGroup(after, "inPreparation")).not.toContain(id);
    expect(inGroup(after, "available")).toContain(id);

    const counts = countByStatus(before);
    expect(countByStatus(after)).toEqual({
      ...counts,
      inPreparation: counts.inPreparation - 1,
      available: counts.available + 1,
    });
    // El resto de la lista no cambia (mismo orden de ingreso).
    expect(after.map((vehicle) => vehicle.id)).toEqual(
      before.map((vehicle) => vehicle.id),
    );

    request(USER_B);
    expect(await getStockList()).toEqual(otherBefore);
  });
});
