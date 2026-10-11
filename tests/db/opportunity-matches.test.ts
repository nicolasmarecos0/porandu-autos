import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { getOpportunityDetail } from "@/db/queries/opportunity-detail";
import { selectMatchCandidates } from "@/db/queries/vehicles";
import { withTenant, type TenantContext } from "@/db/tenant";
import { ACTIVE_ORGANIZATION_COOKIE } from "@/lib/tenant/cookie";

import { cookieJar, type CookieJar } from "../unit/support/cookie-jar";
import { OPPORTUNITIES, seedOpportunities } from "./support/opportunities";
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
} from "./support/tenants";
import { seedVehicles, VEHICLES } from "./support/vehicles";

/*
 * Match v0 en /opportunities/[id] (H1.5, DEC-031 §5), de punta a punta
 * contra PostgreSQL 17 con las migraciones aplicadas:
 *
 *   request → requireTenant() → withTenant(): oportunidad, ledger y unidades
 *   disponibles de la organización activa → RLS → resolver →
 *   DemandSnapshot → findMatchesForDemand() → rail
 *
 * El loader es el real, conectado como app_runtime. Supabase Auth (claims ya
 * verificados), la cookie y el redirect de Next son simulados, como en
 * opportunities.test.ts.
 *
 * Cada organización tiene una Toyota Hilux disponible que sería un match
 * perfecto para Ramón (ORG_1): solo puede aparecer la de ORG_1. Las Hilux
 * vendida, reservada y en preparación de ORG_1 tampoco aparecen.
 */

vi.mock("server-only", () => ({}));

const mocks = vi.hoisted(() => {
  class RedirectSignal extends Error {
    constructor(readonly path: string) {
      super(`redirect(${path})`);
    }
  }
  class NotFoundSignal extends Error {}
  return {
    RedirectSignal,
    NotFoundSignal,
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
vi.mock("next/navigation", () => ({
  redirect: mocks.redirect,
  notFound: () => {
    throw new mocks.NotFoundSignal("notFound()");
  },
}));
// La vista (React) no corre en este entorno: la página se prueba con el
// loader real.
vi.mock("@/components/opportunities/opportunity-detail", () => ({
  OpportunityDetailView: () => null,
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

const vehicleId = (n: number) =>
  `20000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

/** Unidades de la seed de Stock (support/vehicles.ts). */
const HILUX_2025 = VEHICLES.find((v) => v.model === "Hilux")!.id; // ORG_1, USD 49.900
const SPORTAGE = VEHICLES.find((v) => v.model === "Sportage")!.id; // ORG_2
const L200 = VEHICLES.find((v) => v.model === "L200 Triton")!.id; // ORG_3

/** Unidades extra de esta suite. */
const HILUX_2022 = vehicleId(111); // ORG_1, disponible, USD 38.000
const COROLLA = vehicleId(112); // ORG_1, disponible, USD 30.000
const HILUX_SOLD = vehicleId(113);
const HILUX_RESERVED = vehicleId(114);
const HILUX_PREPARATION = vehicleId(115);
const HILUX_ORG_2 = vehicleId(211);
const HILUX_ORG_3 = vehicleId(311);

const RAMON = OPPORTUNITIES[0]!.id; // ORG_1
const CELESTE = OPPORTUNITIES[1]!.id; // ORG_1, sin demanda ni legado
const FORTUNER = OPPORTUNITIES[2]!.id; // ORG_1, legado "Toyota Fortuner"
const SPORTAGE_LEGACY = OPPORTUNITIES[3]!.id; // ORG_2, legado "Kia Sportage"

const ORG_4 = "00000000-0000-4000-8000-000000000004";
const USER_F = "00000000-0000-4000-8000-00000000000f";
const ORG_4_OPPORTUNITY = "10000000-0000-4000-8000-000000000401";

let server: TestServer;
let db: TestDatabase;

type ExtraVehicle = {
  id: string;
  organizationId: string;
  model: string;
  version: string | null;
  year: number;
  km: number | null;
  price: string;
  status: "in_preparation" | "available" | "reserved" | "sold";
  createdAt: string;
};

const EXTRA_VEHICLES: ExtraVehicle[] = [
  {
    id: HILUX_2022,
    organizationId: ORG_1,
    model: "Hilux",
    version: "SR 2.4 4x2 MT",
    year: 2022,
    km: 64000,
    price: "38000.00",
    status: "available",
    createdAt: "2026-09-25T12:00:00Z",
  },
  {
    id: COROLLA,
    organizationId: ORG_1,
    model: "Corolla",
    version: null,
    year: 2023,
    km: null,
    price: "30000.00",
    status: "available",
    createdAt: "2026-09-24T12:00:00Z",
  },
  ...(
    [
      [HILUX_SOLD, "sold"],
      [HILUX_RESERVED, "reserved"],
      [HILUX_PREPARATION, "in_preparation"],
    ] as const
  ).map(([id, status]) => ({
    id,
    organizationId: ORG_1,
    model: "Hilux",
    version: null,
    year: 2023,
    km: 10000,
    price: "39000.00",
    status,
    createdAt: "2026-09-26T12:00:00Z",
  })),
  {
    id: HILUX_ORG_2,
    organizationId: ORG_2,
    model: "Hilux",
    version: null,
    year: 2024,
    km: 0,
    price: "40000.00",
    status: "available",
    createdAt: "2026-09-26T12:00:00Z",
  },
  {
    id: HILUX_ORG_3,
    organizationId: ORG_3,
    model: "Hilux",
    version: null,
    year: 2023,
    km: 0,
    price: "41000.00",
    status: "available",
    createdAt: "2026-09-26T12:00:00Z",
  },
];

beforeAll(async () => {
  server = await startTestServer();
  db = await server.createDatabase();
  await runMigrations(db.migrationUrl);
  await seedTenants(db.admin);
  await seedOpportunities(db.admin);
  await seedVehicles(db.admin);
  await db.admin`
    INSERT INTO public.vehicles ${db.admin(
      EXTRA_VEHICLES.map((v) => ({
        id: v.id,
        organization_id: v.organizationId,
        brand: "Toyota",
        model: v.model,
        version: v.version,
        year: v.year,
        km: v.km,
        price: v.price,
        currency: "USD",
        status: v.status,
        created_at: new Date(v.createdAt),
        updated_at: new Date(v.createdAt),
      })),
    )}
  `;
  // ORG_4: una oportunidad con demanda y ninguna unidad.
  await db.admin.begin(async (tx) => {
    await tx`INSERT INTO auth.users (id) VALUES (${USER_F})`;
    await tx`INSERT INTO public.profiles (id) VALUES (${USER_F})`;
    await tx`INSERT INTO public.organizations (id, name) VALUES (${ORG_4}, 'Organización 4')`;
    await tx`
      INSERT INTO public.memberships (organization_id, user_id, role)
      VALUES (${ORG_4}, ${USER_F}, 'seller')
    `;
    await tx`
      INSERT INTO public.contacts (id, organization_id, name)
      VALUES ('10000000-0000-4000-8000-000000000040', ${ORG_4}, 'Lidia Ortiz')
    `;
    await tx`
      INSERT INTO public.opportunities (id, organization_id, contact_id, stage, source)
      VALUES (${ORG_4_OPPORTUNITY}, ${ORG_4}, '10000000-0000-4000-8000-000000000040', 'new', 'web')
    `;
    await tx`
      INSERT INTO public.opportunity_demand_facts
        (organization_id, opportunity_id, fact, status, source_kind, recorded_by, brand)
      VALUES (${ORG_4}, ${ORG_4_OPPORTUNITY}, 'desired_vehicle', 'confirmed', 'member', ${USER_F}, 'Toyota')
    `;
  });
  // Ramón (ORG_1): Toyota Hilux, desde 2020, hasta USD 45.000.
  await db.admin`
    INSERT INTO public.opportunity_demand_facts
      (organization_id, opportunity_id, fact, status, source_kind, recorded_by, brand, model)
    VALUES (${ORG_1}, ${RAMON}, 'desired_vehicle', 'confirmed', 'member', ${USER_A}, 'Toyota', 'Hilux')
  `;
  await db.admin`
    INSERT INTO public.opportunity_demand_facts
      (organization_id, opportunity_id, fact, status, source_kind, recorded_by, year_min)
    VALUES (${ORG_1}, ${RAMON}, 'year_range', 'confirmed', 'member', ${USER_A}, 2020)
  `;
  await db.admin`
    INSERT INTO public.opportunity_demand_facts
      (organization_id, opportunity_id, fact, status, source_kind, recorded_by, amount, currency)
    VALUES (${ORG_1}, ${RAMON}, 'budget_max', 'confirmed', 'member', ${USER_A}, '45000', 'USD')
  `;
  // Fortuner (ORG_1): busca un Ford; en ORG_1 solo hay Toyota disponibles.
  await db.admin`
    INSERT INTO public.opportunity_demand_facts
      (organization_id, opportunity_id, fact, status, source_kind, recorded_by, brand)
    VALUES (${ORG_1}, ${FORTUNER}, 'desired_vehicle', 'confirmed', 'member', ${USER_A}, 'Ford')
  `;
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

async function matchesOf(id: string) {
  const detail = await getOpportunityDetail(id);
  if (!detail) throw new Error("opportunity not visible");
  return detail.matches;
}

async function candidateIds(ctx: TenantContext): Promise<string[]> {
  const candidates = await withTenant(ctx, (tx) =>
    selectMatchCandidates(tx, ctx.organizationId),
  );
  return candidates.map((vehicle) => vehicle.id);
}

const ORG_FOREIGN_HILUX = [HILUX_ORG_2, HILUX_ORG_3];
const NOT_AVAILABLE = [HILUX_SOLD, HILUX_RESERVED, HILUX_PREPARATION];

describe("candidatas: unidades disponibles de la organización activa", () => {
  it("A (ORG_1): solo las disponibles de ORG_1, del ingreso más reciente al más viejo", async () => {
    const candidates = await withTenant(tenantContext(USER_A, ORG_1), (tx) =>
      selectMatchCandidates(tx, ORG_1),
    );
    expect(candidates).toEqual([
      {
        id: HILUX_2025,
        organizationId: ORG_1,
        brand: "Toyota",
        model: "Hilux",
        version: "SRV 2.8 4x4 AT",
        year: 2025,
        km: 0,
        price: { amount: "49900.00", currency: "USD" },
        status: "available",
      },
      {
        id: HILUX_2022,
        organizationId: ORG_1,
        brand: "Toyota",
        model: "Hilux",
        version: "SR 2.4 4x2 MT",
        year: 2022,
        km: 64000,
        price: { amount: "38000.00", currency: "USD" },
        status: "available",
      },
      {
        id: COROLLA,
        organizationId: ORG_1,
        brand: "Toyota",
        model: "Corolla",
        year: 2023,
        price: { amount: "30000.00", currency: "USD" },
        status: "available",
      },
    ]);
  });

  it("cada organización ve solo su stock disponible; C con ORG_1 activa no ve ORG_3", async () => {
    expect(await candidateIds(tenantContext(USER_C, ORG_1))).toEqual([
      HILUX_2025,
      HILUX_2022,
      COROLLA,
    ]);
    expect(await candidateIds(tenantContext(USER_C, ORG_3))).toEqual([
      L200,
      HILUX_ORG_3,
    ]);
    expect(await candidateIds(tenantContext(USER_B, ORG_2))).toEqual([
      SPORTAGE,
      HILUX_ORG_2,
    ]);
  });

  it("contexto falsificado (A-03) o membership inactiva: ninguna unidad", async () => {
    // El filtro pide ORG_2; RLS solo deja ver ORG_1 a A.
    expect(await candidateIds(tenantContext(USER_A, ORG_2))).toEqual([]);
    // C tiene la membership de ORG_2 inactiva.
    expect(await candidateIds(tenantContext(USER_C, ORG_2))).toEqual([]);
  });
});

describe("matches en /opportunities/[id] con el loader real", () => {
  it("Top Match y alternativa reales, con las razones del motor", async () => {
    request(USER_A);
    expect(await matchesOf(RAMON)).toEqual({
      kind: "matches",
      top: {
        vehicleId: HILUX_2022,
        name: "Toyota Hilux",
        detail: "SR 2.4 4x2 MT · 2022",
        price: "USD 38.000",
        km: "64.000 km",
        score: { total: 100, vehicle: 45, year: 25, budget: 30 },
        reasons: [
          "Marca y modelo coinciden exactamente",
          "Año dentro del rango buscado",
          "Precio dentro del presupuesto",
          "Unidad disponible en stock",
        ],
      },
      alternative: {
        vehicleId: HILUX_2025,
        name: "Toyota Hilux",
        detail: "SRV 2.8 4x4 AT · 2025",
        price: "USD 49.900",
        km: "0 km",
        // USD 49.900 excede USD 45.000 en más del 10 %.
        score: { total: 70, vehicle: 45, year: 25, budget: 0 },
        reasons: [
          "Marca y modelo coinciden exactamente",
          "Año dentro del rango buscado",
          "Unidad disponible en stock",
        ],
      },
    });
  });

  it("aislamiento: la Hilux perfecta de otra organización nunca aparece, tampoco para C con ORG_1 activa", async () => {
    for (const [user, cookie] of [
      [USER_A, undefined],
      [USER_C, ORG_1],
    ] as const) {
      request(user, cookie);
      const json = JSON.stringify(await matchesOf(RAMON));
      for (const foreign of [...ORG_FOREIGN_HILUX, L200, SPORTAGE]) {
        expect(json).not.toContain(foreign);
      }
    }
  });

  it("solo unidades disponibles: vendida, reservada y en preparación no aparecen", async () => {
    request(USER_A);
    const json = JSON.stringify(await matchesOf(RAMON));
    for (const unavailable of NOT_AVAILABLE) {
      expect(json).not.toContain(unavailable);
    }
  });

  it("al rail no llegan ids de usuario ni de la organización", async () => {
    request(USER_A);
    const json = JSON.stringify(await getOpportunityDetail(RAMON));
    for (const secret of [USER_A, USER_C, ORG_1]) {
      expect(json).not.toContain(secret);
    }
  });

  it("sin demanda: sin dato honesto (no_demand), aunque haya stock", async () => {
    request(USER_A);
    expect(await matchesOf(CELESTE)).toEqual({
      kind: "empty",
      reason: "no_demand",
    });
  });

  it("el legado interest_model nunca alimenta Match (DEC-030 §11)", async () => {
    // ORG_2 tiene una Kia Sportage disponible y el legado dice "Kia Sportage".
    request(USER_B);
    expect(await matchesOf(SPORTAGE_LEGACY)).toEqual({
      kind: "empty",
      reason: "no_demand",
    });
  });

  it("ninguna unidad llega al umbral: no_match, nunca un fixture", async () => {
    request(USER_A);
    expect(await matchesOf(FORTUNER)).toEqual({
      kind: "empty",
      reason: "no_match",
    });
  });

  it("sin unidades disponibles en la organización: no_stock", async () => {
    request(USER_F);
    expect(await matchesOf(ORG_4_OPPORTUNITY)).toEqual({
      kind: "empty",
      reason: "no_stock",
    });
  });

  it("la página renderiza con los matches", async () => {
    const { default: OpportunityDetailPage } =
      await import("@/app/(app)/opportunities/[id]/page");
    request(USER_A);
    await expect(
      OpportunityDetailPage({
        params: Promise.resolve({ id: RAMON }),
        searchParams: Promise.resolve({}),
      }),
    ).resolves.toBeTruthy();
  });

  it("calcular matches no escribe nada: ni last_activity_at, ni el ledger, ni el stock", async () => {
    const snapshot = () => db.admin`
      SELECT
        (SELECT json_agg(json_build_object('id', id, 'last_activity_at', last_activity_at, 'updated_at', updated_at) ORDER BY id)
          FROM public.opportunities) AS opportunities,
        (SELECT count(*) FROM public.opportunity_demand_facts) AS facts,
        (SELECT json_agg(json_build_object('id', id, 'status', status, 'updated_at', updated_at) ORDER BY id)
          FROM public.vehicles) AS vehicles
    `;
    const before = await snapshot();
    request(USER_A);
    await matchesOf(RAMON);
    await matchesOf(FORTUNER);
    request(USER_F);
    await matchesOf(ORG_4_OPPORTUNITY);
    expect(await snapshot()).toEqual(before);
  });
});
