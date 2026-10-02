import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { getStockList } from "@/db/queries/vehicles";
import { vehicles } from "@/db/schema";
import { withTenant, type TenantContext } from "@/db/tenant";
import { ACTIVE_ORGANIZATION_COOKIE } from "@/lib/tenant/cookie";

import { cookieJar, type CookieJar } from "../unit/support/cookie-jar";
import { policies, tablePrivileges, tenancy } from "./support/catalog";
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
import { seedVehicles, VEHICLES, vehicleIdsOf } from "./support/vehicles";

/*
 * Stock List con datos reales (H1.3A), de punta a punta contra
 * PostgreSQL 17 con las migraciones aplicadas:
 *
 *   request → requireTenant() → withTenant() → query con filtro explícito
 *   → RLS → ViewModel
 *
 * El loader es el real (db/queries/vehicles.ts), conectado como
 * app_runtime. Supabase Auth (claims ya verificados), la cookie y el
 * redirect de Next son simulados, como en opportunities.test.ts.
 *
 * Tenants (support/tenants.ts y support/vehicles.ts):
 *   A: admin de ORG_1 · B: admin de ORG_2 · C: ORG_1 y ORG_3 activas, ORG_2
 *   inactiva · D: solo inactiva en ORG_1 · E: sin memberships · F: única
 *   membership en ORG_4, que no tiene vehículos.
 *   ORG_1: 3 vehículos · ORG_2: 2 · ORG_3: 1 · ORG_4: 0.
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
// requireTenant() es el real salvo cuando un test fuerza un contexto.
vi.mock("@/lib/tenant/session", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/tenant/session")>();
  return {
    ...actual,
    requireTenant: async () =>
      (mocks.forged as TenantContext | null) ?? actual.requireTenant(),
  };
});

const ORG_4 = "00000000-0000-4000-8000-000000000004";
const USER_F = "00000000-0000-4000-8000-00000000000f";

let server: TestServer;
let db: TestDatabase;

beforeAll(async () => {
  server = await startTestServer();
  db = await server.createDatabase();
  await runMigrations(db.migrationUrl);
  await seedTenants(db.admin);
  await seedVehicles(db.admin);
  await db.admin.begin(async (tx) => {
    await tx`INSERT INTO auth.users (id) VALUES (${USER_F})`;
    await tx`INSERT INTO public.profiles (id) VALUES (${USER_F})`;
    await tx`INSERT INTO public.organizations (id, name) VALUES (${ORG_4}, 'Organización 4')`;
    await tx`
      INSERT INTO public.memberships (organization_id, user_id, role)
      VALUES (${ORG_4}, ${USER_F}, 'seller')
    `;
  });
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

/** Ids que devuelve el loader real para la request actual. */
async function stockIds(): Promise<string[]> {
  return (await getStockList()).map((vehicle) => vehicle.id);
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

/** Contexto que Tenant Resolution no habría emitido para esta request. */
async function forgedStockIds(ctx: TenantContext): Promise<string[]> {
  request(null);
  mocks.forged = ctx;
  try {
    return await stockIds();
  } finally {
    mocks.forged = null;
  }
}

const NEW_VEHICLE = {
  brand: "Ford",
  model: "Ranger",
  year: 2024,
  status: "available" as const,
};

describe("loader real: requireTenant() → withTenant() → RLS", () => {
  it("A (ORG_1) ve solo los vehículos de ORG_1, en orden y mapeados al ViewModel", async () => {
    request(USER_A);
    const stock = await getStockList();

    expect(stock.map((vehicle) => vehicle.id)).toEqual(vehicleIdsOf(ORG_1));
    expect(stock).toStrictEqual([
      {
        id: VEHICLES[0]!.id,
        brand: "Toyota",
        model: "Hilux",
        version: "SRV 2.8 4x4 AT",
        year: 2025,
        km: 0,
        price: { amount: "49900.00", currency: "USD" },
        status: "available",
      },
      // Mismo ingreso que la HB20: el id desempata.
      {
        id: VEHICLES[2]!.id,
        brand: "Toyota",
        model: "Corolla Cross",
        version: "XEI Hybrid 1.8",
        year: 2023,
        km: 48000,
        price: { amount: "28290.00", currency: "USD" },
        status: "reserved",
      },
      // Sin versión, km ni precio: sin dato, nada inventado.
      {
        id: VEHICLES[1]!.id,
        brand: "Hyundai",
        model: "HB20",
        year: 2019,
        status: "inPreparation",
      },
    ]);
  });

  it("B (ORG_2) ve solo los vehículos de ORG_2, con el precio exacto de la base", async () => {
    request(USER_B);
    const stock = await getStockList();
    expect(stock.map((vehicle) => vehicle.id)).toEqual(vehicleIdsOf(ORG_2));
    expect(stock.map((vehicle) => vehicle.price)).toEqual([
      { amount: "245000000.00", currency: "PYG" },
      { amount: "32990.50", currency: "USD" },
    ]);
  });

  it("C con ORG_1 activa ve solo ORG_1, aunque RLS también le deja ver ORG_3 (filtro explícito)", async () => {
    request(USER_C, ORG_1);
    expect(await stockIds()).toEqual(vehicleIdsOf(ORG_1));
  });

  it("C con ORG_3 activa ve solo ORG_3, nunca ORG_2 (membership inactiva)", async () => {
    request(USER_C, ORG_3);
    expect(await stockIds()).toEqual(vehicleIdsOf(ORG_3));

    request(USER_C, ORG_2);
    expect(await redirectOf(stockIds())).toBe("/select-organization");
  });

  it("una organización sin vehículos devuelve una lista vacía válida", async () => {
    request(USER_F);
    expect(await getStockList()).toEqual([]);
  });

  it("sin sesión, sin memberships o con la membership inactiva, no llega a la base", async () => {
    request(null);
    expect(await redirectOf(stockIds())).toBe("/login");
    request(USER_D);
    expect(await redirectOf(stockIds())).toBe("/no-access");
    request(USER_E);
    expect(await redirectOf(stockIds())).toBe("/no-access");
  });

  it("una cookie con una organización ajena no cruza tenants", async () => {
    request(USER_A, ORG_2);
    expect(await stockIds()).toEqual(vehicleIdsOf(ORG_1));
  });

  it("revocar la membership corta el acceso desde el request siguiente (A-09)", async () => {
    const setActive = (active: boolean) => db.admin`
      UPDATE public.memberships SET active = ${active}
      WHERE organization_id = ${ORG_1} AND user_id = ${USER_A}
    `;
    request(USER_A);
    expect(await stockIds()).toEqual(vehicleIdsOf(ORG_1));
    await setActive(false);
    try {
      request(USER_A);
      expect(await redirectOf(stockIds())).toBe("/no-access");
      // Aun con un contexto emitido antes, RLS ya no deja ver nada.
      expect(await forgedStockIds(tenantContext(USER_A, ORG_1))).toEqual([]);
    } finally {
      await setActive(true);
    }
  });
});

describe("contexto falsificado (A-03)", () => {
  it("A con ORG_2 no ve vehículos de ORG_2 ni de ORG_1", async () => {
    // El filtro explícito pide ORG_2; RLS solo deja ver ORG_1.
    expect(await forgedStockIds(tenantContext(USER_A, ORG_2))).toEqual([]);
  });

  it("B con ORG_1 no ve vehículos de ORG_1", async () => {
    expect(await forgedStockIds(tenantContext(USER_B, ORG_1))).toEqual([]);
  });

  it("C con ORG_2 (membership inactiva) no ve ORG_2", async () => {
    expect(await forgedStockIds(tenantContext(USER_C, ORG_2))).toEqual([]);
  });
});

describe("fuera de withTenant() falla cerrado (C2)", () => {
  it("app_runtime sin el boundary no lee ni escribe vehicles (42501)", async () => {
    const pool = runtimePool();
    await expect(pool`SELECT * FROM public.vehicles`).rejects.toMatchObject({
      code: "42501",
    });
    await expect(
      pool`INSERT INTO public.vehicles (organization_id, brand, model, year, status) VALUES (${ORG_1}, 'Ford', 'Ranger', 2024, 'available')`,
    ).rejects.toMatchObject({ code: "42501" });
  });

  it("authenticated sin claims no ve ninguna fila", async () => {
    await runtimePool().begin(async (tx) => {
      await tx`SELECT set_config('role', 'authenticated', true)`;
      expect(await tx`SELECT * FROM public.vehicles`).toHaveLength(0);
    });
  });

  it("RESET ROLE dentro del boundary vuelve a app_runtime, que no lee nada", async () => {
    await expectSqlError(
      withTenant(tenantContext(USER_A, ORG_1), async (tx) => {
        await tx.execute(sql`RESET ROLE`);
        return tx.select().from(vehicles);
      }),
      "42501",
    );
  });

  it("por withTenant() nadie da de alta, modifica ni borra vehículos, ni en su propia organización (H1.3A)", async () => {
    const ctx = tenantContext(USER_A, ORG_1);
    const own = VEHICLES[0]!;
    for (const organizationId of [ORG_1, ORG_2]) {
      await expectSqlError(
        withTenant(ctx, (tx) =>
          tx.insert(vehicles).values({ ...NEW_VEHICLE, organizationId }),
        ),
        "42501",
      );
    }
    await expectSqlError(
      withTenant(ctx, (tx) =>
        tx
          .update(vehicles)
          .set({ status: "sold" })
          .where(eq(vehicles.id, own.id)),
      ),
      "42501",
    );
    await expectSqlError(
      withTenant(ctx, (tx) =>
        tx.delete(vehicles).where(eq(vehicles.id, own.id)),
      ),
      "42501",
    );
    request(USER_A);
    expect(await stockIds()).toEqual(vehicleIdsOf(ORG_1));
  });
});

/*
 * Mutaciones puntuales: cada caso rompe una de las barreras y muestra que
 * los tests de arriba la detectan (el resultado cambia) y, al restaurarla,
 * vuelven a pasar. Las mutaciones de base se revierten siempre.
 */
describe("mutaciones: los tests detectan cada barrera rota", () => {
  it("sin el filtro explícito por organización, C con ORG_1 activa vería ORG_3", async () => {
    // Mutante: la misma lectura del loader, sin el WHERE por organización.
    const unfiltered = await withTenant(
      tenantContext(USER_C, ORG_1),
      async (tx) =>
        (await tx.select({ id: vehicles.id }).from(vehicles)).map(
          (row) => row.id,
        ),
    );
    expect(unfiltered.sort()).toEqual(
      [...vehicleIdsOf(ORG_1), ...vehicleIdsOf(ORG_3)].sort(),
    );
    // El loader real filtra: el test de aislamiento de C pasa.
    request(USER_C, ORG_1);
    expect(await stockIds()).toEqual(vehicleIdsOf(ORG_1));
  });

  it("con RLS desactivado, el contexto falsificado cruzaría tenants; el catálogo también lo marca", async () => {
    const forged = tenantContext(USER_A, ORG_2);
    await db.admin`ALTER TABLE public.vehicles DISABLE ROW LEVEL SECURITY`;
    try {
      expect(await forgedStockIds(forged)).toEqual(vehicleIdsOf(ORG_2));
      const withoutRls = (await tenancy(db.admin))
        .filter((t) => !t.rls)
        .map((t) => t.table);
      expect(withoutRls).toEqual(["vehicles"]);
    } finally {
      await db.admin`ALTER TABLE public.vehicles ENABLE ROW LEVEL SECURITY`;
    }
    expect(await forgedStockIds(forged)).toEqual([]);
  });

  it("con un grant directo a app_runtime, la lectura fuera del boundary deja de fallar con 42501; el catálogo lo marca", async () => {
    const pool = runtimePool();
    const outside = () => pool<{ id: string }[]>`
      SELECT id FROM public.vehicles ORDER BY id
    `;
    await db.admin`GRANT SELECT ON public.vehicles TO app_runtime`;
    try {
      // El test de C2 espera 42501: con el grant, la query ya no falla.
      // RLS todavía no devuelve filas (no hay policy para app_runtime).
      expect(await outside()).toEqual([]);
      expect(await tablePrivileges(db.admin, ["app_runtime"])).toEqual([
        "app_runtime SELECT vehicles",
      ]);
      // Con el grant y sin RLS, la lectura fuera del boundary ve todos los
      // tenants: por eso las dos barreras se prueban por separado.
      await db.admin`ALTER TABLE public.vehicles DISABLE ROW LEVEL SECURITY`;
      try {
        expect((await outside()).map((row) => row.id)).toEqual(
          VEHICLES.map((v) => v.id).sort(),
        );
      } finally {
        await db.admin`ALTER TABLE public.vehicles ENABLE ROW LEVEL SECURITY`;
      }
    } finally {
      await db.admin`REVOKE SELECT ON public.vehicles FROM app_runtime`;
    }
    await expect(outside()).rejects.toMatchObject({ code: "42501" });
    expect(await tablePrivileges(db.admin, ["app_runtime"])).toEqual([]);
  });

  it("con un INSERT habilitado por error, el alta deja de fallar; el catálogo lo marca", async () => {
    const ctx = tenantContext(USER_A, ORG_1);
    const insert = () =>
      withTenant(ctx, (tx) =>
        tx
          .insert(vehicles)
          .values({ ...NEW_VEHICLE, organizationId: ORG_1 })
          .returning({ id: vehicles.id }),
      );
    await db.admin.unsafe(`
      GRANT INSERT ON public.vehicles TO authenticated;
      CREATE POLICY probe_insert ON public.vehicles FOR INSERT TO authenticated
        WITH CHECK (organization_id IN (SELECT private.user_org_ids()));
    `);
    let created: string | undefined;
    try {
      // El test de solo lectura espera 42501: con el grant, el alta pasa.
      created = (await insert())[0]?.id;
      expect(created).toBeDefined();
      // tenant-catalog.test.ts y verify.mts esperan solo SELECT sobre
      // vehicles y una única policy, de lectura.
      expect(
        (await tablePrivileges(db.admin, ["authenticated"])).filter((grant) =>
          grant.endsWith(" vehicles"),
        ),
      ).toEqual([
        "authenticated INSERT vehicles",
        "authenticated SELECT vehicles",
      ]);
      expect(
        (await policies(db.admin))
          .filter((policy) => policy.table === "vehicles")
          .map((policy) => policy.name),
      ).toEqual(["probe_insert", "vehicles_select_member"]);
    } finally {
      await db.admin.unsafe(`
        DROP POLICY probe_insert ON public.vehicles;
        REVOKE INSERT ON public.vehicles FROM authenticated;
      `);
      if (created) {
        await db.admin`DELETE FROM public.vehicles WHERE id = ${created}`;
      }
    }
    await expectSqlError(insert(), "42501");
    request(USER_A);
    expect(await stockIds()).toEqual(vehicleIdsOf(ORG_1));
  });
});
