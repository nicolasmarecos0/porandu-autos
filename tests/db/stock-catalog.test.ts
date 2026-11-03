import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import {
  CATALOG_VEHICLE_LIMIT,
  getStockCatalog,
} from "@/db/queries/stock-catalog";
import type { TenantContext } from "@/db/tenant";
import { ACTIVE_ORGANIZATION_COOKIE } from "@/lib/tenant/cookie";

import { cookieJar, type CookieJar } from "../unit/support/cookie-jar";
import { seedOpportunities } from "./support/opportunities";
import {
  runMigrations,
  startTestServer,
  type TestDatabase,
  type TestServer,
} from "./support/postgres";
import { closeRuntimePool } from "./support/runtime";
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
import { seedVehicles, VEHICLES } from "./support/vehicles";

/*
 * Catálogo visual del stock (propuesta DEC-049), de punta a punta contra
 * PostgreSQL con las migraciones aplicadas:
 *
 *   request → requireTenant() → withTenant() → lecturas con filtro
 *   explícito por organización → RLS → ViewModel del catálogo
 *
 * El loader es el real (db/queries/stock-catalog.ts), conectado como
 * app_runtime. Supabase Auth (claims ya verificados), la cookie y el
 * redirect de Next son simulados, como en vehicles.test.ts.
 *
 * Datos: los vehículos de support/vehicles.ts más una vendida reciente en
 * ORG_1, las oportunidades de support/opportunities.ts, ORG_4 sin unidades
 * (F) y ORG_5 con más unidades que el tope (G).
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
const ORG_5 = "00000000-0000-4000-8000-000000000005";
const USER_F = "00000000-0000-4000-8000-00000000000f";
const USER_G = "00000000-0000-4000-8000-000000000010";

/** Vendida en ORG_1, la de ingreso más reciente: igual va al final. */
const RECENT_SOLD = "20000000-0000-4000-8000-000000000199";

/** Ids de support/vehicles.ts. */
const HILUX = VEHICLES[0]!.id;
const HB20 = VEHICLES[1]!.id;
const COROLLA_CROSS = VEHICLES[2]!.id;
const SPORTAGE = VEHICLES[3]!.id;
const FRONTIER = VEHICLES[4]!.id;
const L200 = VEHICLES[5]!.id;

/** Ids de support/opportunities.ts. */
const opportunity = (n: number) =>
  `10000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

let server: TestServer;
let db: TestDatabase;

beforeAll(async () => {
  server = await startTestServer();
  db = await server.createDatabase();
  await runMigrations(db.migrationUrl);
  await seedTenants(db.admin);
  await seedVehicles(db.admin);
  await seedOpportunities(db.admin);
  await db.admin.begin(async (tx) => {
    await tx`
      INSERT INTO public.vehicles
        (id, organization_id, brand, model, year, status, created_at, updated_at)
      VALUES
        (${RECENT_SOLD}, ${ORG_1}, 'Chevrolet', 'S10', 2020, 'sold',
         '2026-10-02T12:00:00Z', '2026-10-02T12:00:00Z')
    `;
    for (const [user, org, name] of [
      [USER_F, ORG_4, "Organización 4"],
      [USER_G, ORG_5, "Organización 5"],
    ] as const) {
      await tx`INSERT INTO auth.users (id) VALUES (${user})`;
      await tx`INSERT INTO public.profiles (id) VALUES (${user})`;
      await tx`INSERT INTO public.organizations (id, name) VALUES (${org}, ${name})`;
      await tx`
        INSERT INTO public.memberships (organization_id, user_id, role)
        VALUES (${org}, ${user}, 'seller')
      `;
    }
    // ORG_5: el tope en unidades disponibles y 3 vendidas más nuevas.
    await tx`
      INSERT INTO public.vehicles
        (organization_id, brand, model, year, status, created_at, updated_at)
      SELECT ${ORG_5}, 'Toyota', 'Etios ' || n, 2020, 'available',
             timestamptz '2026-01-01T00:00:00Z' + n * interval '1 minute',
             timestamptz '2026-01-01T00:00:00Z' + n * interval '1 minute'
      FROM generate_series(1, ${CATALOG_VEHICLE_LIMIT}) AS n
    `;
    await tx`
      INSERT INTO public.vehicles
        (organization_id, brand, model, year, status, created_at, updated_at)
      SELECT ${ORG_5}, 'Toyota', 'Vendida ' || n, 2018, 'sold',
             timestamptz '2026-10-01T00:00:00Z' + n * interval '1 minute',
             timestamptz '2026-10-01T00:00:00Z' + n * interval '1 minute'
      FROM generate_series(1, 3) AS n
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

async function redirectOf(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof mocks.RedirectSignal) return error.path;
    throw error;
  }
  throw new Error("expected a redirect");
}

async function catalogIds(): Promise<string[]> {
  return (await getStockCatalog()).vehicles.map((vehicle) => vehicle.id);
}

describe("loader real: requireTenant() → withTenant() → RLS", () => {
  it("A (ORG_1): stock primero y vendidas al final; la unidad en preparación se cuenta, no se muestra", async () => {
    request(USER_A);
    const catalog = await getStockCatalog();

    expect(catalog.vehicles.map((vehicle) => vehicle.id)).toEqual([
      HILUX,
      COROLLA_CROSS,
      RECENT_SOLD,
    ]);
    expect(catalog.vehicles.map((vehicle) => vehicle.id)).not.toContain(HB20);
    expect(catalog.total).toBe(3);
    expect(catalog.inPreparation).toBe(1);
    expect(catalog.vehicles[0]).toStrictEqual({
      id: HILUX,
      brand: "Toyota",
      model: "Hilux",
      version: "SRV 2.8 4x4 AT",
      year: 2025,
      km: 0,
      price: { amount: "49900.00", currency: "USD" },
      status: "available",
    });
    // Sin versión, km ni precio: sin dato, nada inventado.
    expect(catalog.vehicles[2]).toStrictEqual({
      id: RECENT_SOLD,
      brand: "Chevrolet",
      model: "S10",
      year: 2020,
      status: "sold",
    });
  });

  it("A (ORG_1): solo puede cotizarle a oportunidades En calificación o En negociación, de la más activa a la menos", async () => {
    request(USER_A);
    expect((await getStockCatalog()).quoteCustomers).toEqual([
      {
        opportunityId: opportunity(101),
        contactName: "Ramón Benítez",
        stage: "qualifying",
      },
      {
        opportunityId: opportunity(103),
        contactName: "Ramón Benítez",
        stage: "qualifying",
      },
    ]);
  });

  it("B (ORG_2) ve solo lo suyo, con el precio exacto y la vendida incluida", async () => {
    request(USER_B);
    const catalog = await getStockCatalog();
    expect(catalog.vehicles.map((vehicle) => vehicle.id)).toEqual([
      SPORTAGE,
      FRONTIER,
    ]);
    expect(catalog.vehicles.map((vehicle) => vehicle.price)).toEqual([
      { amount: "245000000.00", currency: "PYG" },
      { amount: "32990.50", currency: "USD" },
    ]);
    expect(catalog.inPreparation).toBe(0);
    expect(catalog.quoteCustomers).toEqual([
      {
        opportunityId: opportunity(201),
        contactName: "Fátima Giménez",
        stage: "negotiating",
      },
    ]);
  });

  it("C ve solo la organización activa, aunque RLS le deje ver otra (filtro explícito)", async () => {
    request(USER_C, ORG_1);
    expect(await catalogIds()).toEqual([HILUX, COROLLA_CROSS, RECENT_SOLD]);

    request(USER_C, ORG_3);
    const catalog = await getStockCatalog();
    expect(catalog.vehicles.map((vehicle) => vehicle.id)).toEqual([L200]);
    expect(catalog.quoteCustomers.map((c) => c.opportunityId)).toEqual([
      opportunity(301),
    ]);

    request(USER_C, ORG_2);
    expect(await redirectOf(catalogIds())).toBe("/select-organization");
  });

  it("una organización sin unidades ni oportunidades devuelve un catálogo vacío válido", async () => {
    request(USER_F);
    expect(await getStockCatalog()).toEqual({
      vehicles: [],
      total: 0,
      inPreparation: 0,
      quoteCustomers: [],
    });
  });

  it("con más unidades que el tope, quedan afuera las vendidas, nunca el stock", async () => {
    request(USER_G);
    const catalog = await getStockCatalog();
    expect(catalog.vehicles).toHaveLength(CATALOG_VEHICLE_LIMIT);
    expect(catalog.total).toBe(CATALOG_VEHICLE_LIMIT + 3);
    expect(catalog.vehicles.every((v) => v.status === "available")).toBe(true);
    // Del ingreso más reciente al más viejo.
    expect(catalog.vehicles[0]?.model).toBe(`Etios ${CATALOG_VEHICLE_LIMIT}`);
    expect(catalog.vehicles.at(-1)?.model).toBe("Etios 1");
  });

  it("sin sesión, sin memberships o con la membership inactiva, no llega a la base", async () => {
    request(null);
    expect(await redirectOf(catalogIds())).toBe("/login");
    request(USER_D);
    expect(await redirectOf(catalogIds())).toBe("/no-access");
    request(USER_E);
    expect(await redirectOf(catalogIds())).toBe("/no-access");
  });

  it("un contexto falsificado (A-03) no ve nada de la otra organización", async () => {
    // El filtro explícito pide ORG_2; RLS solo le deja ver ORG_1 a A.
    request(null);
    mocks.forged = tenantContext(USER_A, ORG_2);
    try {
      expect(await getStockCatalog()).toEqual({
        vehicles: [],
        total: 0,
        inPreparation: 0,
        quoteCustomers: [],
      });
    } finally {
      mocks.forged = null;
    }
  });
});
