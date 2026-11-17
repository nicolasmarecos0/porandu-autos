import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { getOpportunityQueue } from "@/db/queries/opportunities";
import { todayInAsuncion } from "@/domains/opportunities/closure";
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
  ORG_3,
  seedTenants,
  tenantContext,
  USER_A,
  USER_C,
} from "./support/tenants";
import { seedVehicles, VEHICLES } from "./support/vehicles";

/*
 * Señales de la cola contra PostgreSQL real (DEC-058): pruebas de manejo,
 * cotizaciones, el último mensaje del cliente y la toma vigente se leen por
 * lote dentro de withTenant(), con el filtro explícito por organización
 * sobre RLS, y alimentan Intent, "¿Por qué ahora?" y las tarjetas de match.
 *
 * - Ramón (ORG_1, En calificación) tiene una prueba confirmada para mañana,
 *   una cotización enviada y vigente, un mensaje de hace 2 h y un usado
 *   pendiente de tasar.
 * - Agroganadera (ORG_3) tiene una cotización aceptada. Un usuario con las
 *   dos organizaciones nunca ve las señales de la otra.
 * - Calcular no escribe nada.
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
const AGROGANADERA = OPPORTUNITIES[5]!.id; // ORG_3

const HILUX = VEHICLES.find(
  (v) => v.organizationId === ORG_1 && v.model === "Hilux",
)!.id;
const L200 = VEHICLES.find((v) => v.model === "L200 Triton")!.id; // ORG_3

let server: TestServer;
let db: TestDatabase;

beforeAll(async () => {
  server = await startTestServer();
  db = await server.createDatabase();
  await runMigrations(db.migrationUrl);
  await seedTenants(db.admin);
  await seedOpportunities(db.admin);
  await seedVehicles(db.admin);
  const quotedAt = new Date(NOW.getTime() - DAY);
  await db.admin.begin(async (tx) => {
    // La escena se fecha contra NOW: el mensaje no mueve la recencia que
    // fija la seed (el trigger de actividad de DEC-036 la pasaría a now()).
    await tx`ALTER TABLE public.messages DISABLE TRIGGER messages_touch_activity`;
    await tx`
      INSERT INTO public.messages
        (organization_id, contact_id, opportunity_id, channel, direction,
         content, recorded_by, created_at)
      VALUES
        (${ORG_1}, ${OPPORTUNITIES[0]!.contact.id}, ${RAMON}, 'whatsapp',
         'inbound', '¿Está disponible?', ${USER_A}, ${new Date(NOW.getTime() - 2 * HOUR)}),
        (${ORG_1}, ${OPPORTUNITIES[0]!.contact.id}, ${RAMON}, 'whatsapp',
         'outbound', 'Sí, te espero.', ${USER_A}, ${new Date(NOW.getTime() - HOUR)})
    `;
    await tx`ALTER TABLE public.messages ENABLE TRIGGER messages_touch_activity`;
    await tx`
      INSERT INTO public.test_drives ${tx({
        organization_id: ORG_1,
        opportunity_id: RAMON,
        vehicle_id: HILUX,
        status: "confirmed",
        scheduled_at: new Date(NOW.getTime() + DAY),
        created_by: USER_A,
      })}
    `;
    // Con el superusuario: estados y sellos que cumplen los CHECKs de 0016.
    await tx`
      INSERT INTO public.quotes ${tx({
        organization_id: ORG_1,
        opportunity_id: RAMON,
        vehicle_id: HILUX,
        status: "sent",
        currency: "USD",
        list_price: "48500.00",
        total_price: "48500.00",
        valid_until: todayInAsuncion(new Date(quotedAt.getTime() + 10 * DAY)),
        created_by: USER_A,
        approved_by: USER_A,
        approved_at: quotedAt,
        sent_at: quotedAt,
        created_at: quotedAt,
        updated_at: quotedAt,
      })}
    `;
    await tx`
      INSERT INTO public.quotes ${tx({
        organization_id: ORG_3,
        opportunity_id: AGROGANADERA,
        vehicle_id: L200,
        status: "accepted",
        currency: "USD",
        list_price: "39000.00",
        total_price: "39000.00",
        valid_until: todayInAsuncion(new Date(quotedAt.getTime() + 10 * DAY)),
        created_by: USER_C,
        approved_by: USER_C,
        approved_at: quotedAt,
        sent_at: quotedAt,
        decided_at: quotedAt,
        created_at: quotedAt,
        updated_at: quotedAt,
      })}
    `;
    await tx`
      INSERT INTO public.trade_ins ${tx({
        organization_id: ORG_1,
        opportunity_id: RAMON,
        brand: "Toyota",
        model: "Fortuner",
        year: 2019,
        created_by: USER_A,
      })}
    `;
  });
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

describe("señales de la cola real (DEC-058)", () => {
  it("Ramón: Intent con el mensaje, la prueba y la cotización de su organización", async () => {
    request(USER_A);
    const ramon = pick(await queueAt(NOW), RAMON);

    // 35 (En calificación) + 5 (activa) + 15 (escribió hace 2 h) + 15
    // (prueba confirmada para mañana) + 15 (cotización enviada y vigente).
    expect(ramon.scores.intent).toBe(85);
    expect(ramon.scoreExplanation?.factors.intent).toBe(
      "Etapa En calificación 35 · actividad al día +5 · escribió en las últimas 24 h +15 · prueba de manejo agendada +15 · cotización enviada +15",
    );
    expect(ramon.drivers.map((driver) => driver.label)).toEqual([
      "Prueba de manejo agendada",
      "Cotización enviada",
      "Interacción reciente",
      "Entrega un usado",
      "Tasación pendiente",
    ]);
    expect(
      ramon.drivers.find((driver) => driver.kind === "tradeIn")?.detail,
    ).toBe(
      "Ofrece su Toyota Fortuner 2019 en parte de pago: reduce el saldo a pagar.",
    );
    // Del mensaje solo viaja el momento, nunca el texto.
    expect(JSON.stringify(ramon)).not.toContain("¿Está disponible?");
  });

  it("sin señales, Intent sale de la etapa y la recencia", async () => {
    request(USER_A);
    const celeste = pick(await queueAt(NOW), CELESTE);
    expect(celeste.scores.intent).toBe(30);
    expect(celeste.drivers).toEqual([]);
  });

  it("C con ORG_1 activa no recibe las señales de ORG_3, y al revés", async () => {
    request(USER_C, ORG_1);
    const org1 = await queueAt(NOW);
    expect(org1.has(AGROGANADERA)).toBe(false);
    expect(pick(org1, RAMON).scores.intent).toBe(85);
    expect(
      [...org1.values()].flatMap((op) => op.drivers.map((d) => d.label)),
    ).not.toContain("Cotización aceptada");

    request(USER_C, ORG_3);
    const org3 = await queueAt(NOW);
    expect(org3.has(RAMON)).toBe(false);
    const agro = pick(org3, AGROGANADERA);
    expect(agro.drivers.map((driver) => driver.label)).toContain(
      "Cotización aceptada",
    );
    expect(agro.drivers.map((driver) => driver.label)).not.toContain(
      "Prueba de manejo agendada",
    );
  });

  it("contexto falsificado (A-03): RLS no deja leer señales ajenas", async () => {
    request(USER_A);
    mocks.forged = tenantContext(USER_A, ORG_3);
    try {
      expect((await getOpportunityQueue(NOW)).opportunities).toEqual([]);
    } finally {
      mocks.forged = null;
    }
  });

  it("calcular no escribe: mensajes, agenda, cotizaciones y tomas quedan intactos", async () => {
    const snapshot = () => db.admin`
      SELECT
        (SELECT json_agg(json_build_object('id', id, 'last_activity_at',
           last_activity_at, 'updated_at', updated_at) ORDER BY id)
           FROM public.opportunities) AS opportunities,
        (SELECT count(*) FROM public.messages) AS messages,
        (SELECT json_agg(json_build_object('id', id, 'status', status,
           'updated_at', updated_at) ORDER BY id) FROM public.test_drives) AS drives,
        (SELECT json_agg(json_build_object('id', id, 'status', status,
           'updated_at', updated_at) ORDER BY id) FROM public.quotes) AS quotes,
        (SELECT json_agg(json_build_object('id', id, 'status', status,
           'updated_at', updated_at) ORDER BY id) FROM public.trade_ins) AS trade_ins
    `;
    const before = await snapshot();
    request(USER_A);
    await getOpportunityQueue(NOW);
    request(USER_C, ORG_3);
    await getOpportunityQueue(NOW);
    expect(await snapshot()).toEqual(before);
  });
});
