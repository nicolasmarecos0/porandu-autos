import { and, eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { getOpportunityDetail } from "@/db/queries/opportunity-detail";
import { getOpportunityQueue } from "@/db/queries/opportunities";
import { contacts, opportunities } from "@/db/schema";
import { withTenant, type TenantContext } from "@/db/tenant";
import { ACTIVE_ORGANIZATION_COOKIE } from "@/lib/tenant/cookie";

import { cookieJar, type CookieJar } from "../unit/support/cookie-jar";
import { tablePrivileges, tenancy } from "./support/catalog";
import {
  NOW,
  OPPORTUNITIES,
  opportunityIdsOf,
  seedOpportunities,
} from "./support/opportunities";
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
 * Opportunities con datos reales (H1.1), de punta a punta contra
 * PostgreSQL 17 con las migraciones aplicadas:
 *
 *   request → requireTenant() → withTenant() → query con filtro explícito
 *   → RLS → ViewModel
 *
 * El loader es el real (db/queries/opportunities.ts), conectado como
 * app_runtime. Supabase Auth (claims ya verificados), la cookie y el
 * redirect de Next son simulados, como en tenant-resolution.test.ts.
 *
 * Tenants (support/tenants.ts y support/opportunities.ts):
 *   A: admin de ORG_1 · B: admin de ORG_2 · C: ORG_1 y ORG_3 activas, ORG_2
 *   inactiva · D: solo inactiva en ORG_1 · E: sin memberships · F: única
 *   membership en ORG_4, que no tiene oportunidades.
 *   ORG_1: 3 oportunidades · ORG_2: 2 · ORG_3: 1 · ORG_4: 0.
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
// La página /opportunities/[id] se prueba con el loader real; la vista
// (React) no corre en este entorno.
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

const ORG_4 = "00000000-0000-4000-8000-000000000004";
const USER_F = "00000000-0000-4000-8000-00000000000f";

let server: TestServer;
let db: TestDatabase;

beforeAll(async () => {
  server = await startTestServer();
  db = await server.createDatabase();
  await runMigrations(db.migrationUrl);
  await seedTenants(db.admin);
  await seedOpportunities(db.admin);
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
async function queueIds(): Promise<string[]> {
  const { opportunities: queue } = await getOpportunityQueue(NOW);
  return queue.map((op) => op.id);
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
async function forgedQueueIds(ctx: TenantContext): Promise<string[]> {
  request(null);
  mocks.forged = ctx;
  try {
    return await queueIds();
  } finally {
    mocks.forged = null;
  }
}

describe("loader real: requireTenant() → withTenant() → RLS", () => {
  it("A (ORG_1) ve solo las oportunidades de ORG_1, mapeadas al ViewModel", async () => {
    request(USER_A);
    const queue = await getOpportunityQueue(NOW);

    expect(queue.opportunities.map((op) => op.id)).toEqual(
      opportunityIdsOf(ORG_1),
    );
    expect(queue.referenceMinuteOfDay).toBe(10 * 60 + 30);
    expect(queue.opportunities[0]).toStrictEqual({
      id: OPPORTUNITIES[0]!.id,
      prospect: {
        name: "Ramón Benítez",
        initials: "RB",
        phone: "0981 ··· 214",
        city: "Luque",
        channel: "WhatsApp",
        live: false,
      },
      // H1.4: el legado solo es el vehículo "Dato anterior" mientras nunca
      // se cargó un vehículo.
      demand: expect.objectContaining({
        vehicle: { title: "Toyota Hilux SRV 2.8 4x4 AT", source: "legacy" },
      }),
      interest: {},
      // Hito 3 (DEC-035): sin demanda evaluable ni conversaciones, solo se
      // evalúa Deal Readiness (En calificación) y la cobertura lo dice.
      scores: {
        porandu: 45,
        coverage: 0.3,
        intent: null,
        fit: null,
        deal: 45,
      },
      scoreExplanation: {
        factors: {
          intent: "Sin dato: llega con las conversaciones",
          fit: "Sin dato: falta lo que busca",
          deal: "Etapa En calificación",
        },
        penalties: [],
        outcome: null,
      },
      lastActivity: { minutes: 2, state: "active" },
      stage: "qualifying",
      bucket: "now",
      nba: {
        code: "log_contact_update",
        kind: "note",
        action: "Registrar actualización de contacto",
        reason: "Todavía no hay notas en la bitácora.",
        secondary: [],
        urgent: false,
      },
      drivers: [],
    });
    expect(queue.opportunities.map((op) => op.bucket)).toEqual([
      "now",
      "today",
      "followUp",
    ]);
  });

  it("B (ORG_2) ve solo las oportunidades de ORG_2", async () => {
    request(USER_B);
    expect(await queueIds()).toEqual(opportunityIdsOf(ORG_2));
  });

  it("C con ORG_1 activa ve solo ORG_1, aunque RLS también le deja ver ORG_3 (filtro explícito)", async () => {
    request(USER_C, ORG_1);
    expect(await queueIds()).toEqual(opportunityIdsOf(ORG_1));
  });

  it("C con ORG_3 activa ve solo ORG_3, nunca ORG_2 (membership inactiva)", async () => {
    request(USER_C, ORG_3);
    expect(await queueIds()).toEqual(opportunityIdsOf(ORG_3));

    request(USER_C, ORG_2);
    expect(await redirectOf(queueIds())).toBe("/select-organization");
  });

  it("una organización sin oportunidades devuelve una cola vacía válida", async () => {
    request(USER_F);
    expect(await getOpportunityQueue(NOW)).toEqual({
      opportunities: [],
      referenceMinuteOfDay: 10 * 60 + 30,
      scoreComposition: [
        { key: "intent", weight: 0.4 },
        { key: "fit", weight: 0.3 },
        { key: "deal", weight: 0.3 },
      ],
    });
  });

  it("sin sesión, sin memberships o con la membership inactiva, no llega a la base", async () => {
    request(null);
    expect(await redirectOf(queueIds())).toBe("/login");
    request(USER_D);
    expect(await redirectOf(queueIds())).toBe("/no-access");
    request(USER_E);
    expect(await redirectOf(queueIds())).toBe("/no-access");
  });

  it("una cookie con una organización ajena no cruza tenants", async () => {
    request(USER_A, ORG_2);
    expect(await queueIds()).toEqual(opportunityIdsOf(ORG_1));
  });

  it("revocar la membership corta el acceso desde el request siguiente (A-09)", async () => {
    const setActive = (active: boolean) => db.admin`
      UPDATE public.memberships SET active = ${active}
      WHERE organization_id = ${ORG_1} AND user_id = ${USER_A}
    `;
    request(USER_A);
    expect(await queueIds()).toEqual(opportunityIdsOf(ORG_1));
    await setActive(false);
    try {
      request(USER_A);
      expect(await redirectOf(queueIds())).toBe("/no-access");
      // Aun con un contexto emitido antes, RLS ya no deja ver nada.
      expect(await forgedQueueIds(tenantContext(USER_A, ORG_1))).toEqual([]);
    } finally {
      await setActive(true);
    }
  });
});

describe("demanda en la cola (H1.4): lectura por lote, en el servidor", () => {
  const RAMON = OPPORTUNITIES[0]!.id; // ORG_1, legado "Toyota Hilux"
  const AGRO = OPPORTUNITIES.find((o) => o.organizationId === ORG_3)!.id;

  beforeAll(async () => {
    await db.admin`
      INSERT INTO public.opportunity_demand_facts
        (organization_id, opportunity_id, fact, status, source_kind, recorded_by, model, evidence_text)
      VALUES (${ORG_1}, ${RAMON}, 'desired_vehicle', 'confirmed', 'member', ${USER_A}, 'Ranger', 'lo dijo en el showroom')
    `;
    await db.admin`
      INSERT INTO public.opportunity_demand_facts
        (organization_id, opportunity_id, fact, status, source_kind, recorded_by, amount, currency)
      VALUES (${ORG_1}, ${RAMON}, 'budget_max', 'confirmed', 'member', ${USER_C}, '250000000', 'PYG')
    `;
    await db.admin`
      INSERT INTO public.opportunity_demand_facts
        (organization_id, opportunity_id, fact, status, source_kind, recorded_by, purchase_type)
      VALUES (${ORG_3}, ${AGRO}, 'purchase_type', 'confirmed', 'member', ${USER_C}, 'cash')
    `;
  });

  it("cada oportunidad trae su Current Truth resumida; el legado no aparece una vez cargado un vehículo", async () => {
    request(USER_A);
    const { opportunities: queue } = await getOpportunityQueue(NOW);
    const ramon = queue.find((op) => op.id === RAMON)!;
    expect(ramon.demand?.vehicle).toEqual({
      title: "Ranger",
      source: "demand",
    });
    expect(ramon.demand?.facts.budget_max).toMatchObject({
      status: "confirmed",
      display: "Hasta Gs. 250.000.000",
      input: { budgetAmount: "250.000.000", budgetCurrency: "PYG" },
    });
    expect(ramon.demand?.facts.purchase_type).toMatchObject({
      status: "unknown",
      unknownReason: "never_captured",
    });
    // Las demás oportunidades de ORG_1 no tienen demanda.
    for (const op of queue.filter((item) => item.id !== RAMON)) {
      expect(op.demand?.facts.budget_max.status).toBe("unknown");
    }
  });

  it("U6: a la página no llegan evidencia, historial ni ids de usuario", async () => {
    request(USER_A);
    const json = JSON.stringify(await getOpportunityQueue(NOW));
    expect(json).not.toMatch(
      /lo dijo en el showroom|history|recordedBy|evidence/,
    );
    expect(json).not.toContain(USER_A);
    expect(json).not.toContain(USER_C);
  });

  it("la demanda de ORG_3 no llega a la cola de C con ORG_1 activa ni a otra organización", async () => {
    request(USER_C, ORG_1);
    const { opportunities: org1 } = await getOpportunityQueue(NOW);
    expect(org1.map((op) => op.id)).not.toContain(AGRO);
    request(USER_C, ORG_3);
    const { opportunities: org3 } = await getOpportunityQueue(NOW);
    expect(
      org3.find((op) => op.id === AGRO)?.demand?.facts.purchase_type,
    ).toMatchObject({ status: "confirmed", display: "Contado" });
    request(USER_B);
    const { opportunities: org2 } = await getOpportunityQueue(NOW);
    expect(
      org2.every((op) => op.demand?.facts.purchase_type.status === "unknown"),
    ).toBe(true);
  });
});

describe("detalle /opportunities/[id] (H1.4): por qué Porandú cree esto", () => {
  // Facts de RAMON (ORG_1) y AGRO (ORG_3): los del describe anterior.
  const RAMON = OPPORTUNITIES[0]!.id;
  const AGRO = OPPORTUNITIES.find((o) => o.organizationId === ORG_3)!.id;
  const ORG_2_OPPORTUNITY = opportunityIdsOf(ORG_2)[0]!;
  const DATE = String.raw`\d{1,2} [a-z]{3} \d{4} \d{2}:\d{2}`;

  /** /opportunities/[id] con el loader real y la request actual. */
  async function page(id: string) {
    const { default: OpportunityDetailPage } =
      await import("@/app/(app)/opportunities/[id]/page");
    return OpportunityDetailPage({
      params: Promise.resolve({ id }),
      searchParams: Promise.resolve({}),
    });
  }

  it("U5: cada fact con valor explica autor y fecha; el autor, contra quien mira", async () => {
    request(USER_A);
    const detail = (await getOpportunityDetail(RAMON))!;
    expect(detail).toMatchObject({
      id: RAMON,
      contactName: "Ramón Benítez",
      stage: "qualifying",
      demand: { empty: false, legacy: null },
    });
    const facts = new Map(detail.demand.facts.map((f) => [f.fact, f]));
    expect(facts.get("desired_vehicle")).toMatchObject({
      display: "Ranger",
      statusLabel: "Confirmado",
    });
    expect(facts.get("desired_vehicle")!.explanation).toEqual([
      expect.stringMatching(new RegExp(`^Confirmado por Vos · ${DATE}$`)),
      "Nota de la edición: lo dijo en el showroom",
    ]);
    expect(facts.get("budget_max")!.explanation).toEqual([
      expect.stringMatching(
        new RegExp(`^Confirmado por Otro miembro · ${DATE}$`),
      ),
    ]);
    expect(facts.get("purchase_type")!.explanation).toEqual([
      "Todavía no se cargó",
    ]);
    expect(facts.get("desired_vehicle")!.history).toEqual([
      expect.objectContaining({
        display: "Ranger",
        label: "Actual",
        author: "Vos",
      }),
    ]);

    // C mira la misma oportunidad: los autores se invierten.
    request(USER_C, ORG_1);
    const seenByC = (await getOpportunityDetail(RAMON))!;
    const byFact = new Map(seenByC.demand.facts.map((f) => [f.fact, f]));
    expect(byFact.get("desired_vehicle")!.history[0]!.author).toBe(
      "Otro miembro",
    );
    expect(byFact.get("budget_max")!.history[0]!.author).toBe("Vos");
  });

  it("sin facts: estado vacío con el legado de solo lectura", async () => {
    request(USER_A);
    const fortuner = OPPORTUNITIES[2]!.id; // ORG_1, legado "Toyota Fortuner"
    expect((await getOpportunityDetail(fortuner))!.demand).toMatchObject({
      empty: true,
      legacy: "Toyota Fortuner",
    });
  });

  it("al detalle no llegan ids de usuario ni de la organización", async () => {
    request(USER_A);
    const json = JSON.stringify(await getOpportunityDetail(RAMON));
    for (const secret of [USER_A, USER_C, ORG_1]) {
      expect(json).not.toContain(secret);
    }
  });

  it("U7: un id ajeno, inexistente o inválido da null y la página notFound()", async () => {
    const cases: [string | null, string | undefined, string][] = [
      // B (ORG_2) pide una oportunidad de ORG_1.
      [USER_B, undefined, RAMON],
      // A (ORG_1) pide una de ORG_3, donde no tiene membership.
      [USER_A, undefined, AGRO],
      // C con ORG_1 activa: RLS le deja ver ORG_3, el filtro explícito no.
      [USER_C, ORG_1, AGRO],
      // C con ORG_3 activa pide una de ORG_2 (membership inactiva).
      [USER_C, ORG_3, ORG_2_OPPORTUNITY],
      // Inexistente e inválidos.
      [USER_A, undefined, "10000000-0000-4000-8000-000000009999"],
      [USER_A, undefined, "no-es-un-uuid"],
      [USER_A, undefined, `${RAMON}' OR '1'='1`],
    ];
    for (const [user, cookie, id] of cases) {
      request(user, cookie);
      expect(await getOpportunityDetail(id)).toBeNull();
      request(user, cookie);
      await expect(page(id)).rejects.toBeInstanceOf(mocks.NotFoundSignal);
    }
    // El dueño sí la ve: la página renderiza.
    request(USER_C, ORG_3);
    expect((await getOpportunityDetail(AGRO))!.demand.facts).toContainEqual(
      expect.objectContaining({ fact: "purchase_type", display: "Contado" }),
    );
    request(USER_C, ORG_3);
    await expect(page(AGRO)).resolves.toBeTruthy();
  });

  it("sin sesión o sin membership activa, no llega a la base: redirige", async () => {
    request(null);
    expect(await redirectOf(getOpportunityDetail(RAMON))).toBe("/login");
    request(USER_D);
    expect(await redirectOf(getOpportunityDetail(RAMON))).toBe("/no-access");
  });

  it("contexto falsificado (A-03): A con ORG_2 no ve ni ORG_2 ni ORG_1", async () => {
    request(null);
    mocks.forged = tenantContext(USER_A, ORG_2);
    try {
      expect(await getOpportunityDetail(ORG_2_OPPORTUNITY)).toBeNull();
      expect(await getOpportunityDetail(RAMON)).toBeNull();
    } finally {
      mocks.forged = null;
    }
  });

  it("leer el detalle no modifica la oportunidad ni el ledger", async () => {
    const before = await db.admin`
      SELECT last_activity_at, updated_at,
        (SELECT count(*) FROM public.opportunity_demand_facts WHERE opportunity_id = ${RAMON}) AS facts
      FROM public.opportunities WHERE id = ${RAMON}
    `;
    request(USER_A);
    await getOpportunityDetail(RAMON);
    const after = await db.admin`
      SELECT last_activity_at, updated_at,
        (SELECT count(*) FROM public.opportunity_demand_facts WHERE opportunity_id = ${RAMON}) AS facts
      FROM public.opportunities WHERE id = ${RAMON}
    `;
    expect(after).toEqual(before);
  });
});

describe("contexto falsificado (A-03)", () => {
  it("A con ORG_2 no ve oportunidades de ORG_2 ni de ORG_1", async () => {
    // El filtro explícito pide ORG_2; RLS solo deja ver ORG_1.
    expect(await forgedQueueIds(tenantContext(USER_A, ORG_2))).toEqual([]);
  });

  it("C con ORG_2 (membership inactiva) no ve ORG_2", async () => {
    expect(await forgedQueueIds(tenantContext(USER_C, ORG_2))).toEqual([]);
  });
});

describe("fuera de withTenant() falla cerrado (C2)", () => {
  it("app_runtime sin el boundary no lee ni escribe contacts ni opportunities (42501)", async () => {
    const pool = runtimePool();
    for (const table of ["contacts", "opportunities"]) {
      await expect(
        pool`SELECT * FROM ${pool(`public.${table}`)}`,
      ).rejects.toMatchObject({ code: "42501" });
    }
    await expect(
      pool`INSERT INTO public.contacts (organization_id, name) VALUES (${ORG_1}, 'Intruso')`,
    ).rejects.toMatchObject({ code: "42501" });
  });

  it("authenticated sin claims no ve ninguna fila", async () => {
    await runtimePool().begin(async (tx) => {
      await tx`SELECT set_config('role', 'authenticated', true)`;
      for (const table of ["contacts", "opportunities"]) {
        expect(await tx`SELECT * FROM ${tx(`public.${table}`)}`).toHaveLength(
          0,
        );
      }
    });
  });

  it("RESET ROLE dentro del boundary vuelve a app_runtime, que no lee nada", async () => {
    await expectSqlError(
      withTenant(tenantContext(USER_A, ORG_1), async (tx) => {
        await tx.execute(sql`RESET ROLE`);
        return tx.select().from(opportunities);
      }),
      "42501",
    );
  });

  it("por withTenant() nadie modifica fuera del cambio de etapa ni borra, ni da de alta en otra organización", async () => {
    // El alta en la organización propia (H1.2) se prueba en
    // create-opportunity.test.ts; acá la cola de ORG_1 no cambia.
    const ctx = tenantContext(USER_A, ORG_1);
    const own = OPPORTUNITIES[0]!;
    const foreign = OPPORTUNITIES.find((o) => o.organizationId === ORG_2)!;
    await expectSqlError(
      withTenant(ctx, (tx) =>
        tx.insert(contacts).values({ organizationId: ORG_2, name: "Nuevo" }),
      ),
      "42501",
    );
    await expectSqlError(
      withTenant(ctx, (tx) =>
        tx.insert(opportunities).values({
          organizationId: ORG_2,
          contactId: foreign.contact.id,
          stage: "new",
          source: "web",
        }),
      ),
      "42501",
    );
    await expectSqlError(
      withTenant(ctx, (tx) =>
        // Solo la etapa, la unidad, el cierre y updated_at tienen UPDATE
        // (0008 a 0010): el resto de las columnas sigue sin él. Se prueban
        // en opportunity-stages, opportunity-vehicle-link y
        // opportunity-closure.test.ts.
        tx
          .update(opportunities)
          .set({ source: "web" })
          .where(eq(opportunities.id, own.id)),
      ),
      "42501",
    );
    await expectSqlError(
      withTenant(ctx, (tx) =>
        tx.delete(opportunities).where(eq(opportunities.id, own.id)),
      ),
      "42501",
    );
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
    const ctx = tenantContext(USER_C, ORG_1);
    const unfiltered = await withTenant(ctx, async (tx) =>
      (
        await tx
          .select({ id: opportunities.id })
          .from(opportunities)
          .innerJoin(
            contacts,
            and(
              eq(contacts.organizationId, opportunities.organizationId),
              eq(contacts.id, opportunities.contactId),
            ),
          )
      ).map((row) => row.id),
    );
    expect(unfiltered.sort()).toEqual(
      [...opportunityIdsOf(ORG_1), ...opportunityIdsOf(ORG_3)].sort(),
    );
    // El loader real filtra: el test de aislamiento de C pasa.
    request(USER_C, ORG_1);
    expect(await queueIds()).toEqual(opportunityIdsOf(ORG_1));
  });

  it("con RLS desactivado, el contexto falsificado cruzaría tenants; el catálogo también lo marca", async () => {
    const forged = tenantContext(USER_A, ORG_2);
    await db.admin`ALTER TABLE public.opportunities DISABLE ROW LEVEL SECURITY`;
    await db.admin`ALTER TABLE public.contacts DISABLE ROW LEVEL SECURITY`;
    try {
      expect(await forgedQueueIds(forged)).toEqual(opportunityIdsOf(ORG_2));
      const withoutRls = (await tenancy(db.admin))
        .filter((t) => !t.rls)
        .map((t) => t.table);
      expect(withoutRls).toEqual(["contacts", "opportunities"]);
    } finally {
      await db.admin`ALTER TABLE public.opportunities ENABLE ROW LEVEL SECURITY`;
      await db.admin`ALTER TABLE public.contacts ENABLE ROW LEVEL SECURITY`;
    }
    expect(await forgedQueueIds(forged)).toEqual([]);
  });

  it("con un grant directo a app_runtime, la lectura fuera del boundary deja de fallar con 42501; el catálogo lo marca", async () => {
    const pool = runtimePool();
    const outside = () => pool<{ id: string }[]>`
      SELECT id FROM public.opportunities ORDER BY id
    `;
    await db.admin`GRANT SELECT ON public.opportunities TO app_runtime`;
    try {
      // El test de C2 espera 42501: con el grant, la query ya no falla.
      // RLS todavía no devuelve filas (no hay policy para app_runtime).
      expect(await outside()).toEqual([]);
      expect(await tablePrivileges(db.admin, ["app_runtime"])).toEqual([
        "app_runtime SELECT opportunities",
      ]);
      // Con el grant y sin RLS, la lectura fuera del boundary ve todos los
      // tenants: por eso las dos barreras se prueban por separado.
      await db.admin`ALTER TABLE public.opportunities DISABLE ROW LEVEL SECURITY`;
      try {
        expect((await outside()).map((row) => row.id)).toEqual(
          OPPORTUNITIES.map((o) => o.id).sort(),
        );
      } finally {
        await db.admin`ALTER TABLE public.opportunities ENABLE ROW LEVEL SECURITY`;
      }
    } finally {
      await db.admin`REVOKE SELECT ON public.opportunities FROM app_runtime`;
    }
    await expect(outside()).rejects.toMatchObject({ code: "42501" });
    expect(await tablePrivileges(db.admin, ["app_runtime"])).toEqual([]);
  });
});
