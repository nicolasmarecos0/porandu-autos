import { randomUUID } from "node:crypto";

import { eq } from "drizzle-orm";
import postgres, { type Sql, type TransactionSql } from "postgres";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { transitionVehicleStatus } from "@/db/queries/change-vehicle-status";
import { closeOpportunityWithMetadata } from "@/db/queries/close-opportunity";
import { getStockCatalog } from "@/db/queries/stock-catalog";
import { getStockList } from "@/db/queries/vehicles";
import { opportunities, vehicles } from "@/db/schema";
import { withTenant, type TenantContext } from "@/db/tenant";
import type { WonClosure } from "@/domains/opportunities/closure";
import {
  canTransitionVehicle,
  STOCK_TRANSITION_IDS,
} from "@/domains/vehicles/lifecycle";
import {
  groupByStatus,
  VEHICLE_STATUSES,
  type VehicleStatus,
} from "@/domains/vehicles/stock";
import {
  addOpportunityNote,
  closeOpportunity,
} from "@/lib/opportunities/actions";
import type { CloseOpportunityState } from "@/lib/opportunities/closure";
import { ACTIVE_ORGANIZATION_COOKIE } from "@/lib/tenant/cookie";
import { changeVehicleStatus } from "@/lib/vehicles/actions";
import type { ChangeVehicleStatusState } from "@/lib/vehicles/status-change";

import { cookieJar, type CookieJar } from "../unit/support/cookie-jar";
import { policies } from "./support/catalog";
import { closureColumns, WON_METADATA } from "./support/closures";
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

/*
 * Ciclo de vida de las unidades (Hito 19, propuesta DEC-051) de punta a
 * punta contra PostgreSQL 17 con las migraciones aplicadas:
 *
 *   changeVehicleStatus() → requireTenant() → pedido → withTenant() →
 *   SELECT … FOR UPDATE → planVehicleStatusChange() → UPDATE → RLS (policy
 *   única de UPDATE) + trigger vehicles_status_transition → Stock y Catálogo
 *
 *   closeOpportunity() Ganada → … → la oportunidad y su unidad bloqueadas →
 *   planVehicleSale() → UPDATE de la oportunidad → UPDATE de la unidad a
 *   `sold` → constraint trigger diferido opportunities_won_vehicle_sold →
 *   COMMIT
 *
 * Las acciones, las escrituras y los loaders son los reales, conectados como
 * app_runtime. Supabase Auth (claims ya verificados), la cookie, redirect()
 * y revalidatePath() de Next son simulados, como en las demás suites. La
 * base se prueba también sola: UPDATEs directos por el boundary (sin el
 * dominio) y con el rol dueño, que el trigger rechaza igual.
 *
 * Tenants (support/tenants.ts): A: admin de ORG_1 · B: admin de ORG_2 · C:
 * seller de ORG_1 y admin de ORG_3, seller inactivo de ORG_2 · D: solo
 * inactiva en ORG_1 · E: sin memberships.
 *
 * Cada caso usa sus propias unidades y oportunidades (insertadas con el
 * superusuario, en el estado que necesita) para no depender del orden.
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

/** Las vistas que leen vehicles.status (lib/vehicles/paths.ts). */
const LIFECYCLE_PATHS = [
  "/stock",
  "/stock/catalog",
  "/opportunities",
  "/opportunities/pipeline",
  "/cockpit",
  "/cockpit/metrics",
];

type DbStatus = "in_preparation" | "available" | "reserved" | "sold";

const TO_DB: Record<VehicleStatus, DbStatus> = {
  inPreparation: "in_preparation",
  available: "available",
  reserved: "reserved",
  sold: "sold",
};

let sequence = 0;

/**
 * Una unidad propia del caso, en `status`, ingresada (y actualizada por
 * última vez) hace un día: así se ve si un pase toca `updated_at`.
 */
async function unit(
  organizationId: string,
  status: DbStatus = "available",
): Promise<string> {
  sequence += 1;
  const id = randomUUID();
  await db.admin`
    INSERT INTO public.vehicles (id, organization_id, brand, model, version,
      year, km, price, currency, status, created_at, updated_at)
    VALUES (${id}, ${organizationId}, 'Toyota', 'Hilux',
      ${`Prueba Hito 19 ${sequence}`}, 2025, 0, 49900, 'USD', ${status},
      now() - interval '1 day', now() - interval '1 day')
  `;
  return id;
}

/**
 * Una oportunidad propia del caso en `stage` con la unidad `vehicleId` (y,
 * cerrada, con metadatos válidos). Un INSERT del superusuario no pasa por
 * los triggers de UPDATE: arma escenarios que la aplicación ya no produce.
 */
async function opportunity(
  organizationId: string,
  stage: "negotiating" | "won" | "lost",
  vehicleId: string,
): Promise<string> {
  sequence += 1;
  const contactId = randomUUID();
  const id = randomUUID();
  await db.admin`
    INSERT INTO public.contacts (id, organization_id, name)
    VALUES (${contactId}, ${organizationId}, ${`Cliente Hito 19 ${sequence}`})
  `;
  await db.admin`
    INSERT INTO public.opportunities ${db.admin({
      id,
      organization_id: organizationId,
      contact_id: contactId,
      stage,
      source: "showroom",
      vehicle_id: vehicleId,
      ...closureColumns(stage),
      last_activity_at: new Date(Date.now() - 86_400_000),
      created_at: new Date(Date.now() - 86_400_000),
      updated_at: new Date(Date.now() - 86_400_000),
    })}
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
  status: DbStatus;
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

async function statusOf(id: string): Promise<DbStatus | undefined> {
  return (await row(id))?.status;
}

type OpportunityRow = {
  stage: string;
  vehicleId: string | null;
  salePrice: string | null;
  lossReason: string | null;
  updatedAt: Date;
};

async function opportunityRow(id: string): Promise<OpportunityRow> {
  const [found] = await db.admin<OpportunityRow[]>`
    SELECT stage, vehicle_id AS "vehicleId", sale_price::text AS "salePrice",
      loss_reason AS "lossReason", updated_at AS "updatedAt"
    FROM public.opportunities WHERE id = ${id}
  `;
  return found!;
}

function form(fields: Record<string, string>): FormData {
  const data = new FormData();
  for (const [name, value] of Object.entries(fields)) data.append(name, value);
  return data;
}

function change(
  vehicleId: string,
  transition: string,
  extra: Record<string, string> = {},
): Promise<ChangeVehicleStatusState> {
  return changeVehicleStatus(null, form({ vehicleId, transition, ...extra }));
}

const WIN = {
  outcome: "won",
  salePrice: "47.500",
  saleCurrency: "USD",
  paymentMethod: "financing",
  deliveryStatus: "scheduled",
  deliveryDate: "2100-01-15",
} as const;

function close(
  opportunityId: string,
  fields: Record<string, string> = WIN,
): Promise<CloseOpportunityState> {
  return closeOpportunity(null, form({ opportunityId, ...fields }));
}

const WON: WonClosure = {
  outcome: "won",
  salePrice: { amount: "47500.00", currency: "USD" },
  paymentMethod: "cash",
  deliveryStatus: "delivered",
  deliveryDate: "2026-10-01",
};

async function redirectOf(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof mocks.RedirectSignal) return error.path;
    throw error;
  }
  throw new Error("expected a redirect");
}

/** Drizzle envuelve el error del driver: el SQLSTATE queda en `cause`. */
async function expectSqlError(
  promise: Promise<unknown>,
  code: string,
  constraint?: string,
): Promise<void> {
  await expect(promise).rejects.toMatchObject({
    cause: {
      code,
      ...(constraint ? { constraint_name: constraint } : {}),
    },
  });
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

/** El rol dueño (postgres), fuera del boundary: el trigger no lo exime. */
async function asOwner<T>(fn: (sql: Sql) => Promise<T>): Promise<T> {
  const owner = postgres(db.migrationUrl, { max: 1, onnotice: () => {} });
  try {
    return await fn(owner);
  } finally {
    await owner.end();
  }
}

const ctxA = () => tenantContext(USER_A, ORG_1);
const HILUX = { brand: "Toyota", model: "Hilux", year: 2025 } as const;

describe("changeVehicleStatus(): requireTenant() → pedido → withTenant() → UPDATE", () => {
  it("admin (A) pone en el salón una unidad en preparación: solo cambian el estado y su updated_at, y revalida las seis vistas", async () => {
    const id = await unit(ORG_1, "in_preparation");
    const before = await row(id);
    request(USER_A);

    expect(await change(id, "put_on_floor")).toEqual({
      status: "changed",
      vehicleId: id,
      ...HILUX,
      transition: "put_on_floor",
      from: "inPreparation",
      to: "available",
    });
    expect(mocks.revalidated).toEqual(LIFECYCLE_PATHS);

    const after = await row(id);
    expect(after).toEqual({
      ...before,
      status: "available",
      updatedAt: expect.any(Date),
    });
    expect(after!.updatedAt.getTime()).toBeGreaterThan(
      before!.updatedAt.getTime(),
    );
    expect(after!.createdAt).toEqual(before!.createdAt);
  });

  it("seller (C con ORG_1) reserva una disponible y la libera: available ⇄ reserved", async () => {
    const id = await unit(ORG_1, "available");
    request(USER_C, ORG_1);
    expect(await change(id, "reserve")).toMatchObject({
      status: "changed",
      from: "available",
      to: "reserved",
    });
    expect(await statusOf(id)).toBe("reserved");

    request(USER_A);
    expect(await change(id, "release")).toMatchObject({
      status: "changed",
      from: "reserved",
      to: "available",
    });
    expect(await statusOf(id)).toBe("available");
  });

  it("C con ORG_3 activa (admin) reserva una unidad de ORG_3", async () => {
    const id = await unit(ORG_3, "available");
    request(USER_C, ORG_3);
    expect(await change(id, "reserve")).toMatchObject({ status: "changed" });
    expect(await statusOf(id)).toBe("reserved");
  });

  it("el destino lo fija la transición: estado, organización y datos de la unidad del pedido no tienen efecto", async () => {
    const id = await unit(ORG_1, "available");
    const before = await row(id);
    request(USER_A);
    expect(
      await change(id, "reserve", {
        status: "sold",
        to: "sold",
        organizationId: ORG_2,
        organization_id: ORG_2,
        brand: "Pisada",
        price: "1",
        updated_at: "2000-01-01T00:00:00Z",
        userId: USER_B,
      }),
    ).toMatchObject({ status: "changed", to: "reserved" });
    const after = await row(id);
    expect(after).toEqual({
      ...before,
      status: "reserved",
      updatedAt: expect.any(Date),
    });
    expect(after!.updatedAt.getFullYear()).toBeGreaterThan(2020);
  });

  it("vender desde Stock no existe: sale_requires_closure sin llegar a la base", async () => {
    for (const status of ["available", "reserved"] as const) {
      const id = await unit(ORG_1, status);
      const before = await row(id);
      request(USER_A);
      expect(await change(id, "sell")).toEqual({
        status: "sale_requires_closure",
      });
      expect(await row(id)).toEqual(before);
      expect(mocks.revalidated).toEqual([]);
    }
  });

  it("una transición desconocida es invalid, y un id malformado not_found, sin llegar a la base", async () => {
    const id = await unit(ORG_1, "available");
    const before = await row(id);
    request(USER_A);
    for (const transition of ["", "available", "reserved", "SELL", "Reserve"]) {
      expect(await change(id, transition), transition).toEqual({
        status: "invalid",
      });
    }
    expect(await row(id)).toEqual(before);
    expect(await change("no-es-un-uuid", "reserve")).toEqual({
      status: "not_found",
    });
    expect(mocks.revalidated).toEqual([]);
    // Un id que no existe sí llega a la base: not_found, sin revelar nada.
    expect(await change(randomUUID(), "reserve")).toEqual({
      status: "not_found",
    });
  });

  it("sin sesión o sin membership activa no llega a la base", async () => {
    const id = await unit(ORG_1, "available");
    for (const [userId, path] of [
      [null, "/login"],
      [USER_D, "/no-access"],
      [USER_E, "/no-access"],
    ] as const) {
      request(userId);
      expect(await redirectOf(change(id, "reserve"))).toBe(path);
    }
    // Una cookie con una organización donde la membership está inactiva no
    // elige organización.
    request(USER_C, ORG_2);
    expect(await redirectOf(change(id, "reserve"))).toBe(
      "/select-organization",
    );
    expect(await statusOf(id)).toBe("available");
    expect(mocks.revalidated).toEqual([]);
  });
});

describe("idempotencia y conflictos: un pedido viejo nunca deshace lo que hizo otro", () => {
  it.each([
    ["put_on_floor", "available"],
    ["reserve", "reserved"],
    ["release", "available"],
  ] as const)(
    "%s cuando la unidad ya está %s: unchanged, sin escribir",
    async (transition, status) => {
      const id = await unit(ORG_1, status);
      const before = await row(id);
      request(USER_A);
      expect(await change(id, transition)).toEqual({
        status: "unchanged",
        vehicleId: id,
        ...HILUX,
        transition,
        current: TO_DB_INVERSE[status],
      });
      // Ni el estado ni updated_at cambian. Las vistas se revalidan igual.
      expect(await row(id)).toEqual(before);
      expect(mocks.revalidated).toEqual(LIFECYCLE_PATHS);
    },
  );

  it.each([
    ["put_on_floor", "reserved", "reserved"],
    ["put_on_floor", "sold", "sold"],
    ["reserve", "in_preparation", "inPreparation"],
    ["reserve", "sold", "sold"],
    ["release", "in_preparation", "inPreparation"],
    ["release", "sold", "sold"],
  ] as const)(
    "%s con la unidad %s: conflict con su estado real, sin escribir",
    async (transition, status, current) => {
      const id = await unit(ORG_1, status);
      const before = await row(id);
      request(USER_A);
      expect(await change(id, transition)).toEqual({
        status: "conflict",
        vehicleId: id,
        ...HILUX,
        transition,
        current,
      });
      expect(await row(id)).toEqual(before);
    },
  );
});

/** El estado de la base como lo nombra el dominio. */
const TO_DB_INVERSE: Record<DbStatus, VehicleStatus> = {
  in_preparation: "inPreparation",
  available: "available",
  reserved: "reserved",
  sold: "sold",
};

describe("la base exige la máquina del dominio (trigger vehicles_status_transition)", () => {
  /*
   * Los 16 pares, como el rol dueño: el trigger no exime a nadie. Vender
   * exige además una oportunidad ganada que la tenga vinculada.
   */
  const STATUSES = VEHICLE_STATUSES.map(({ id }) => id);
  const PAIRS = STATUSES.flatMap((from) =>
    STATUSES.map((to) => [from, to] as const),
  );

  it.each(PAIRS)(
    "%s → %s: la base acepta exactamente los pases del dominio",
    async (from, to) => {
      const id = await unit(ORG_1, TO_DB[from]);
      // Para vender, una oportunidad ganada la tiene vinculada (en otro caso
      // de abajo, sin ella, se rechaza aunque el pase exista).
      if (to === "sold") await opportunity(ORG_1, "won", id);
      const update = asOwner(
        (sql) =>
          sql`UPDATE public.vehicles SET status = ${TO_DB[to]} WHERE id = ${id}`,
      );
      if (canTransitionVehicle(from, to)) {
        await update;
        expect(await statusOf(id)).toBe(TO_DB[to]);
      } else {
        await expect(update).rejects.toMatchObject({
          code: "23514",
          constraint_name: "vehicles_status_transition",
        });
        expect(await statusOf(id)).toBe(TO_DB[from]);
      }
    },
  );

  it.each(["available", "reserved"] as const)(
    "%s → sold sin una oportunidad ganada que la tenga vinculada: vehicles_sale_requires_won, también para el rol dueño",
    async (from) => {
      // Vinculada a una negociación y a una perdida: ninguna es una venta.
      const id = await unit(ORG_1, from);
      await opportunity(ORG_1, "negotiating", id);
      await opportunity(ORG_1, "lost", id);
      // Una ganada de otra organización con la misma unidad no puede
      // existir (FK compuesta): la regla mira la organización de la unidad.
      await expect(
        asOwner(
          (sql) =>
            sql`UPDATE public.vehicles SET status = 'sold' WHERE id = ${id}`,
        ),
      ).rejects.toMatchObject({
        code: "23514",
        constraint_name: "vehicles_sale_requires_won",
      });
      await expectSqlError(
        directUpdate(ctxA(), id, { status: "sold" }),
        "23514",
        "vehicles_sale_requires_won",
      );
      expect(await statusOf(id)).toBe(from);
    },
  );

  it("el rol dueño no cambia otras columnas: vehicles_immutable, aun junto con un pase válido", async () => {
    const id = await unit(ORG_1, "available");
    const before = await row(id);
    for (const statement of [
      "UPDATE public.vehicles SET price = 1 WHERE id = $1",
      "UPDATE public.vehicles SET brand = 'Pisada', status = 'reserved' WHERE id = $1",
      "UPDATE public.vehicles SET organization_id = '" +
        ORG_2 +
        "' WHERE id = $1",
      "UPDATE public.vehicles SET created_at = now() WHERE id = $1",
    ]) {
      await expect(
        asOwner((sql) => sql.unsafe(statement, [id])),
        statement,
      ).rejects.toMatchObject({
        code: "23514",
        constraint_name: "vehicles_immutable",
      });
    }
    expect(await row(id)).toEqual(before);
  });

  it("authenticated no llega ni al trigger con otras columnas: 42501 por privilegios", async () => {
    const id = await unit(ORG_1, "available");
    const before = await row(id);
    for (const set of [
      { brand: "Pisada" },
      { price: "1.00", currency: "USD" as const },
      { km: 1 },
      { organizationId: ORG_2 },
    ]) {
      await expectSqlError(
        directUpdate(ctxA(), id, { ...set, status: "reserved" }),
        "42501",
      );
    }
    expect(await row(id)).toEqual(before);
  });

  it("updated_at lo fija el reloj de la base, aunque el pedido traiga otro", async () => {
    const id = await unit(ORG_1, "available");
    const [updated] = await withTenant(ctxA(), (tx) =>
      tx
        .update(vehicles)
        .set({
          status: "reserved",
          updatedAt: new Date("2000-01-01T00:00:00Z"),
        })
        .where(eq(vehicles.id, id))
        .returning({ updatedAt: vehicles.updatedAt }),
    );
    expect(updated!.updatedAt.getFullYear()).toBeGreaterThan(2020);
    // Sin cambiar el estado no hay pase: también updated_at queda fijo.
    await expectSqlError(
      directUpdate(ctxA(), id, { updatedAt: new Date() }),
      "23514",
      "vehicles_status_transition",
    );
  });

  it("DELETE sigue prohibido en cualquier estado (42501)", async () => {
    for (const status of [
      "in_preparation",
      "available",
      "reserved",
      "sold",
    ] as const) {
      const id = await unit(ORG_1, status);
      await expectSqlError(
        withTenant(ctxA(), (tx) =>
          tx.delete(vehicles).where(eq(vehicles.id, id)),
        ),
        "42501",
      );
      expect(await statusOf(id)).toBe(status);
    }
  });

  it("app_runtime fuera del boundary, anon y authenticated sin claims no cambian estados", async () => {
    const id = await unit(ORG_1, "available");
    await expect(
      runtimePool()`UPDATE public.vehicles SET status = 'reserved' WHERE id = ${id}`,
    ).rejects.toMatchObject({ code: "42501" });
    await expect(
      db.admin.begin(async (tx) => {
        await tx`SET LOCAL ROLE anon`;
        await tx`UPDATE public.vehicles SET status = 'reserved' WHERE id = ${id}`;
      }),
    ).rejects.toMatchObject({ code: "42501" });
    const updated = await runtimePool().begin(async (tx) => {
      await tx`SELECT set_config('role', 'authenticated', true)`;
      return tx`
        UPDATE public.vehicles SET status = 'reserved', updated_at = now()
        WHERE id = ${id} RETURNING id
      `;
    });
    expect([...updated]).toEqual([]);
    expect(await statusOf(id)).toBe("available");
  });
});

/*
 * Mutaciones: cada una rompe una barrera de la base y muestra que los tests
 * de arriba la detectan. La barrera se restaura siempre.
 */
describe("mutaciones: los tests detectan cada barrera rota", () => {
  const ORIGINAL_POLICY = "organization_id IN (SELECT private.user_org_ids())";

  async function updatePolicy() {
    return (await policies(db.admin)).find(
      (policy) => policy.name === "vehicles_update_status",
    );
  }

  async function withPolicy<T>(
    using: string,
    check: string,
    fn: () => Promise<T>,
  ): Promise<T> {
    const original = await updatePolicy();
    await db.admin.unsafe(
      `ALTER POLICY vehicles_update_status ON public.vehicles USING (${using}) WITH CHECK (${check})`,
    );
    try {
      return await fn();
    } finally {
      await db.admin.unsafe(
        `ALTER POLICY vehicles_update_status ON public.vehicles USING (${ORIGINAL_POLICY}) WITH CHECK (${ORIGINAL_POLICY})`,
      );
      expect(await updatePolicy()).toEqual(original);
    }
  }

  it("sin el trigger de transiciones, una unidad en preparación pasaría a vendida sin venta", async () => {
    const id = await unit(ORG_1, "in_preparation");
    await db.admin.unsafe(
      "ALTER TABLE public.vehicles DISABLE TRIGGER vehicles_status_transition",
    );
    try {
      expect(await directUpdate(ctxA(), id, { status: "sold" })).toEqual([
        { id, status: "sold" },
      ]);
    } finally {
      await db.admin.unsafe(
        "ALTER TABLE public.vehicles ENABLE TRIGGER vehicles_status_transition",
      );
    }
    await expectSqlError(
      directUpdate(ctxA(), await unit(ORG_1, "in_preparation"), {
        status: "sold",
      }),
      "23514",
      "vehicles_status_transition",
    );
  });

  it("sin el constraint trigger diferido, una ganada quedaría con la unidad disponible", async () => {
    const vehicleId = await unit(ORG_1, "available");
    const id = await opportunity(ORG_1, "negotiating", vehicleId);
    const winWithoutSale = (opportunityId: string) =>
      withTenant(ctxA(), (tx) =>
        tx
          .update(opportunities)
          .set({ stage: "won", ...WON_METADATA })
          .where(eq(opportunities.id, opportunityId)),
      );
    await db.admin.unsafe(
      "ALTER TABLE public.opportunities DISABLE TRIGGER opportunities_won_vehicle_sold",
    );
    try {
      await winWithoutSale(id);
    } finally {
      await db.admin.unsafe(
        "ALTER TABLE public.opportunities ENABLE TRIGGER opportunities_won_vehicle_sold",
      );
    }
    expect(await opportunityRow(id)).toMatchObject({ stage: "won" });
    expect(await statusOf(vehicleId)).toBe("available");
    // Restaurado, el mismo UPDATE falla al COMMIT.
    const other = await opportunity(
      ORG_1,
      "negotiating",
      await unit(ORG_1, "available"),
    );
    await expect(winWithoutSale(other)).rejects.toMatchObject({
      constraint_name: "opportunities_won_vehicle_sold",
    });
  });

  /*
   * Un UPDATE sin WHERE ni RETURNING no necesita leer filas: la policy de
   * lectura no aplica y la de UPDATE es la única barrera de organización.
   */
  it("un UPDATE sin WHERE de un usuario sin memberships no toca nada", async () => {
    const id = await unit(ORG_2, "in_preparation");
    await withTenant(tenantContext(USER_E, ORG_1), (tx) =>
      tx.update(vehicles).set({ status: "available" }),
    );
    expect(await statusOf(id)).toBe("in_preparation");
  });

  it("sin la organización en la policy, ese UPDATE sin WHERE tocaría todas las organizaciones", async () => {
    const id = await unit(ORG_2, "in_preparation");
    const unbounded = () =>
      withTenant(tenantContext(USER_E, ORG_1), (tx) =>
        tx.update(vehicles).set({ status: "available" }),
      );
    // Sin la organización solo en USING, el WITH CHECK todavía la exige: el
    // UPDATE falla en vez de pasar en silencio. (USING acota a las unidades
    // en preparación para que el pase sea válido en todas.)
    await withPolicy("status = 'in_preparation'", ORIGINAL_POLICY, async () => {
      await expectSqlError(unbounded(), "42501");
    });
    expect(await statusOf(id)).toBe("in_preparation");
    await withPolicy("status = 'in_preparation'", "true", async () => {
      await unbounded();
    });
    expect(await statusOf(id)).toBe("available");
    const other = await unit(ORG_2, "in_preparation");
    await unbounded();
    expect(await statusOf(other)).toBe("in_preparation");
  });
});

describe("aislamiento multi-tenant: la organización sale del contexto, nunca del pedido", () => {
  it("cross-tenant: B (ORG_2) no reserva una unidad de ORG_1; la ve como inexistente", async () => {
    const id = await unit(ORG_1, "available");
    request(USER_B);
    expect(await change(id, "reserve")).toEqual({ status: "not_found" });
    expect(await statusOf(id)).toBe("available");
    // Tampoco por un UPDATE directo: RLS no la deja ver ni tocar.
    expect(
      await directUpdate(tenantContext(USER_B, ORG_2), id, {
        status: "reserved",
      }),
    ).toEqual([]);
    expect(await statusOf(id)).toBe("available");
  });

  it("C con ORG_1 activa no reserva una unidad de ORG_3, aunque RLS se lo permitiría: el filtro explícito lo impide", async () => {
    const id = await unit(ORG_3, "available");
    request(USER_C, ORG_1);
    expect(
      await change(id, "reserve", {
        organizationId: ORG_3,
        organization_id: ORG_3,
      }),
    ).toEqual({ status: "not_found" });
    expect(await statusOf(id)).toBe("available");
    // Sin el filtro por organización (solo RLS), C sí podría: es admin de
    // ORG_3. Es la defensa en profundidad que hace no inyectable la
    // organización.
    expect(
      await directUpdate(tenantContext(USER_C, ORG_1), id, {
        status: "reserved",
      }),
    ).toEqual([{ id, status: "reserved" }]);
  });

  it.each([
    ["A con ORG_2 (sin membership)", USER_A, ORG_2, ORG_2],
    ["B con ORG_1 (sin membership)", USER_B, ORG_1, ORG_1],
    ["C con ORG_2 (membership inactiva)", USER_C, ORG_2, ORG_2],
    ["D con ORG_1 (solo membership inactiva)", USER_D, ORG_1, ORG_1],
    ["E con ORG_1 (sin memberships)", USER_E, ORG_1, ORG_1],
  ])(
    "un contexto falsificado no cambia nada (A-03): %s",
    async (_, userId, orgId, unitOrg) => {
      const id = await unit(unitOrg, "available");
      request(null);
      mocks.forged = tenantContext(userId, orgId);
      try {
        expect(await change(id, "reserve")).toEqual({ status: "not_found" });
      } finally {
        mocks.forged = null;
      }
      expect(
        await transitionVehicleStatus(tenantContext(userId, orgId), {
          vehicleId: id,
          transition: "reserve",
        }),
      ).toEqual({ outcome: "not_found" });
      expect(await statusOf(id)).toBe("available");
    },
  );

  it("revocar la membership corta la transición, aun con un contexto viejo (A-09)", async () => {
    const ctx = ctxA();
    const id = await unit(ORG_1, "available");
    const setActive = (active: boolean) => db.admin`
      UPDATE public.memberships SET active = ${active}
      WHERE organization_id = ${ORG_1} AND user_id = ${USER_A}
    `;
    await setActive(false);
    try {
      expect(
        await transitionVehicleStatus(ctx, {
          vehicleId: id,
          transition: "reserve",
        }),
      ).toEqual({ outcome: "not_found" });
    } finally {
      await setActive(true);
    }
    expect(await statusOf(id)).toBe("available");
    expect(
      await transitionVehicleStatus(ctx, {
        vehicleId: id,
        transition: "reserve",
      }),
    ).toMatchObject({ outcome: "changed" });
  });

  it("membership_role contiene exactamente los roles autorizados: un rol nuevo exige revisar changeVehicleStatus() y su policy", async () => {
    const [found] = await db.admin<{ labels: string[] }[]>`
      SELECT array_agg(enumlabel::text ORDER BY enumsortorder) AS labels
      FROM pg_enum WHERE enumtypid = 'public.membership_role'::regtype
    `;
    expect(found?.labels).toEqual(["admin", "seller"]);
  });
});

describe("cierre Ganada → unidad Vendida, en la misma transacción", () => {
  it.each(["available", "reserved"] as const)(
    "ganar con la unidad %s la deja vendida, con la oportunidad cerrada, y revalida la oportunidad y las vistas del stock",
    async (status) => {
      const vehicleId = await unit(ORG_1, status);
      const id = await opportunity(ORG_1, "negotiating", vehicleId);
      const before = await row(vehicleId);
      request(USER_A);

      expect(await close(id)).toEqual({
        status: "closed",
        opportunityId: id,
        from: "negotiating",
        to: "won",
      });
      expect(mocks.revalidated).toEqual([
        `/opportunities/${id}`,
        ...LIFECYCLE_PATHS,
      ]);
      expect(await opportunityRow(id)).toMatchObject({
        stage: "won",
        vehicleId,
        salePrice: "47500.00",
      });
      const after = await row(vehicleId);
      expect(after).toEqual({
        ...before,
        status: "sold",
        updatedAt: expect.any(Date),
      });
      expect(after!.updatedAt.getTime()).toBeGreaterThan(
        before!.updatedAt.getTime(),
      );
    },
  );

  it.each([
    ["sold", "sold", "already_sold"],
    ["in_preparation", "inPreparation", "in_preparation"],
  ] as const)(
    "ganar con la unidad %s es vehicle_conflict: no se escribe nada, ni la oportunidad",
    async (status, current, reason) => {
      // Escenarios que la aplicación ya no produce (DEC-033 §2 vincula solo
      // disponibles): los arma el superusuario.
      const vehicleId = await unit(ORG_1, status);
      const id = await opportunity(ORG_1, "negotiating", vehicleId);
      const before = await opportunityRow(id);
      const vehicleBefore = await row(vehicleId);
      request(USER_C, ORG_1);

      expect(await close(id)).toEqual({
        status: "vehicle_conflict",
        opportunityId: id,
        current,
        reason,
      });
      expect(await opportunityRow(id)).toEqual(before);
      expect(await row(vehicleId)).toEqual(vehicleBefore);
      // La unidad pudo cambiar desde que se abrió el formulario: las páginas
      // vuelven con el estado real.
      expect(mocks.revalidated).toEqual([
        `/opportunities/${id}`,
        ...LIFECYCLE_PATHS,
      ]);
    },
  );

  it("perder no toca el stock: una unidad reservada sigue reservada", async () => {
    const vehicleId = await unit(ORG_1, "reserved");
    const id = await opportunity(ORG_1, "negotiating", vehicleId);
    const before = await row(vehicleId);
    request(USER_A);
    expect(
      await close(id, { outcome: "lost", lossReason: "price", lossNotes: "" }),
    ).toMatchObject({ status: "closed", to: "lost" });
    expect(await row(vehicleId)).toEqual(before);
  });

  it("una venta no se deshace: la unidad vendida no vuelve a Stock por ninguna puerta", async () => {
    const vehicleId = await unit(ORG_1, "reserved");
    const id = await opportunity(ORG_1, "negotiating", vehicleId);
    request(USER_A);
    await close(id);
    expect(await statusOf(vehicleId)).toBe("sold");
    for (const transition of STOCK_TRANSITION_IDS) {
      request(USER_A);
      expect(await change(vehicleId, transition)).toMatchObject({
        status: "conflict",
        current: "sold",
      });
    }
    await expect(
      asOwner(
        (sql) =>
          sql`UPDATE public.vehicles SET status = 'available' WHERE id = ${vehicleId}`,
      ),
    ).rejects.toMatchObject({ constraint_name: "vehicles_status_transition" });
    expect(await statusOf(vehicleId)).toBe("sold");
  });

  /*
   * Defensa en profundidad (propuesta DEC-051 §4): la base exige la venta
   * aunque el código no pase por el dominio.
   */
  it("ganar sin vender la unidad falla al COMMIT (opportunities_won_vehicle_sold) y revierte todo", async () => {
    const vehicleId = await unit(ORG_1, "available");
    const id = await opportunity(ORG_1, "negotiating", vehicleId);
    const before = await opportunityRow(id);
    // El constraint trigger corre en el COMMIT: el error llega del driver,
    // sin el envoltorio de una query de Drizzle.
    await expect(
      withTenant(ctxA(), (tx) =>
        tx
          .update(opportunities)
          .set({ stage: "won", ...WON_METADATA })
          .where(eq(opportunities.id, id)),
      ),
    ).rejects.toMatchObject({
      code: "23514",
      constraint_name: "opportunities_won_vehicle_sold",
    });
    expect(await opportunityRow(id)).toEqual(before);
    expect(await statusOf(vehicleId)).toBe("available");
    // Tampoco el rol dueño.
    await expect(
      asOwner((sql) =>
        sql.begin(
          (tx) => tx`
            UPDATE public.opportunities SET stage = 'won',
              sale_price = 47500, sale_currency = 'USD',
              payment_method = 'cash', delivery_status = 'delivered',
              delivery_date = '2026-10-01'
            WHERE id = ${id}
          `,
        ),
      ),
    ).rejects.toMatchObject({
      code: "23514",
      constraint_name: "opportunities_won_vehicle_sold",
    });
    expect(await opportunityRow(id)).toEqual(before);
  });

  it("en el orden del cierre (oportunidad, después unidad) la base acepta la venta; al revés, la rechaza", async () => {
    const reversed = await unit(ORG_1, "available");
    const first = await opportunity(ORG_1, "negotiating", reversed);
    await expectSqlError(
      withTenant(ctxA(), async (tx) => {
        await tx
          .update(vehicles)
          .set({ status: "sold" })
          .where(eq(vehicles.id, reversed));
        await tx
          .update(opportunities)
          .set({ stage: "won", ...WON_METADATA })
          .where(eq(opportunities.id, first));
      }),
      "23514",
      "vehicles_sale_requires_won",
    );
    expect(await statusOf(reversed)).toBe("available");

    const inOrder = await unit(ORG_1, "reserved");
    const second = await opportunity(ORG_1, "negotiating", inOrder);
    await withTenant(ctxA(), async (tx) => {
      await tx
        .update(opportunities)
        .set({ stage: "won", ...WON_METADATA })
        .where(eq(opportunities.id, second));
      await tx
        .update(vehicles)
        .set({ status: "sold" })
        .where(eq(vehicles.id, inOrder));
    });
    expect(await opportunityRow(second)).toMatchObject({ stage: "won" });
    expect(await statusOf(inOrder)).toBe("sold");
  });

  it("el toque de actividad de una ganada no dispara la exigencia de la venta", async () => {
    const vehicleId = await unit(ORG_1, "available");
    const id = await opportunity(ORG_1, "negotiating", vehicleId);
    request(USER_A);
    await close(id);
    const won = await opportunityRow(id);
    // Una nota sobre la ganada mueve last_activity_at por el trigger de
    // actividad (DEC-036 §1), en un UPDATE de la oportunidad: el constraint
    // trigger solo mira el pase a `won`, así que la nota se registra.
    request(USER_A);
    expect(
      await addOpportunityNote(
        null,
        form({ opportunityId: id, body: "Entregada sin novedades." }),
      ),
    ).toEqual({ status: "recorded", opportunityId: id });
    expect(await opportunityRow(id)).toEqual(won);
    expect(await statusOf(vehicleId)).toBe("sold");
  });
});

/*
 * Pedidos simultáneos sobre la misma unidad. El FOR UPDATE de la unidad
 * serializa los cambios de Stock entre sí y con un cierre Ganada (que la
 * bloquea después de bloquear su oportunidad): el que llega segundo decide
 * sobre el estado ya confirmado. Nunca dos pases iguales, nunca una venta
 * deshecha, nunca dos ventas.
 */
describe("concurrencia", () => {
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
   * Retiene la unidad con otra transacción (como postgres) mientras corre
   * `start`; `hold` decide qué hace esa transacción antes de soltarla.
   */
  async function whileUnitIsHeld<T>(
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

  it("admin y seller reservan a la vez (dos pedidos cada uno): exactamente un pase, los demás unchanged", async () => {
    const id = await unit(ORG_1, "available");
    const contexts = [ctxA(), tenantContext(USER_C, ORG_1), ctxA()];
    const results = await whileUnitIsHeld(
      id,
      async () => {},
      () =>
        Promise.all(
          contexts.map((ctx) =>
            transitionVehicleStatus(ctx, {
              vehicleId: id,
              transition: "reserve",
            }),
          ),
        ),
      contexts.length,
    );
    expect(results.filter((r) => r.outcome === "changed")).toHaveLength(1);
    expect(results.filter((r) => r.outcome === "unchanged")).toEqual([
      expect.objectContaining({ status: "reserved" }),
      expect.objectContaining({ status: "reserved" }),
    ]);
    expect(await statusOf(id)).toBe("reserved");
  });

  it("si otra transacción la pone en el salón y la reserva mientras el pedido de poner en salón espera, no la libera: conflict", async () => {
    const id = await unit(ORG_1, "in_preparation");
    const result = await whileUnitIsHeld(
      id,
      async (tx) => {
        await tx`UPDATE public.vehicles SET status = 'available' WHERE id = ${id}`;
        await tx`UPDATE public.vehicles SET status = 'reserved' WHERE id = ${id}`;
      },
      () =>
        transitionVehicleStatus(ctxA(), {
          vehicleId: id,
          transition: "put_on_floor",
        }),
      1,
    );
    expect(result).toMatchObject({ outcome: "conflict", current: "reserved" });
    expect(await statusOf(id)).toBe("reserved");
  });

  it("por la Server Action, reservar y liberar a la vez sobre una disponible: queda un estado coherente", async () => {
    const id = await unit(ORG_1, "available");
    request(USER_A);
    const results = await whileUnitIsHeld(
      id,
      async () => {},
      () => Promise.all([change(id, "reserve"), change(id, "release")]),
      2,
    );
    const statuses = results.map((result) => result?.status).sort();
    // El orden lo decide el lock: o se reserva y después se libera (dos
    // pases), o liberar llega primero (unchanged: ya estaba disponible) y
    // después se reserva.
    expect([
      ["changed", "changed"],
      ["changed", "unchanged"],
    ]).toContainEqual(statuses);
    expect(["available", "reserved"]).toContain(await statusOf(id));
  });

  it("ganar y liberar la reserva a la vez: la unidad termina vendida, nunca disponible", async () => {
    const vehicleId = await unit(ORG_1, "reserved");
    const id = await opportunity(ORG_1, "negotiating", vehicleId);
    const [won, released] = await whileUnitIsHeld(
      vehicleId,
      async () => {},
      () =>
        Promise.all([
          closeOpportunityWithMetadata(ctxA(), {
            opportunityId: id,
            closure: WON,
          }),
          transitionVehicleStatus(tenantContext(USER_C, ORG_1), {
            vehicleId,
            transition: "release",
          }),
        ]),
      2,
    );
    expect(won).toMatchObject({ outcome: "closed", to: "won" });
    // Liberar llegó antes (y el cierre vendió la disponible) o después (y
    // la unidad ya estaba vendida: conflicto).
    expect(["changed", "conflict"]).toContain(released.outcome);
    expect(await statusOf(vehicleId)).toBe("sold");
    expect(await opportunityRow(id)).toMatchObject({ stage: "won" });
  });

  it("dos ganadas con la misma unidad a la vez: una cierra y vende, la otra es vehicle_conflict y no se escribe", async () => {
    const vehicleId = await unit(ORG_1, "available");
    const first = await opportunity(ORG_1, "negotiating", vehicleId);
    const second = await opportunity(ORG_1, "negotiating", vehicleId);
    const results = await whileUnitIsHeld(
      vehicleId,
      async () => {},
      () =>
        Promise.all(
          [first, second].map((opportunityId) =>
            closeOpportunityWithMetadata(ctxA(), {
              opportunityId,
              closure: WON,
            }),
          ),
        ),
      2,
    );
    expect(results.map((r) => r.outcome).sort()).toEqual([
      "closed",
      "vehicle_conflict",
    ]);
    expect(results.find((r) => r.outcome === "vehicle_conflict")).toEqual(
      expect.objectContaining({ current: "sold", reason: "already_sold" }),
    );
    const stages = [
      (await opportunityRow(first)).stage,
      (await opportunityRow(second)).stage,
    ].sort();
    expect(stages).toEqual(["negotiating", "won"]);
    expect(await statusOf(vehicleId)).toBe("sold");
  });
});

describe("Stock y Catálogo reflejan el ciclo de vida", () => {
  it("reservar mueve la unidad a Reservadas en el Inventario y a su filtro en el Catálogo; ganar, a Vendidas; solo en su organización", async () => {
    const vehicleId = await unit(ORG_1, "available");
    const id = await opportunity(ORG_1, "negotiating", vehicleId);
    request(USER_B);
    const otherBefore = await getStockList();

    const groupOf = async () => {
      request(USER_A);
      const stock = await getStockList();
      return groupByStatus(stock).find((group) =>
        group.vehicles.some((vehicle) => vehicle.id === vehicleId),
      )?.status;
    };
    const catalogStatus = async () => {
      request(USER_A);
      return (await getStockCatalog()).vehicles.find(
        (vehicle) => vehicle.id === vehicleId,
      )?.status;
    };

    expect(await groupOf()).toBe("available");
    request(USER_A);
    await change(vehicleId, "reserve");
    expect(await groupOf()).toBe("reserved");
    expect(await catalogStatus()).toBe("reserved");

    request(USER_A);
    await close(id);
    expect(await groupOf()).toBe("sold");
    expect(await catalogStatus()).toBe("sold");

    request(USER_B);
    expect(await getStockList()).toEqual(otherBefore);
  });
});
