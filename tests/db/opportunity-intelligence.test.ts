import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { getOpportunityQueue } from "@/db/queries/opportunities";
import type { Opportunity } from "@/domains/opportunities/types";
import type { TenantContext } from "@/db/tenant";
import { ACTIVE_ORGANIZATION_COOKIE } from "@/lib/tenant/cookie";

import { cookieJar, type CookieJar } from "../unit/support/cookie-jar";
import { NOW, OPPORTUNITIES, seedOpportunities } from "./support/opportunities";
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
 * Motor de inteligencia en la cola de /opportunities (Hito 3, DEC-035), de
 * punta a punta contra PostgreSQL 17 con las migraciones aplicadas:
 *
 *   request → requireTenant() → withTenant(): cola, ledger, stock disponible
 *   y última nota de cada oportunidad, filtrados por la organización activa
 *   → RLS → evaluateOpportunity() con `now` → ViewModel
 *
 * El loader es el real, conectado como app_runtime. Supabase Auth (claims ya
 * verificados), la cookie y el redirect de Next son simulados, como en
 * opportunities.test.ts.
 *
 * Datos (además de las seeds de tenants, oportunidades y Stock):
 * - Ramón (ORG_1, En calificación, hace 2 min) busca una Toyota Hilux hasta
 *   USD 45.000. En ORG_1 está la Hilux 2025 a USD 49.900 (marca y modelo,
 *   45 pts). En ORG_2 hay una Hilux 2024 a USD 40.000 que sería un match de
 *   75 pts: si el stock de otra organización se filtrara, el score cambiaría.
 * - Celeste (ORG_1, Nueva, hace 3 h): una nota de hace 3 días y otra de hace
 *   1 h; la más reciente es la que cuenta.
 * - Fátima (ORG_2, En negociación, hace 10 min): sin unidad vinculada.
 * - Agroganadera (ORG_3, En negociación, hace 38 min): la L200 Triton
 *   vinculada y una nota de recién.
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

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

const RAMON = OPPORTUNITIES[0]!.id; // ORG_1
const CELESTE = OPPORTUNITIES[1]!.id; // ORG_1
const FORTUNER = OPPORTUNITIES[2]!.id; // ORG_1
const FATIMA = OPPORTUNITIES[3]!.id; // ORG_2
const AGROGANADERA = OPPORTUNITIES[5]!.id; // ORG_3

const L200 = VEHICLES.find((v) => v.model === "L200 Triton")!.id; // ORG_3
const HILUX_ORG_2 = "20000000-0000-4000-8000-000000000211";

let server: TestServer;
let db: TestDatabase;

beforeAll(async () => {
  server = await startTestServer();
  db = await server.createDatabase();
  await runMigrations(db.migrationUrl);
  await seedTenants(db.admin);
  await seedOpportunities(db.admin);
  await seedVehicles(db.admin);
  await db.admin`
    INSERT INTO public.vehicles
      (id, organization_id, brand, model, year, km, price, currency, status)
    VALUES
      (${HILUX_ORG_2}, ${ORG_2}, 'Toyota', 'Hilux', 2024, 0, '40000.00', 'USD', 'available')
  `;
  await db.admin`
    INSERT INTO public.opportunity_demand_facts
      (organization_id, opportunity_id, fact, status, source_kind, recorded_by, brand, model)
    VALUES (${ORG_1}, ${RAMON}, 'desired_vehicle', 'confirmed', 'member', ${USER_A}, 'Toyota', 'Hilux')
  `;
  await db.admin`
    INSERT INTO public.opportunity_demand_facts
      (organization_id, opportunity_id, fact, status, source_kind, recorded_by, amount, currency)
    VALUES (${ORG_1}, ${RAMON}, 'budget_max', 'confirmed', 'member', ${USER_A}, '45000', 'USD')
  `;
  await db.admin`
    INSERT INTO public.opportunity_notes
      (organization_id, opportunity_id, body, recorded_by, recorded_at)
    VALUES
      (${ORG_1}, ${CELESTE}, 'Primera llamada.', ${USER_A}, ${new Date(NOW.getTime() - 3 * DAY)}),
      (${ORG_1}, ${CELESTE}, 'Pidió fotos.', ${USER_C}, ${new Date(NOW.getTime() - HOUR)}),
      (${ORG_3}, ${AGROGANADERA}, 'Confirmó la visita.', ${USER_C}, ${new Date(NOW.getTime() - 10 * MINUTE)})
  `;
  // Vincular es la única UPDATE que el trigger admite sin pase de etapa,
  // y solo En negociación (DEC-033, DEC-034).
  await db.admin`
    UPDATE public.opportunities SET vehicle_id = ${L200}
    WHERE id = ${AGROGANADERA}
  `;
  vi.stubEnv("RUNTIME_DATABASE_URL", await db.runtimeUrl());
});

afterAll(async () => {
  await closeRuntimePool();
  vi.unstubAllEnvs();
  await server?.close();
});

/** Nueva request: usuario autenticado y cookie de organización. */
function request(userId: string, cookie?: string): void {
  mocks.forged = null;
  mocks.claims = {
    iss: "https://testref.supabase.co/auth/v1",
    sub: userId,
    aud: "authenticated",
    exp: 1_900_000_000,
    iat: 1_899_996_400,
    role: "authenticated",
    aal: "aal1",
    session_id: "00000000-0000-4000-8000-0000000000e1",
  };
  mocks.jar = cookieJar(
    cookie === undefined ? {} : { [ACTIVE_ORGANIZATION_COOKIE]: cookie },
  );
}

async function queueAt(now: Date): Promise<Map<string, Opportunity>> {
  const { opportunities } = await getOpportunityQueue(now);
  return new Map(opportunities.map((op) => [op.id, op]));
}

function pick(queue: Map<string, Opportunity>, id: string): Opportunity {
  const opportunity = queue.get(id);
  if (!opportunity) throw new Error(`opportunity ${id} not in the queue`);
  return opportunity;
}

describe("la cola real deriva recencia, Porandú Score y NBA", () => {
  it("Ramón: Vehicle Fit sale solo del stock de su organización", async () => {
    request(USER_A);
    const ramon = pick(await queueAt(NOW), RAMON);

    // Hilux 2025 de ORG_1: marca y modelo (45); USD 49.900 excede el
    // presupuesto en más del 10 % (0). La Hilux de ORG_2 (75) no participa.
    expect(ramon.scores).toEqual({
      porandu: 45,
      coverage: 0.6,
      intent: null,
      fit: 45,
      deal: 45,
    });
    expect(ramon.scoreExplanation?.factors.fit).toBe(
      "Top Match en stock: 45 pts",
    );
    expect(ramon.lastActivity).toEqual({ minutes: 2, state: "active" });
    expect(ramon.nba).toMatchObject({
      code: "log_contact_update",
      reason: "Todavía no hay notas en la bitácora.",
      urgent: false,
    });
  });

  it("Celeste: cuenta la nota más reciente de la bitácora (max por oportunidad)", async () => {
    request(USER_A);
    const celeste = pick(await queueAt(NOW), CELESTE);

    expect(celeste.nba).toMatchObject({ code: "on_track", secondary: [] });
    // Sin demanda: solo Deal Readiness (Nueva).
    expect(celeste.scores).toMatchObject({ porandu: 20, fit: null, deal: 20 });
    // Dos días después, la nota de hace 1 h ya tiene 2 días.
    const later = pick(
      await queueAt(new Date(NOW.getTime() + 2 * DAY)),
      CELESTE,
    );
    expect(later.nba).toMatchObject({
      code: "log_contact_update",
      reason: "La última nota es de hace 2 días.",
    });
  });

  it("Fátima (ORG_2, En negociación sin unidad): vincular unidad de stock", async () => {
    request(USER_B);
    const fatima = pick(await queueAt(NOW), FATIMA);

    expect(fatima.nba).toMatchObject({
      code: "link_vehicle",
      action: "Vincular unidad de stock",
      reason:
        "En negociación sin una unidad vinculada. Cargá lo que busca para encontrarla en el stock.",
      secondary: ["Registrar actualización de contacto"],
    });
  });

  it("Agroganadera (ORG_3): la unidad vinculada lleva Vehicle Fit a 100 y la bitácora está al día", async () => {
    request(USER_C, ORG_3);
    const agro = pick(await queueAt(NOW), AGROGANADERA);

    expect(agro.scores).toEqual({
      porandu: 88,
      coverage: 0.6,
      intent: null,
      fit: 100,
      deal: 75,
    });
    expect(agro.scoreExplanation?.factors.fit).toBe(
      "Unidad del stock vinculada",
    );
    expect(agro.nba?.code).toBe("on_track");
  });

  it("seis días sin actividad: todas inactivas, −40 y retomar contacto urgente", async () => {
    request(USER_A);
    const queue = await queueAt(new Date(NOW.getTime() + 6 * DAY));

    for (const op of queue.values()) {
      expect(op.lastActivity.state).toBe("stale");
      expect(op.nba).toMatchObject({ code: "recover_stale", urgent: true });
    }
    // Ramón: base 45, menos 40.
    expect(pick(queue, RAMON).scores.porandu).toBe(5);
    expect(pick(queue, RAMON).scoreExplanation?.penalties).toEqual([
      {
        kind: "inactivity",
        label: "Inactiva hace 6 días · riesgo de pérdida",
        points: -40,
      },
    ]);
    expect(pick(queue, FORTUNER).lastActivity.minutes).toBe(6 * 24 * 60 + 45);
  });
});

describe("aislamiento y estado derivado", () => {
  it("C con ORG_1 activa no recibe la bitácora ni la unidad de ORG_3", async () => {
    request(USER_C, ORG_1);
    const queue = await queueAt(NOW);

    expect([...queue.keys()].sort()).toEqual([RAMON, CELESTE, FORTUNER].sort());
    expect(pick(queue, RAMON).scores.fit).toBe(45);
  });

  it("contexto falsificado (A-03): RLS no deja ver la cola ajena, ni su stock", async () => {
    request(USER_A);
    mocks.forged = tenantContext(USER_A, ORG_2);
    try {
      expect((await getOpportunityQueue(NOW)).opportunities).toEqual([]);
    } finally {
      mocks.forged = null;
    }
  });

  it("calcular no escribe: oportunidades, notas y stock quedan intactos", async () => {
    const snapshot = () => db.admin`
      SELECT
        (SELECT json_agg(json_build_object(
           'id', id, 'last_activity_at', last_activity_at,
           'updated_at', updated_at, 'stage', stage, 'vehicle_id', vehicle_id)
           ORDER BY id) FROM public.opportunities) AS opportunities,
        (SELECT count(*) FROM public.opportunity_notes) AS notes,
        (SELECT json_agg(json_build_object(
           'id', id, 'status', status, 'updated_at', updated_at)
           ORDER BY id) FROM public.vehicles) AS vehicles
    `;
    const before = await snapshot();

    for (const [user, org] of [
      [USER_A, undefined],
      [USER_B, undefined],
      [USER_C, ORG_3],
    ] as const) {
      request(user, org);
      await getOpportunityQueue(NOW);
      await getOpportunityQueue(new Date(NOW.getTime() + 9 * DAY));
    }

    expect(await snapshot()).toEqual(before);
  });
});
