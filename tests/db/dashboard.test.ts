import { count } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { getExecutiveDashboard } from "@/db/queries/dashboard";
import { getOpportunityQueue } from "@/db/queries/opportunities";
import { opportunities, vehicles } from "@/db/schema";
import { withTenant, type TenantContext } from "@/db/tenant";
import type { ExecutiveDashboard } from "@/domains/dashboard/metrics";
import { isTerminalStage, type Stage } from "@/domains/opportunities/stages";
import { ACTIVE_ORGANIZATION_COOKIE } from "@/lib/tenant/cookie";

import { cookieJar, type CookieJar } from "../unit/support/cookie-jar";
import { closureColumns } from "./support/closures";
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
} from "./support/tenants";

/*
 * Dashboard Directivo (Hito 5, DEC-037), de punta a punta contra
 * PostgreSQL 17 con las migraciones aplicadas:
 *
 *   request → requireTenant() → withTenant(): conteos de oportunidades,
 *   conteos del inventario y oportunidades en riesgo, filtrados por la
 *   organización activa → RLS → dominio → ViewModel
 *
 * El loader es el real, conectado como app_runtime. Supabase Auth (claims ya
 * verificados), la cookie y el redirect de Next son simulados, como en
 * opportunities.test.ts.
 *
 * NOW es el 14 de octubre de 2026 a las 10:30 de Asunción (UTC-3): el mes en
 * curso va del 2026-10-01T03:00Z (incluido) al 2026-11-01T03:00Z (excluido).
 * Cada organización tiene números distintos: si una lectura cruzara
 * tenants, el resultado cambiaría.
 *
 * ORG_1 (A, y C con ORG_1 activa):
 *   abiertas: Nueva hace 1 h (Activa) · En calificación hace 2 días exactos
 *   (Enfriándose) · En negociación hace 5 días exactos (Enfriándose, con U3)
 *   · En negociación hace 5 días y 1 min (Inactiva, con U4) · Nueva hace
 *   30 días (Inactiva) · En calificación con fecha futura (Activa).
 *   cerradas: Ganada el 5 oct (U1, inactiva hace 40 días: no cuenta en
 *   atención) · Ganada en el primer instante de octubre (U4) · Ganada en el
 *   último milisegundo de septiembre (U2) · Perdida el 10 oct (U5) · Perdida
 *   el 15 sep.
 *   unidades: U1 y U4 vendidas en octubre (U4 también negociada: vendida
 *   gana), U2 vendida en septiembre, U3 reservada, U5 solo con una perdida,
 *   U6 en preparación y U7 con `status = 'sold'` sin vínculos (el estado no
 *   se consulta: en stock).
 * ORG_2 (B): 2 ganadas en octubre (X1, X2), En negociación Inactiva (X3),
 *   Nueva Enfriándose, X4 libre.
 * ORG_3 (C con ORG_3 activa): Ganada en octubre (W1), 2 perdidas en octubre,
 *   En negociación Inactiva sin unidad, W2 libre.
 * ORG_4 (F): ninguna oportunidad ni unidad, hasta el caso de microsegundos
 *   (que agrega dos en los bordes de la recencia).
 * ORG_5 (G): 12 oportunidades Inactivas, para el tope de la lista.
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

/** 10:30 del 14 de octubre de 2026 en Asunción. */
const NOW = new Date("2026-10-14T13:30:00Z");
/** 20:00 del 30 de septiembre de 2026 en Asunción: todavía septiembre. */
const NOW_SEPTEMBER = new Date("2026-09-30T23:00:00Z");
/** 00:00 del 1 de octubre de 2026 en Asunción: primer instante del mes. */
const OCTOBER_START = new Date("2026-10-01T03:00:00.000Z");
/** 23:59:59.999 del 30 de septiembre en Asunción: último instante del mes. */
const SEPTEMBER_END = new Date("2026-10-01T02:59:59.999Z");

const ago = (ms: number) => new Date(NOW.getTime() - ms);

const ORG_4 = "00000000-0000-4000-8000-000000000004";
const ORG_5 = "00000000-0000-4000-8000-000000000005";
const USER_F = "00000000-0000-4000-8000-00000000000f";
const USER_G = "00000000-0000-4000-8000-000000000010";

const id = (n: number) =>
  `50000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

type SeedVehicle = Readonly<{
  id: string;
  organizationId: string;
  status: "in_preparation" | "available" | "reserved" | "sold";
}>;

type SeedOpportunity = Readonly<{
  id: string;
  organizationId: string;
  contactName: string;
  stage: Stage;
  vehicleId: string | null;
  lastActivityAt: Date;
  /** Última edición; en una cerrada, el cierre (DEC-037 §5). */
  updatedAt: Date;
}>;

const U = (n: number) => id(100 + n); // unidades de ORG_1
const X = (n: number) => id(200 + n); // unidades de ORG_2
const W = (n: number) => id(300 + n); // unidades de ORG_3

const VEHICLES: SeedVehicle[] = [
  { id: U(1), organizationId: ORG_1, status: "available" },
  { id: U(2), organizationId: ORG_1, status: "available" },
  { id: U(3), organizationId: ORG_1, status: "available" },
  { id: U(4), organizationId: ORG_1, status: "available" },
  { id: U(5), organizationId: ORG_1, status: "available" },
  { id: U(6), organizationId: ORG_1, status: "in_preparation" },
  { id: U(7), organizationId: ORG_1, status: "sold" },
  { id: X(1), organizationId: ORG_2, status: "available" },
  { id: X(2), organizationId: ORG_2, status: "available" },
  { id: X(3), organizationId: ORG_2, status: "available" },
  { id: X(4), organizationId: ORG_2, status: "available" },
  { id: W(1), organizationId: ORG_3, status: "available" },
  { id: W(2), organizationId: ORG_3, status: "available" },
];

const OCTOBER_5 = new Date("2026-10-05T15:00:00Z");
const OCTOBER_10 = new Date("2026-10-10T15:00:00Z");
const SEPTEMBER_15 = new Date("2026-09-15T15:00:00Z");

/** Las oportunidades de ORG_1 que se nombran en los tests. */
const O = {
  newActive: id(1001),
  qualifyingWarning: id(1002),
  negotiatingWarning: id(1003),
  negotiatingStale: id(1004),
  newStale: id(1005),
  futureActivity: id(1006),
  wonOctober: id(1007),
  wonOctoberStart: id(1008),
  wonSeptemberEnd: id(1009),
  lostOctober: id(1010),
  lostSeptember: id(1011),
} as const;

const ORG_2_STALE = id(2003);
const ORG_3_STALE = id(3004);

const OPPORTUNITIES: SeedOpportunity[] = [
  // ORG_1 — abiertas.
  {
    id: O.newActive,
    organizationId: ORG_1,
    contactName: "Celeste Báez",
    stage: "new",
    vehicleId: null,
    lastActivityAt: ago(HOUR),
    updatedAt: ago(HOUR),
  },
  {
    id: O.qualifyingWarning,
    organizationId: ORG_1,
    contactName: "Ramón Benítez",
    stage: "qualifying",
    vehicleId: null,
    // 2 días exactos: el primer minuto de Enfriándose.
    lastActivityAt: ago(2 * DAY),
    updatedAt: ago(2 * DAY),
  },
  {
    id: O.negotiatingWarning,
    organizationId: ORG_1,
    contactName: "Fátima Ortiz",
    stage: "negotiating",
    vehicleId: U(3),
    // 5 días exactos: todavía Enfriándose.
    lastActivityAt: ago(5 * DAY),
    updatedAt: ago(5 * DAY),
  },
  {
    id: O.negotiatingStale,
    organizationId: ORG_1,
    contactName: "Óscar Brítez",
    stage: "negotiating",
    vehicleId: U(4),
    // 5 días y 1 minuto: el primer minuto de Inactiva.
    lastActivityAt: ago(5 * DAY + MINUTE),
    updatedAt: ago(5 * DAY + MINUTE),
  },
  {
    id: O.newStale,
    organizationId: ORG_1,
    contactName: "Lucía Ferreira",
    stage: "new",
    vehicleId: null,
    lastActivityAt: ago(30 * DAY),
    updatedAt: ago(30 * DAY),
  },
  {
    id: O.futureActivity,
    organizationId: ORG_1,
    contactName: "Diego Acosta",
    stage: "qualifying",
    vehicleId: null,
    // Reloj desfasado: una fecha futura cuenta como Activa (DEC-035 §2).
    lastActivityAt: new Date(NOW.getTime() + HOUR),
    updatedAt: ago(HOUR),
  },
  // ORG_1 — cerradas.
  {
    id: O.wonOctober,
    organizationId: ORG_1,
    contactName: "Agroganadera del Norte",
    stage: "won",
    vehicleId: U(1),
    // Cerrada: aunque lleve 40 días sin actividad, no pide atención.
    lastActivityAt: ago(40 * DAY),
    updatedAt: OCTOBER_5,
  },
  {
    id: O.wonOctoberStart,
    organizationId: ORG_1,
    contactName: "María José Rolón",
    stage: "won",
    vehicleId: U(4),
    lastActivityAt: ago(14 * DAY),
    updatedAt: OCTOBER_START,
  },
  {
    id: O.wonSeptemberEnd,
    organizationId: ORG_1,
    contactName: "Hugo Giménez",
    stage: "won",
    vehicleId: U(2),
    lastActivityAt: ago(14 * DAY),
    updatedAt: SEPTEMBER_END,
  },
  {
    id: O.lostOctober,
    organizationId: ORG_1,
    contactName: "Carlos Duarte",
    stage: "lost",
    vehicleId: U(5),
    lastActivityAt: ago(8 * DAY),
    updatedAt: OCTOBER_10,
  },
  {
    id: O.lostSeptember,
    organizationId: ORG_1,
    contactName: "Rosa Villalba",
    stage: "lost",
    vehicleId: null,
    lastActivityAt: ago(40 * DAY),
    updatedAt: SEPTEMBER_15,
  },
  // ORG_2.
  {
    id: id(2001),
    organizationId: ORG_2,
    contactName: "Transportes Itapúa",
    stage: "won",
    vehicleId: X(1),
    lastActivityAt: ago(3 * DAY),
    updatedAt: OCTOBER_5,
  },
  {
    id: id(2002),
    organizationId: ORG_2,
    contactName: "Néstor Cabrera",
    stage: "won",
    vehicleId: X(2),
    lastActivityAt: ago(DAY),
    updatedAt: OCTOBER_10,
  },
  {
    id: ORG_2_STALE,
    organizationId: ORG_2,
    contactName: "Silvia Núñez",
    stage: "negotiating",
    vehicleId: X(3),
    lastActivityAt: ago(6 * DAY),
    updatedAt: ago(6 * DAY),
  },
  {
    id: id(2004),
    organizationId: ORG_2,
    contactName: "Pablo Insfrán",
    stage: "new",
    vehicleId: null,
    lastActivityAt: ago(3 * DAY),
    updatedAt: ago(3 * DAY),
  },
  // ORG_3.
  {
    id: id(3001),
    organizationId: ORG_3,
    contactName: "Estancia La Paz",
    stage: "won",
    vehicleId: W(1),
    lastActivityAt: ago(2 * HOUR),
    updatedAt: OCTOBER_10,
  },
  {
    id: id(3002),
    organizationId: ORG_3,
    contactName: "Liz Domínguez",
    stage: "lost",
    vehicleId: null,
    lastActivityAt: ago(9 * DAY),
    updatedAt: OCTOBER_5,
  },
  {
    id: id(3003),
    organizationId: ORG_3,
    contactName: "Víctor Paredes",
    stage: "lost",
    vehicleId: null,
    lastActivityAt: ago(7 * DAY),
    updatedAt: OCTOBER_10,
  },
  {
    id: ORG_3_STALE,
    organizationId: ORG_3,
    contactName: "Cooperativa Chortitzer",
    stage: "negotiating",
    vehicleId: null,
    lastActivityAt: ago(10 * DAY),
    updatedAt: ago(10 * DAY),
  },
  // ORG_5: 12 Inactivas, de 6 a 17 días sin actividad.
  ...Array.from({ length: 12 }, (_, index): SeedOpportunity => ({
    id: id(5001 + index),
    organizationId: ORG_5,
    contactName: `Cliente ${String(index + 1).padStart(2, "0")}`,
    stage: "qualifying",
    vehicleId: null,
    lastActivityAt: ago((6 + index) * DAY),
    updatedAt: ago((6 + index) * DAY),
  })),
];

async function seed(admin: TestDatabase["admin"]): Promise<void> {
  await admin.begin(async (tx) => {
    for (const [userId, organizationId] of [
      [USER_F, ORG_4],
      [USER_G, ORG_5],
    ] as const) {
      await tx`INSERT INTO auth.users (id) VALUES (${userId})`;
      await tx`INSERT INTO public.profiles (id) VALUES (${userId})`;
      await tx`
        INSERT INTO public.organizations (id, name)
        VALUES (${organizationId}, ${`Organización ${organizationId.at(-1)}`})
      `;
      await tx`
        INSERT INTO public.memberships (organization_id, user_id, role)
        VALUES (${organizationId}, ${userId}, 'admin')
      `;
    }
    for (const vehicle of VEHICLES) {
      await tx`
        INSERT INTO public.vehicles (id, organization_id, brand, model, year, status)
        VALUES (${vehicle.id}, ${vehicle.organizationId}, 'Toyota', 'Hilux', 2024, ${vehicle.status})
      `;
    }
    for (const op of OPPORTUNITIES) {
      const contactId = id(9000 + OPPORTUNITIES.indexOf(op));
      await tx`
        INSERT INTO public.contacts (id, organization_id, name)
        VALUES (${contactId}, ${op.organizationId}, ${op.contactName})
      `;
      await tx`
        INSERT INTO public.opportunities ${tx({
          id: op.id,
          organization_id: op.organizationId,
          contact_id: contactId,
          stage: op.stage,
          source: "web",
          vehicle_id: op.vehicleId,
          ...closureColumns(op.stage),
          last_activity_at: op.lastActivityAt,
          created_at: ago(60 * DAY),
          updated_at: op.updatedAt,
        })}
      `;
    }
  });
}

let server: TestServer;
let db: TestDatabase;

beforeAll(async () => {
  server = await startTestServer();
  db = await server.createDatabase();
  await runMigrations(db.migrationUrl);
  await seedTenants(db.admin);
  await seed(db.admin);
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

/** El dashboard con un contexto que Tenant Resolution no habría emitido. */
async function forgedDashboard(
  ctx: TenantContext,
): Promise<ExecutiveDashboard> {
  request(null);
  mocks.forged = ctx;
  try {
    return await getExecutiveDashboard(NOW);
  } finally {
    mocks.forged = null;
  }
}

const ORG_1_OCTOBER: ExecutiveDashboard = {
  periodLabel: "octubre de 2026",
  pipeline: { open: 6, won: 2, lost: 1, winRate: 66.7 },
  inventory: { inStock: 3, reserved: 1, sold: 2 },
  attention: { warning: 2, stale: 2 },
  atRisk: {
    items: [
      {
        id: O.newStale,
        contactName: "Lucía Ferreira",
        initials: "LF",
        stage: "new",
        daysInactive: 30,
      },
      {
        id: O.negotiatingStale,
        contactName: "Óscar Brítez",
        initials: "OB",
        stage: "negotiating",
        daysInactive: 5,
      },
    ],
    total: 2,
  },
};

const ORG_2_OCTOBER: ExecutiveDashboard = {
  periodLabel: "octubre de 2026",
  pipeline: { open: 2, won: 2, lost: 0, winRate: 100 },
  inventory: { inStock: 1, reserved: 1, sold: 2 },
  attention: { warning: 1, stale: 1 },
  atRisk: {
    items: [
      {
        id: ORG_2_STALE,
        contactName: "Silvia Núñez",
        initials: "SN",
        stage: "negotiating",
        daysInactive: 6,
      },
    ],
    total: 1,
  },
};

const ORG_3_OCTOBER: ExecutiveDashboard = {
  periodLabel: "octubre de 2026",
  pipeline: { open: 1, won: 1, lost: 2, winRate: 33.3 },
  inventory: { inStock: 1, reserved: 0, sold: 1 },
  attention: { warning: 0, stale: 1 },
  atRisk: {
    items: [
      {
        id: ORG_3_STALE,
        contactName: "Cooperativa Chortitzer",
        initials: "CC",
        stage: "negotiating",
        daysInactive: 10,
      },
    ],
    total: 1,
  },
};

const EMPTY_OCTOBER: ExecutiveDashboard = {
  periodLabel: "octubre de 2026",
  pipeline: { open: 0, won: 0, lost: 0, winRate: null },
  inventory: { inStock: 0, reserved: 0, sold: 0 },
  attention: { warning: 0, stale: 0 },
  atRisk: { items: [], total: 0 },
};

describe("loader real: requireTenant() → withTenant() → RLS", () => {
  it("A (ORG_1): pipeline, win rate, inventario, atención y riesgo del mes", async () => {
    request(USER_A);
    expect(await getExecutiveDashboard(NOW)).toEqual(ORG_1_OCTOBER);
  });

  it("B (ORG_2) ve solo los números de ORG_2", async () => {
    request(USER_B);
    expect(await getExecutiveDashboard(NOW)).toEqual(ORG_2_OCTOBER);
  });

  it("C con ORG_1 activa ve solo ORG_1, aunque RLS también le deja ver ORG_3 (filtro explícito)", async () => {
    request(USER_C, ORG_1);
    expect(await getExecutiveDashboard(NOW)).toEqual(ORG_1_OCTOBER);
  });

  it("C con ORG_3 activa ve solo ORG_3, nunca ORG_2 (membership inactiva)", async () => {
    request(USER_C, ORG_3);
    expect(await getExecutiveDashboard(NOW)).toEqual(ORG_3_OCTOBER);

    request(USER_C, ORG_2);
    expect(await redirectOf(getExecutiveDashboard(NOW))).toBe(
      "/select-organization",
    );
  });

  it("una organización sin datos: ceros y win rate sin dato, nunca 0 %", async () => {
    request(USER_F);
    expect(await getExecutiveDashboard(NOW)).toEqual(EMPTY_OCTOBER);
  });

  it("sin sesión o sin membership activa, no llega a la base: redirige", async () => {
    request(null);
    expect(await redirectOf(getExecutiveDashboard(NOW))).toBe("/login");
    request(USER_D);
    expect(await redirectOf(getExecutiveDashboard(NOW))).toBe("/no-access");
  });

  it("contexto falsificado (A-03): A con ORG_2 no cuenta ni ORG_2 ni ORG_1", async () => {
    expect(await forgedDashboard(tenantContext(USER_A, ORG_2))).toEqual(
      EMPTY_OCTOBER,
    );
  });
});

describe("el mes en curso es el de Asunción", () => {
  it("el primer instante de octubre cuenta en octubre; el último milisegundo de septiembre, en septiembre", async () => {
    request(USER_A);
    // Octubre (ORG_1_OCTOBER): la ganada del 5 y la del primer instante
    // (U1 y U4); no la del último milisegundo de septiembre (U2).
    expect((await getExecutiveDashboard(NOW)).pipeline).toEqual(
      ORG_1_OCTOBER.pipeline,
    );

    // Septiembre: la ganada del último milisegundo (U2) y la perdida del 15.
    const september = await getExecutiveDashboard(NOW_SEPTEMBER);
    expect(september.periodLabel).toBe("septiembre de 2026");
    expect(september.pipeline).toMatchObject({ won: 1, lost: 1, winRate: 50 });
    expect(september.inventory.sold).toBe(1);
  });
});

describe("la atención usa la misma regla de recencia que la cola", () => {
  it("los conteos de Enfriándose e Inactiva coinciden con el motor de la cola (DEC-035 §2)", async () => {
    request(USER_A);
    const { opportunities: queue } = await getOpportunityQueue(NOW);
    const open = queue.filter((op) => !isTerminalStage(op.stage));
    const byState = (state: string) =>
      open.filter((op) => op.lastActivity?.state === state).length;

    const dashboard = await getExecutiveDashboard(NOW);
    expect(dashboard.attention).toEqual({
      warning: byState("warning"),
      stale: byState("stale"),
    });
    expect(dashboard.pipeline.open).toBe(open.length);
    // Las Inactivas de la lista son las de la cola.
    expect(dashboard.atRisk.items.map((item) => item.id).sort()).toEqual(
      open
        .filter((op) => op.lastActivity?.state === "stale")
        .map((op) => op.id)
        .sort(),
    );
  });

  it("un minuto después, la que llevaba 5 días exactos pasa a Inactiva", async () => {
    request(USER_A);
    const later = await getExecutiveDashboard(new Date(NOW.getTime() + MINUTE));
    expect(later.attention).toEqual({ warning: 1, stale: 3 });
    expect(later.atRisk.items.map((item) => item.id)).toEqual([
      O.newStale,
      O.negotiatingStale,
      O.negotiatingWarning,
    ]);
  });

  it("con microsegundos en last_activity_at, la base clasifica igual que el motor", async () => {
    // timestamptz guarda microsegundos (now() los tiene) y JavaScript ve la
    // fecha truncada al milisegundo: en los bordes, 500 µs después del corte
    // siguen siendo Inactiva y Enfriándose para el motor (DEC-037 §8). El
    // valor viaja como texto: postgres.js trunca un parámetro timestamptz.
    // Se verifica abajo que la base guardó los microsegundos.
    const micro = (date: Date) => date.toISOString().replace("Z", "500Z");
    const edges = [
      [id(4001), "Borde Inactiva", micro(ago(5 * DAY + MINUTE))],
      [id(4002), "Borde Enfriándose", micro(ago(2 * DAY))],
    ] as const;
    for (const [opportunityId, name, lastActivityAt] of edges) {
      const contactId = id(Number(opportunityId.slice(-4)) + 4000);
      await db.admin`
        INSERT INTO public.contacts (id, organization_id, name)
        VALUES (${contactId}, ${ORG_4}, ${name})
      `;
      await db.admin`
        INSERT INTO public.opportunities
          (id, organization_id, contact_id, stage, source, last_activity_at)
        VALUES (${opportunityId}, ${ORG_4}, ${contactId}, 'qualifying', 'web', ${lastActivityAt}::text::timestamptz)
      `;
    }

    expect(
      (
        await db.admin<{ at: string }[]>`
          SELECT last_activity_at::text AS at FROM public.opportunities
          WHERE organization_id = ${ORG_4} ORDER BY id
        `
      ).map((row) => row.at),
    ).toEqual(["2026-10-09 13:29:00.0005+00", "2026-10-12 13:30:00.0005+00"]);

    request(USER_F);
    const { opportunities: queue } = await getOpportunityQueue(NOW);
    expect(
      queue.map((op) => [op.prospect.name, op.lastActivity?.state]).sort(),
    ).toEqual([
      ["Borde Enfriándose", "warning"],
      ["Borde Inactiva", "stale"],
    ]);
    const dashboard = await getExecutiveDashboard(NOW);
    expect(dashboard.attention).toEqual({ warning: 1, stale: 1 });
    expect(dashboard.atRisk.items.map((item) => item.id)).toEqual([id(4001)]);
  });
});

describe("oportunidades en riesgo", () => {
  it("muestra a lo sumo 10, de la más vieja a la más reciente, y dice cuántas hay", async () => {
    request(USER_G);
    const { attention, atRisk } = await getExecutiveDashboard(NOW);

    expect(attention).toEqual({ warning: 0, stale: 12 });
    expect(atRisk.total).toBe(12);
    expect(atRisk.items).toHaveLength(10);
    expect(atRisk.items.map((item) => item.daysInactive)).toEqual([
      17, 16, 15, 14, 13, 12, 11, 10, 9, 8,
    ]);
  });
});

describe("leer no escribe", () => {
  it("calcular el dashboard no modifica oportunidades ni unidades", async () => {
    const snapshot = async () => ({
      opportunities: await db.admin`
        SELECT id, stage, vehicle_id, last_activity_at, updated_at
        FROM public.opportunities ORDER BY id
      `,
      vehicles: await db.admin`
        SELECT id, status, updated_at FROM public.vehicles ORDER BY id
      `,
    });
    const before = await snapshot();
    request(USER_A);
    await getExecutiveDashboard(NOW);
    request(USER_B);
    await getExecutiveDashboard(NOW);
    expect(await snapshot()).toEqual(before);
  });

  it("una nota en una oportunidad cerrada mueve su actividad, no su fecha de cierre (DEC-037 §5)", async () => {
    const closure = async () => {
      const [row] = await db.admin<
        { updated_at: Date; last_activity_at: Date }[]
      >`
        SELECT updated_at, last_activity_at FROM public.opportunities
        WHERE id = ${O.wonSeptemberEnd}
      `;
      if (!row) throw new Error("missing opportunity");
      return row;
    };
    const before = await closure();
    // El toque de actividad (DEC-036) corre como en producción.
    await db.admin`
      INSERT INTO public.opportunity_notes (organization_id, opportunity_id, body, recorded_by)
      VALUES (${ORG_1}, ${O.wonSeptemberEnd}, 'Retiró la unidad.', ${USER_A})
    `;
    const after = await closure();
    expect(after.last_activity_at.getTime()).toBeGreaterThan(
      before.last_activity_at.getTime(),
    );
    expect(after.updated_at).toEqual(SEPTEMBER_END);

    request(USER_A);
    expect((await getExecutiveDashboard(NOW_SEPTEMBER)).pipeline).toMatchObject(
      { won: 1, lost: 1 },
    );
    expect(await getExecutiveDashboard(NOW)).toEqual(ORG_1_OCTOBER);
  });
});

/*
 * Mutaciones puntuales: cada caso rompe una de las barreras y muestra que
 * los tests de arriba la detectan. Las mutaciones de base se revierten
 * siempre.
 */
describe("mutaciones: los tests detectan cada barrera rota", () => {
  it("sin el filtro explícito por organización, C con ORG_3 activa contaría también ORG_1", async () => {
    // Mutante: los mismos conteos, sin el WHERE por organización.
    const ctx = tenantContext(USER_C, ORG_3);
    const unfiltered = await withTenant(ctx, async (tx) => ({
      opportunities:
        (await tx.select({ n: count() }).from(opportunities))[0]?.n ?? 0,
      vehicles: (await tx.select({ n: count() }).from(vehicles))[0]?.n ?? 0,
    }));
    const seeded = (organizationIds: string[]) => ({
      opportunities: OPPORTUNITIES.filter((op) =>
        organizationIds.includes(op.organizationId),
      ).length,
      vehicles: VEHICLES.filter((v) =>
        organizationIds.includes(v.organizationId),
      ).length,
    });
    expect(unfiltered).toEqual(seeded([ORG_1, ORG_3]));
    // El loader real filtra: el test de aislamiento de C pasa.
    request(USER_C, ORG_3);
    expect(await getExecutiveDashboard(NOW)).toEqual(ORG_3_OCTOBER);
  });

  it("con RLS desactivado, el contexto falsificado contaría ORG_2: el filtro explícito no alcanza solo", async () => {
    const forged = tenantContext(USER_A, ORG_2);
    await db.admin`ALTER TABLE public.opportunities DISABLE ROW LEVEL SECURITY`;
    await db.admin`ALTER TABLE public.vehicles DISABLE ROW LEVEL SECURITY`;
    await db.admin`ALTER TABLE public.contacts DISABLE ROW LEVEL SECURITY`;
    try {
      // El filtro usa la organización del contexto: la falsificada pasa.
      expect(await forgedDashboard(forged)).toEqual(ORG_2_OCTOBER);
    } finally {
      await db.admin`ALTER TABLE public.opportunities ENABLE ROW LEVEL SECURITY`;
      await db.admin`ALTER TABLE public.vehicles ENABLE ROW LEVEL SECURITY`;
      await db.admin`ALTER TABLE public.contacts ENABLE ROW LEVEL SECURITY`;
    }
    // Con RLS, el mismo contexto no ve nada.
    expect(await forgedDashboard(forged)).toEqual(EMPTY_OCTOBER);
  });
});
