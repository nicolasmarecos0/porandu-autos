import { randomUUID } from "node:crypto";

import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import {
  createVehicleInPreparation,
  type NewVehicle,
} from "@/db/queries/create-vehicle";
import { getStockList } from "@/db/queries/vehicles";
import { vehicles } from "@/db/schema";
import { withTenant, type TenantContext } from "@/db/tenant";
import { groupByStatus } from "@/domains/vehicles/stock";
import { ACTIVE_ORGANIZATION_COOKIE } from "@/lib/tenant/cookie";
import { createVehicle } from "@/lib/vehicles/actions";
import type { CreateVehicleState } from "@/lib/vehicles/new-vehicle";

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
import { seedVehicles, VEHICLES } from "./support/vehicles";

/*
 * Alta rápida de unidades (H1.3B) de punta a punta contra PostgreSQL 17 con
 * las migraciones aplicadas:
 *
 *   Server Action → requireTenant() → validación → withTenant() → INSERT →
 *   RLS (WITH CHECK) → aparece en la Stock List real, en preparación
 *
 * La acción, la escritura y el loader son los reales, conectados como
 * app_runtime. Supabase Auth (claims ya verificados), la cookie, redirect()
 * y revalidatePath() de Next son simulados, como en
 * create-opportunity.test.ts.
 *
 * Tenants (support/tenants.ts): A: admin de ORG_1 · B: admin de ORG_2 · C:
 * seller de ORG_1 y admin de ORG_3, seller inactivo de ORG_2 · D: solo
 * inactiva en ORG_1 · E: sin memberships.
 *
 * Los datos quedan committeados (withTenant() usa sus propias conexiones):
 * cada caso marca sus unidades con una versión propia.
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

let sequence = 0;

/** Una versión que ningún otro caso usó: marca las unidades de cada caso. */
function freshVersion(): string {
  sequence += 1;
  return `Prueba H1.3B ${sequence}`;
}

function form(fields: Record<string, string>): FormData {
  const data = new FormData();
  for (const [name, value] of Object.entries(fields)) data.append(name, value);
  return data;
}

function validForm(version: string, overrides: Record<string, string> = {}) {
  return form({
    brand: "Toyota",
    model: "Hilux",
    version,
    year: "2021",
    km: "142.000",
    price: "31.500",
    currency: "USD",
    ...overrides,
  });
}

function newVehicle(
  version: string,
  overrides: Partial<NewVehicle> = {},
): NewVehicle {
  return {
    brand: "Toyota",
    model: "Hilux",
    version,
    year: 2021,
    km: 142000,
    price: { amount: "31500.00", currency: "USD" },
    ...overrides,
  };
}

type VehicleRow = {
  id: string;
  organizationId: string;
  brand: string;
  model: string;
  version: string | null;
  year: number;
  km: number | null;
  price: string | null;
  currency: string | null;
  status: string;
  recent: boolean;
};

/** Unidades con esa versión, en cualquier organización (sin RLS). */
function vehiclesWithVersion(version: string) {
  return db.admin<VehicleRow[]>`
    SELECT id, organization_id AS "organizationId", brand, model, version,
      year, km, price::text AS price, currency, status,
      created_at > now() - interval '1 minute'
        AND updated_at > now() - interval '1 minute' AS recent
    FROM public.vehicles WHERE version = ${version}
    ORDER BY created_at, id
  `;
}

async function vehicleCount(): Promise<number> {
  const [row] = await db.admin<{ count: number }[]>`
    SELECT count(*)::int AS count FROM public.vehicles
  `;
  return row?.count ?? 0;
}

async function create(data: FormData): Promise<CreateVehicleState> {
  return createVehicle(null, data);
}

async function created(data: FormData) {
  const state = await create(data);
  if (state?.status !== "created") {
    throw new Error(`expected created, got ${JSON.stringify(state)}`);
  }
  return state;
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

/** Ids de la Stock List real de la request actual. */
async function stockIds(): Promise<string[]> {
  return (await getStockList()).map((vehicle) => vehicle.id);
}

describe("Server Action: requireTenant() → validación → withTenant() → INSERT", () => {
  it("admin (A) crea la unidad en su organización, en preparación, con los datos exactos, y revalida /stock", async () => {
    const version = freshVersion();
    request(USER_A);
    const state = await created(validForm(version));

    expect(state).toEqual({
      status: "created",
      vehicleId: expect.any(String),
      brand: "Toyota",
      model: "Hilux",
      year: 2021,
    });
    expect(mocks.revalidated).toEqual(["/stock"]);
    expect(await vehiclesWithVersion(version)).toEqual([
      {
        id: state.vehicleId,
        organizationId: ORG_1,
        brand: "Toyota",
        model: "Hilux",
        version,
        year: 2021,
        km: 142000,
        price: "31500.00",
        currency: "USD",
        status: "in_preparation",
        recent: true,
      },
    ]);
  });

  it("seller (C con ORG_1 activa) también da de alta, en ORG_1", async () => {
    const version = freshVersion();
    request(USER_C, ORG_1);
    const { vehicleId } = await created(validForm(version));
    expect(await vehiclesWithVersion(version)).toEqual([
      expect.objectContaining({
        id: vehicleId,
        organizationId: ORG_1,
        status: "in_preparation",
      }),
    ]);
  });

  it("C con ORG_3 activa (admin) crea en ORG_3, no en ORG_1", async () => {
    const version = freshVersion();
    request(USER_C, ORG_3);
    await created(validForm(version));
    expect(
      (await vehiclesWithVersion(version)).map((v) => v.organizationId),
    ).toEqual([ORG_3]);
  });

  it("la unidad aparece en la Stock List real de su organización, primera en preparación, y solo ahí", async () => {
    const version = freshVersion();
    request(USER_A);
    const { vehicleId } = await created(
      validForm(version, { brand: "Ford", model: "Ranger", year: "2024" }),
    );

    request(USER_A);
    const stock = await getStockList();
    expect(stock.find((vehicle) => vehicle.id === vehicleId)).toStrictEqual({
      id: vehicleId,
      brand: "Ford",
      model: "Ranger",
      version,
      year: 2024,
      km: 142000,
      price: { amount: "31500.00", currency: "USD" },
      status: "inPreparation",
    });
    // La más reciente de su grupo: el loader ordena por ingreso.
    const inPreparation = groupByStatus(stock).find(
      (group) => group.status === "inPreparation",
    );
    expect(inPreparation?.vehicles[0]?.id).toBe(vehicleId);

    // C también es miembro de ORG_1; B (ORG_2) y C con ORG_3 no la ven.
    request(USER_C, ORG_1);
    expect(await stockIds()).toContain(vehicleId);
    request(USER_B);
    expect(await stockIds()).not.toContain(vehicleId);
    request(USER_C, ORG_3);
    expect(await stockIds()).not.toContain(vehicleId);
  });

  it("solo marca, modelo y año: versión, km y precio quedan sin dato", async () => {
    request(USER_A);
    const { vehicleId } = await created(
      form({ brand: "Hyundai", model: "Creta", year: "2020" }),
    );
    const [row] = await db.admin<
      Pick<VehicleRow, "version" | "km" | "price" | "currency" | "status">[]
    >`
      SELECT version, km, price::text AS price, currency, status
      FROM public.vehicles WHERE id = ${vehicleId}
    `;
    expect(row).toEqual({
      version: null,
      km: null,
      price: null,
      currency: null,
      status: "in_preparation",
    });

    request(USER_A);
    expect(
      (await getStockList()).find((vehicle) => vehicle.id === vehicleId),
    ).toStrictEqual({
      id: vehicleId,
      brand: "Hyundai",
      model: "Creta",
      year: 2020,
      status: "inPreparation",
    });
  });

  it("km 0 es una unidad 0 km (no sin dato) y el precio en guaraníes queda exacto", async () => {
    const version = freshVersion();
    request(USER_A);
    await created(
      validForm(version, {
        km: "0",
        price: "150.000.000",
        currency: "PYG",
      }),
    );
    expect(await vehiclesWithVersion(version)).toEqual([
      expect.objectContaining({
        km: 0,
        price: "150000000.00",
        currency: "PYG",
      }),
    ]);
  });

  it("un precio en dólares con centavos se guarda exacto, sin pasar por float", async () => {
    const version = freshVersion();
    request(USER_A);
    await created(validForm(version, { price: "999.999.999.999,99" }));
    expect(await vehiclesWithVersion(version)).toEqual([
      expect.objectContaining({ price: "999999999999.99", currency: "USD" }),
    ]);
  });

  it("sin sesión o sin membership activa no llega a la base", async () => {
    const version = freshVersion();
    const before = await vehicleCount();
    for (const [userId, path] of [
      [null, "/login"],
      [USER_D, "/no-access"],
      [USER_E, "/no-access"],
    ] as const) {
      request(userId);
      expect(await redirectOf(create(validForm(version)))).toBe(path);
    }
    // Una cookie con una organización donde la membership está inactiva
    // tampoco elige organización.
    request(USER_C, ORG_2);
    expect(await redirectOf(create(validForm(version)))).toBe(
      "/select-organization",
    );
    expect(await vehiclesWithVersion(version)).toEqual([]);
    expect(await vehicleCount()).toBe(before);
    expect(mocks.revalidated).toEqual([]);
  });

  it.each([
    ["sin marca", { brand: "  " }, { brand: "required" }],
    ["sin modelo", { model: "" }, { model: "required" }],
    ["sin año", { year: "" }, { year: "required" }],
    [
      "año fuera del rango del schema",
      { year: "1899" },
      { year: "invalid_year" },
    ],
    ["año no entero", { year: "20.5" }, { year: "invalid_year" }],
    ["km negativo", { km: "-1" }, { km: "invalid_km" }],
    ["km con decimales", { km: "12,5" }, { km: "invalid_km" }],
    ["precio cero", { price: "0" }, { price: "invalid_price" }],
    ["precio negativo", { price: "-31.500" }, { price: "invalid_price" }],
    ["precio sin moneda", { currency: "" }, { currency: "required" }],
    ["moneda sin precio", { price: "" }, { price: "required" }],
    [
      "guaraníes con decimales",
      { price: "150.000.000,50", currency: "PYG" },
      { price: "pyg_decimals" },
    ],
    [
      "moneda fuera de la lista",
      { currency: "EUR" },
      { currency: "invalid_currency" },
    ],
    ["marca demasiado larga", { brand: "x".repeat(41) }, { brand: "too_long" }],
  ])(
    "un payload inválido (%s) no escribe y vuelve con lo cargado",
    async (_, overrides, errors) => {
      const version = freshVersion();
      request(USER_A);
      const data = validForm(version, overrides);
      const state = await create(data);
      expect(state).toEqual({
        status: "invalid",
        errors,
        values: expect.objectContaining({ version }),
      });
      expect(await vehiclesWithVersion(version)).toEqual([]);
      expect(mocks.revalidated).toEqual([]);
    },
  );

  it("organización, estado, id y timestamps del payload no tienen efecto", async () => {
    const version = freshVersion();
    const forcedId = randomUUID();
    request(USER_A);
    const state = await created(
      validForm(version, {
        organizationId: ORG_2,
        organization_id: ORG_2,
        userId: USER_B,
        status: "available",
        id: forcedId,
        createdAt: "2020-01-01T00:00:00Z",
        created_at: "2020-01-01T00:00:00Z",
        updated_at: "2020-01-01T00:00:00Z",
      }),
    );
    expect(state.vehicleId).not.toBe(forcedId);
    expect(await vehiclesWithVersion(version)).toEqual([
      expect.objectContaining({
        id: state.vehicleId,
        organizationId: ORG_1,
        status: "in_preparation",
        recent: true,
      }),
    ]);
  });

  it.each([["available"], ["reserved"], ["sold"]])(
    "el navegador no elige el estado: con status = %s nace igual en preparación",
    async (status) => {
      const version = freshVersion();
      request(USER_A);
      await created(validForm(version, { status }));
      expect((await vehiclesWithVersion(version)).map((v) => v.status)).toEqual(
        ["in_preparation"],
      );
    },
  );

  it("una cookie con una organización ajena no cambia dónde se crea (A con cookie de ORG_2 crea en ORG_1)", async () => {
    const version = freshVersion();
    request(USER_A, ORG_2);
    await created(validForm(version));
    expect(
      (await vehiclesWithVersion(version)).map((v) => v.organizationId),
    ).toEqual([ORG_1]);
  });

  it("C (ORG_1 activa) que manda ORG_3 en el payload crea en ORG_1, aunque RLS le permitiría ORG_3", async () => {
    // RLS no distingue entre organizaciones con membership activa: solo
    // tomar la organización del contexto impide elegirla desde el cliente.
    const version = freshVersion();
    request(USER_C, ORG_1);
    await created(
      validForm(version, { organizationId: ORG_3, organization_id: ORG_3 }),
    );
    expect(
      (await vehiclesWithVersion(version)).map((v) => v.organizationId),
    ).toEqual([ORG_1]);
  });

  it("un contexto falsificado (A con ORG_2) no escribe: RLS lo rechaza y el formulario queda usable", async () => {
    const version = freshVersion();
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      request(null);
      mocks.forged = tenantContext(USER_A, ORG_2);
      const state = await create(validForm(version));
      expect(state).toEqual({
        status: "failed",
        values: expect.objectContaining({ version, brand: "Toyota" }),
      });
      // Solo el tipo de error y el SQLSTATE: ni la query ni los datos.
      expect(errors).toHaveBeenCalledWith("[vehicles] create failed", {
        name: expect.any(String),
        code: "42501",
      });
      expect(JSON.stringify(errors.mock.calls)).not.toMatch(
        /Hilux|Prueba H1\.3B/,
      );
    } finally {
      errors.mockRestore();
      mocks.forged = null;
    }
    expect(await vehiclesWithVersion(version)).toEqual([]);
    expect(mocks.revalidated).toEqual([]);
  });
});

/*
 * Regla durable de alta (H1.3B): membership activa AND role IN ('admin',
 * 'seller'). Hoy membership_role contiene exactamente esos dos valores, así
 * que requireTenant() y la policy de INSERT (organización con membership
 * activa) la cumplen sin un chequeo de rol adicional. Estos tests preservan
 * la intención: si se agrega un rol, fallan y obligan a decidir si puede
 * crear unidades.
 */
const CREATE_ROLES = ["admin", "seller"];

describe("autorización: membership activa AND role IN ('admin', 'seller')", () => {
  it("membership_role contiene exactamente los roles autorizados a crear: ningún otro rol puede pasar la policy", async () => {
    const [row] = await db.admin<{ labels: string[] }[]>`
      SELECT array_agg(enumlabel::text ORDER BY enumsortorder) AS labels
      FROM pg_enum WHERE enumtypid = 'public.membership_role'::regtype
    `;
    // Un rol nuevo exige revisar createVehicle() y vehicles_insert_member.
    expect(row?.labels).toEqual(CREATE_ROLES);
  });

  it("admin y seller activos de la misma organización crean; el rol sale de la membership", async () => {
    const roles = await db.admin<{ userId: string; role: string }[]>`
      SELECT user_id AS "userId", role::text AS role FROM public.memberships
      WHERE organization_id = ${ORG_1} AND active ORDER BY role
    `;
    expect(roles).toEqual([
      { userId: USER_A, role: "admin" },
      { userId: USER_C, role: "seller" },
    ]);
    for (const { userId } of roles) {
      const version = freshVersion();
      request(userId, ORG_1);
      const { vehicleId } = await created(validForm(version));
      expect(await vehiclesWithVersion(version)).toEqual([
        expect.objectContaining({
          id: vehicleId,
          organizationId: ORG_1,
          status: "in_preparation",
        }),
      ]);
    }
  });

  it("una membership inactiva no crea, cualquiera sea su rol", async () => {
    const inactive = await db.admin<{ userId: string; orgId: string }[]>`
      SELECT user_id AS "userId", organization_id AS "orgId"
      FROM public.memberships WHERE NOT active ORDER BY user_id
    `;
    expect(inactive.length).toBeGreaterThan(0);
    for (const { userId, orgId } of inactive) {
      const version = freshVersion();
      await expectSqlError(
        createVehicleInPreparation(
          tenantContext(userId, orgId),
          newVehicle(version),
        ),
        "42501",
      );
      expect(await vehiclesWithVersion(version)).toEqual([]);
    }
  });
});

describe("aislamiento de la escritura (RLS WITH CHECK)", () => {
  it.each([
    ["A con ORG_2 (sin membership)", USER_A, ORG_2],
    ["B con ORG_1 (sin membership)", USER_B, ORG_1],
    ["C con ORG_2 (membership inactiva)", USER_C, ORG_2],
    ["D con ORG_1 (solo membership inactiva)", USER_D, ORG_1],
    ["E con ORG_1 (sin memberships)", USER_E, ORG_1],
  ])("un contexto falsificado no escribe: %s", async (_, userId, orgId) => {
    const version = freshVersion();
    await expectSqlError(
      createVehicleInPreparation(
        tenantContext(userId, orgId),
        newVehicle(version),
      ),
      "42501",
    );
    expect(await vehiclesWithVersion(version)).toEqual([]);
  });

  it("revocar la membership corta la escritura, aun con un contexto viejo (A-09)", async () => {
    const ctx = tenantContext(USER_A, ORG_1);
    const setActive = (active: boolean) => db.admin`
      UPDATE public.memberships SET active = ${active}
      WHERE organization_id = ${ORG_1} AND user_id = ${USER_A}
    `;
    const version = freshVersion();
    await setActive(false);
    try {
      await expectSqlError(
        createVehicleInPreparation(ctx, newVehicle(version)),
        "42501",
      );
    } finally {
      await setActive(true);
    }
    expect(await vehiclesWithVersion(version)).toEqual([]);
    await createVehicleInPreparation(ctx, newVehicle(version));
    expect(await vehiclesWithVersion(version)).toHaveLength(1);
  });

  it("dentro del boundary, un organization_id ajeno explícito se rechaza, aun en preparación", async () => {
    const version = freshVersion();
    for (const organizationId of [ORG_2, ORG_3]) {
      await expectSqlError(
        withTenant(tenantContext(USER_A, ORG_1), (tx) =>
          tx.insert(vehicles).values({
            organizationId,
            brand: "Intrusa",
            model: "X",
            version,
            year: 2024,
            status: "in_preparation",
          }),
        ),
        "42501",
      );
    }
    expect(await vehiclesWithVersion(version)).toEqual([]);
  });

  it("una unidad creada en ORG_1 no es visible para B, ni para contextos falsificados, ni en la Stock List de C con ORG_3", async () => {
    const { id } = await createVehicleInPreparation(
      tenantContext(USER_A, ORG_1),
      newVehicle(freshVersion()),
    );
    // Por id, sin filtro de organización: solo RLS.
    for (const ctx of [
      tenantContext(USER_B, ORG_2),
      tenantContext(USER_B, ORG_1),
      tenantContext(USER_D, ORG_1),
      tenantContext(USER_E, ORG_1),
    ]) {
      const rows = await withTenant(ctx, (tx) =>
        tx
          .select({ id: vehicles.id })
          .from(vehicles)
          .where(eq(vehicles.id, id)),
      );
      expect(rows).toEqual([]);
    }
    request(USER_C, ORG_3);
    expect(await stockIds()).not.toContain(id);
  });
});

describe("la policy de alta exige el estado inicial (WITH CHECK status = 'in_preparation')", () => {
  type Status = "in_preparation" | "available" | "reserved" | "sold";

  /** INSERT directo por el boundary, en la organización del contexto. */
  function insertWithStatus(ctx: TenantContext, status: Status) {
    return withTenant(ctx, async (tx) => {
      const [vehicle] = await tx
        .insert(vehicles)
        .values({
          organizationId: ctx.organizationId,
          brand: "Toyota",
          model: "Directo",
          version: freshVersion(),
          year: 2024,
          status,
        })
        .returning({ id: vehicles.id, status: vehicles.status });
      return vehicle;
    });
  }

  it("un INSERT directo en preparación, en la organización propia, funciona (admin y seller)", async () => {
    for (const ctx of [
      tenantContext(USER_A, ORG_1),
      tenantContext(USER_C, ORG_1),
    ]) {
      expect(await insertWithStatus(ctx, "in_preparation")).toEqual({
        id: expect.any(String),
        status: "in_preparation",
      });
    }
  });

  it.each(["available", "reserved", "sold"] as const)(
    "un INSERT directo con status = '%s' falla por la policy, aunque el usuario pertenezca a la organización",
    async (status) => {
      const before = await vehicleCount();
      for (const ctx of [
        tenantContext(USER_A, ORG_1),
        tenantContext(USER_C, ORG_1),
        tenantContext(USER_C, ORG_3),
      ]) {
        await expectSqlError(insertWithStatus(ctx, status), "42501");
      }
      expect(await vehicleCount()).toBe(before);
    },
  );

  it("el CHECK general de status no cambió: la base (sin RLS) sigue aceptando todos los estados", async () => {
    const [row] = await db.admin<{ definition: string }[]>`
      SELECT pg_get_constraintdef(oid) AS definition FROM pg_constraint
      WHERE conname = 'vehicles_status_check'
    `;
    expect(row?.definition).toBe(
      "CHECK ((status = ANY (ARRAY['in_preparation'::text, 'available'::text, 'reserved'::text, 'sold'::text])))",
    );
  });

  /*
   * Mutaciones: cada una rompe una condición del WITH CHECK y muestra que
   * los tests de arriba la detectan. La policy se restaura siempre.
   */
  const ORIGINAL_CHECK =
    "organization_id IN (SELECT private.user_org_ids()) AND status = 'in_preparation'";

  async function insertPolicy(): Promise<string | null | undefined> {
    return (await policies(db.admin)).find(
      (policy) => policy.name === "vehicles_insert_member",
    )?.withCheck;
  }

  async function withInsertCheck<T>(
    check: string,
    fn: () => Promise<T>,
  ): Promise<T> {
    const original = await insertPolicy();
    await db.admin.unsafe(
      `ALTER POLICY vehicles_insert_member ON public.vehicles WITH CHECK (${check})`,
    );
    try {
      return await fn();
    } finally {
      await db.admin.unsafe(
        `ALTER POLICY vehicles_insert_member ON public.vehicles WITH CHECK (${ORIGINAL_CHECK})`,
      );
      expect(await insertPolicy()).toBe(original);
    }
  }

  it("mutación: sin status = 'in_preparation', un alta en `available` pasaría; el catálogo también lo marca", async () => {
    let mutant: string | undefined;
    await withInsertCheck(
      "organization_id IN (SELECT private.user_org_ids())",
      async () => {
        // Los tests de arriba lo detectan: el INSERT en `available` ya no falla.
        const row = await insertWithStatus(
          tenantContext(USER_A, ORG_1),
          "available",
        );
        mutant = row?.id;
        expect(row).toMatchObject({ status: "available" });
        expect(await insertPolicy()).not.toContain("status");
      },
    );
    if (mutant)
      await db.admin`DELETE FROM public.vehicles WHERE id = ${mutant}`;
    await expectSqlError(
      insertWithStatus(tenantContext(USER_A, ORG_1), "available"),
      "42501",
    );
  });

  it("mutación: sin la organización, un contexto falsificado escribiría en otra organización", async () => {
    const version = freshVersion();
    // Sin RETURNING: con RETURNING, la policy de lectura también frenaría la
    // fila ajena (defensa adicional, no la que se prueba acá).
    const forgedInsert = () =>
      withTenant(tenantContext(USER_A, ORG_2), (tx) =>
        tx.insert(vehicles).values({
          organizationId: ORG_2,
          brand: "Intrusa",
          model: "X",
          version,
          year: 2024,
          status: "in_preparation",
        }),
      );
    await withInsertCheck("status = 'in_preparation'", async () => {
      await forgedInsert();
      expect(
        (await vehiclesWithVersion(version)).map((v) => v.organizationId),
      ).toEqual([ORG_2]);
    });
    await db.admin`DELETE FROM public.vehicles WHERE version = ${version}`;
    await expectSqlError(forgedInsert(), "42501");
    expect(await vehiclesWithVersion(version)).toEqual([]);
  });
});

describe("sin withTenant() o sin privilegios, la escritura falla cerrado", () => {
  it("app_runtime fuera del boundary no inserta vehículos (42501)", async () => {
    await expect(
      runtimePool()`
        INSERT INTO public.vehicles (organization_id, brand, model, year, status)
        VALUES (${ORG_1}, 'Intrusa', 'X', 2024, 'in_preparation')
      `,
    ).rejects.toMatchObject({ code: "42501" });
  });

  it("authenticated sin claims no inserta: el WITH CHECK no encuentra organizaciones", async () => {
    await expect(
      runtimePool().begin(async (tx) => {
        await tx`SELECT set_config('role', 'authenticated', true)`;
        await tx`
          INSERT INTO public.vehicles (organization_id, brand, model, year, status)
          VALUES (${ORG_1}, 'Intrusa', 'X', 2024, 'in_preparation')
        `;
      }),
    ).rejects.toMatchObject({ code: "42501" });
  });

  it("anon no inserta (sin grants)", async () => {
    await expect(
      db.admin.begin(async (tx) => {
        await tx`SET LOCAL ROLE anon`;
        await tx`
          INSERT INTO public.vehicles (organization_id, brand, model, year, status)
          VALUES (${ORG_1}, 'Intrusa', 'X', 2024, 'in_preparation')
        `;
      }),
    ).rejects.toMatchObject({ code: "42501" });
  });

  it("UPDATE y DELETE siguen prohibidos por withTenant(), también en la organización propia y sobre una unidad recién creada", async () => {
    const ctx = tenantContext(USER_A, ORG_1);
    const { id: fresh } = await createVehicleInPreparation(
      ctx,
      newVehicle(freshVersion()),
    );
    const seeded = VEHICLES.find((v) => v.organizationId === ORG_1)!.id;
    for (const id of [fresh, seeded]) {
      await expectSqlError(
        withTenant(ctx, (tx) =>
          tx
            .update(vehicles)
            .set({ status: "available" })
            .where(eq(vehicles.id, id)),
        ),
        "42501",
      );
      await expectSqlError(
        withTenant(ctx, (tx) => tx.delete(vehicles).where(eq(vehicles.id, id))),
        "42501",
      );
    }
    // Tampoco por ON CONFLICT DO UPDATE (requiere UPDATE).
    await expectSqlError(
      withTenant(ctx, (tx) =>
        tx
          .insert(vehicles)
          .values({
            id: fresh,
            organizationId: ORG_1,
            brand: "Pisada",
            model: "X",
            year: 2024,
            status: "in_preparation",
          })
          .onConflictDoUpdate({
            target: vehicles.id,
            set: { status: "available" },
          }),
      ),
      "42501",
    );
    const [row] = await db.admin<{ status: string; brand: string }[]>`
      SELECT status, brand FROM public.vehicles WHERE id = ${fresh}
    `;
    expect(row).toEqual({ status: "in_preparation", brand: "Toyota" });
  });
});
