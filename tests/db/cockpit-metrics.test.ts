import { count } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { getCockpitMetrics } from "@/db/queries/cockpit-metrics";
import { opportunities, quotes, testDrives, vehicles } from "@/db/schema";
import { withTenant, type TenantContext } from "@/db/tenant";
import type { CockpitMetrics } from "@/domains/cockpit/metrics";
import { ACTIVE_ORGANIZATION_COOKIE } from "@/lib/tenant/cookie";
import { resolveTenant } from "@/lib/tenant/resolution";

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
  USER_E,
} from "./support/tenants";

/*
 * Métricas del salón (propuesta DEC-050), de punta a punta contra
 * PostgreSQL con las migraciones aplicadas:
 *
 *   request → requireTenant() → withTenant(): oportunidades abiertas,
 *   cierres del período, cotizaciones en juego, pruebas del período y stock,
 *   filtrados por la organización activa → RLS → dominio → ViewModel
 *
 * El loader es el real, conectado como app_runtime. Supabase Auth (claims
 * ya verificados), la cookie y el redirect de Next son simulados, como en
 * dashboard.test.ts.
 *
 * NOW es el martes 3 de noviembre de 2026 a las 14:30 de Asunción (UTC−3).
 * Los últimos 30 días van del 2026-10-05T03:00Z (incluido) al
 * 2026-11-04T03:00Z (excluido); los 7, desde el 2026-10-28T03:00Z; los 90,
 * desde el 2026-08-06T03:00Z. Cada organización tiene números distintos: si
 * una lectura cruzara tenants, el resultado cambiaría.
 *
 * ORG_1 (A, y C con ORG_1 activa):
 *   abiertas: 2 Nuevas (activa e Inactiva) · En calificación hace 2 días
 *   exactos (Enfriándose) · En negociación hace 5 días exactos (Enfriándose)
 *   · En negociación hace 5 días y 1 minuto (Inactiva).
 *   cerradas: ganadas el 20 oct (20 días de ciclo), el 1 nov (10 días) y 1 ms
 *   antes del piso de 30 días (60 días) · perdidas por precio en el primer
 *   instante del piso y el 30 oct, por "dejó de responder" el 15 oct y por
 *   la competencia el 1 jul.
 *   cotizaciones: aprobada USD 32.990,50 · enviadas USD 49.900 (vence hoy) y
 *   USD 61.500 · enviada Gs. 245.000.000 · afuera: enviada vencida ayer,
 *   borrador, aprobada de una ganada y aceptada.
 *   pruebas: realizadas el 2 nov y el 10 oct (y el 1 sep, solo en 90 días)
 *   · no asistió el 29 oct · cancelada el 20 oct · abiertas vencidas el
 *   1 nov y justo en la frontera · en horario hace 59 min y en 2 h · afuera:
 *   mañana y cancelada justo en el fin del período.
 *   unidades: en preparación · disponibles USD 49.900, USD 32.990,50,
 *   Gs. 245.000.000 y sin precio · reservada USD 61.000 · vendida.
 * ORG_2 (B): Nueva activa, En negociación Inactiva, ganada el 20 oct,
 *   enviada USD 10.000, una realizada y una disponible.
 * ORG_3 (C con ORG_3 activa): perdida por financiación el 30 oct y dos
 *   unidades de USD 999.999.999.999,99 (la suma no entra en un float).
 * ORG_4 (F): nada.
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

/** 14:30 del martes 3 de noviembre de 2026 en Asunción. */
const NOW = new Date("2026-11-03T17:30:00Z");
/** Piso de los últimos 30 días: 00:00 del 5 de octubre de Asunción. */
const FLOOR_30 = new Date("2026-10-05T03:00:00.000Z");
/** Fin del período: 00:00 de mañana (4 de noviembre) en Asunción. */
const PERIOD_END = new Date("2026-11-04T03:00:00.000Z");

const ago = (ms: number) => new Date(NOW.getTime() - ms);

const ORG_4 = "00000000-0000-4000-8000-000000000004";
const USER_F = "00000000-0000-4000-8000-00000000000f";

const id = (n: number) =>
  `60000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

const U = (n: number) => id(100 + n); // unidades de ORG_1
const X = (n: number) => id(200 + n); // unidades de ORG_2
const W = (n: number) => id(300 + n); // unidades de ORG_3

type VehicleStatus = "in_preparation" | "available" | "reserved" | "sold";

type SeedVehicle = Readonly<{
  id: string;
  organizationId: string;
  status: VehicleStatus;
  price: string | null;
  currency: "PYG" | "USD" | null;
  createdAt: Date;
}>;

const VEHICLES: SeedVehicle[] = [
  {
    id: U(1),
    organizationId: ORG_1,
    status: "in_preparation",
    price: null,
    currency: null,
    createdAt: ago(5 * DAY),
  },
  {
    id: U(2),
    organizationId: ORG_1,
    status: "available",
    price: "49900.00",
    currency: "USD",
    createdAt: ago(10 * DAY),
  },
  {
    id: U(3),
    organizationId: ORG_1,
    status: "available",
    price: "32990.50",
    currency: "USD",
    createdAt: ago(20 * DAY),
  },
  {
    id: U(4),
    organizationId: ORG_1,
    status: "available",
    price: "245000000.00",
    currency: "PYG",
    createdAt: ago(30 * DAY),
  },
  {
    id: U(5),
    organizationId: ORG_1,
    status: "available",
    price: null,
    currency: null,
    createdAt: ago(40 * DAY),
  },
  {
    id: U(6),
    organizationId: ORG_1,
    status: "reserved",
    price: "61000.00",
    currency: "USD",
    createdAt: ago(50 * DAY),
  },
  {
    id: U(7),
    organizationId: ORG_1,
    status: "sold",
    price: "45000.00",
    currency: "USD",
    createdAt: ago(200 * DAY),
  },
  {
    id: X(1),
    organizationId: ORG_2,
    status: "available",
    price: "10000.00",
    currency: "USD",
    createdAt: ago(3 * DAY),
  },
  {
    id: W(1),
    organizationId: ORG_3,
    status: "available",
    price: "999999999999.99",
    currency: "USD",
    createdAt: ago(DAY),
  },
  {
    id: W(2),
    organizationId: ORG_3,
    status: "reserved",
    price: "999999999999.99",
    currency: "USD",
    createdAt: ago(3 * DAY),
  },
];

type Stage = "new" | "qualifying" | "negotiating" | "won" | "lost";
type LossReason =
  | "price"
  | "vehicle_unavailable"
  | "competitor"
  | "financing_rejected"
  | "ghosted"
  | "other";

type SeedOpportunity = Readonly<{
  id: string;
  organizationId: string;
  stage: Stage;
  vehicleId: string | null;
  lastActivityAt: Date;
  createdAt: Date;
  /** Última edición; en una cerrada, el cierre (DEC-037 §5). */
  updatedAt: Date;
  lossReason?: LossReason;
}>;

const O = {
  newActive: id(1001),
  newStale: id(1002),
  qualifyingWarning: id(1003),
  negotiatingWarning: id(1004),
  negotiatingStale: id(1005),
  wonOctober: id(1006),
  wonNovember: id(1007),
  wonBeforeFloor: id(1008),
  lostAtFloor: id(1009),
  lostRecent: id(1010),
  lostGhosted: id(1011),
  lostJuly: id(1012),
} as const;

const ORG_2_STALE = id(2002);

/** Cerrada el `closedAt`, nacida `cycleDays` antes. */
const closed = (
  closedAt: Date,
  cycleDays: number,
): Pick<SeedOpportunity, "createdAt" | "updatedAt" | "lastActivityAt"> => ({
  createdAt: new Date(closedAt.getTime() - cycleDays * DAY),
  updatedAt: closedAt,
  lastActivityAt: closedAt,
});

const open = (
  lastActivityAt: Date,
): Pick<SeedOpportunity, "createdAt" | "updatedAt" | "lastActivityAt"> => ({
  createdAt: ago(60 * DAY),
  updatedAt: lastActivityAt,
  lastActivityAt,
});

const OPPORTUNITIES: SeedOpportunity[] = [
  // ORG_1 — abiertas.
  {
    id: O.newActive,
    organizationId: ORG_1,
    stage: "new",
    vehicleId: null,
    ...open(ago(HOUR)),
  },
  {
    id: O.newStale,
    organizationId: ORG_1,
    stage: "new",
    vehicleId: null,
    ...open(ago(30 * DAY)),
  },
  {
    id: O.qualifyingWarning,
    organizationId: ORG_1,
    stage: "qualifying",
    vehicleId: null,
    // 2 días exactos: el primer minuto de Enfriándose.
    ...open(ago(2 * DAY)),
  },
  {
    id: O.negotiatingWarning,
    organizationId: ORG_1,
    stage: "negotiating",
    vehicleId: U(2),
    // 5 días exactos: todavía Enfriándose.
    ...open(ago(5 * DAY)),
  },
  {
    id: O.negotiatingStale,
    organizationId: ORG_1,
    stage: "negotiating",
    vehicleId: U(3),
    // 5 días y 1 minuto: el primer minuto de Inactiva.
    ...open(ago(5 * DAY + MINUTE)),
  },
  // ORG_1 — cerradas.
  {
    id: O.wonOctober,
    organizationId: ORG_1,
    stage: "won",
    vehicleId: U(7),
    ...closed(new Date("2026-10-20T15:00:00Z"), 20),
  },
  {
    id: O.wonNovember,
    organizationId: ORG_1,
    stage: "won",
    vehicleId: U(6),
    ...closed(new Date("2026-11-01T15:00:00Z"), 10),
  },
  {
    id: O.wonBeforeFloor,
    organizationId: ORG_1,
    stage: "won",
    vehicleId: U(4),
    // Un milisegundo antes del piso de 30 días: queda afuera.
    ...closed(new Date(FLOOR_30.getTime() - 1), 60),
  },
  {
    id: O.lostAtFloor,
    organizationId: ORG_1,
    stage: "lost",
    vehicleId: null,
    // El primer instante del piso: entra.
    ...closed(FLOOR_30, 5),
    lossReason: "price",
  },
  {
    id: O.lostRecent,
    organizationId: ORG_1,
    stage: "lost",
    vehicleId: U(5),
    ...closed(new Date("2026-10-30T15:00:00Z"), 5),
    lossReason: "price",
  },
  {
    id: O.lostGhosted,
    organizationId: ORG_1,
    stage: "lost",
    vehicleId: null,
    ...closed(new Date("2026-10-15T15:00:00Z"), 5),
    lossReason: "ghosted",
  },
  {
    id: O.lostJuly,
    organizationId: ORG_1,
    stage: "lost",
    vehicleId: null,
    ...closed(new Date("2026-07-01T15:00:00Z"), 5),
    lossReason: "competitor",
  },
  // ORG_2.
  {
    id: id(2001),
    organizationId: ORG_2,
    stage: "new",
    vehicleId: null,
    ...open(ago(HOUR)),
  },
  {
    id: ORG_2_STALE,
    organizationId: ORG_2,
    stage: "negotiating",
    vehicleId: X(1),
    ...open(ago(10 * DAY)),
  },
  {
    id: id(2003),
    organizationId: ORG_2,
    stage: "won",
    vehicleId: X(1),
    ...closed(new Date("2026-10-20T15:00:00Z"), 5),
  },
  // ORG_3.
  {
    id: id(3001),
    organizationId: ORG_3,
    stage: "lost",
    vehicleId: null,
    ...closed(new Date("2026-10-30T15:00:00Z"), 2),
    lossReason: "financing_rejected",
  },
];

type QuoteStatus =
  "draft" | "approved" | "sent" | "accepted" | "rejected" | "withdrawn";

type SeedQuote = Readonly<{
  organizationId: string;
  opportunityId: string;
  vehicleId: string;
  status: QuoteStatus;
  currency: "PYG" | "USD";
  total: string;
  /** Último día de validez, inclusive (DEC-042 §4). */
  validUntil: string;
  createdBy: string;
}>;

/** Alta de las cotizaciones: 25 oct en Asunción (validez hasta el 24 nov). */
const QUOTED_AT = new Date("2026-10-25T15:00:00Z");

const QUOTES: SeedQuote[] = [
  // ORG_1 — en juego.
  {
    organizationId: ORG_1,
    opportunityId: O.negotiatingWarning,
    vehicleId: U(3),
    status: "approved",
    currency: "USD",
    total: "32990.50",
    validUntil: "2026-11-10",
    createdBy: USER_A,
  },
  {
    organizationId: ORG_1,
    opportunityId: O.negotiatingStale,
    vehicleId: U(2),
    status: "sent",
    currency: "USD",
    total: "49900.00",
    // Último día de validez hoy: todavía vigente.
    validUntil: "2026-11-03",
    createdBy: USER_A,
  },
  {
    organizationId: ORG_1,
    opportunityId: O.qualifyingWarning,
    vehicleId: U(6),
    status: "sent",
    currency: "USD",
    total: "61500.00",
    validUntil: "2026-11-20",
    createdBy: USER_C,
  },
  {
    organizationId: ORG_1,
    opportunityId: O.negotiatingWarning,
    vehicleId: U(4),
    status: "sent",
    currency: "PYG",
    total: "245000000.00",
    validUntil: "2026-11-15",
    createdBy: USER_A,
  },
  // ORG_1 — afuera: vencida, borrador, de una ganada y terminal.
  {
    organizationId: ORG_1,
    opportunityId: O.negotiatingStale,
    vehicleId: U(2),
    status: "sent",
    currency: "USD",
    total: "50000.00",
    validUntil: "2026-11-02",
    createdBy: USER_A,
  },
  {
    organizationId: ORG_1,
    opportunityId: O.qualifyingWarning,
    vehicleId: U(3),
    status: "draft",
    currency: "USD",
    total: "40000.00",
    validUntil: "2026-11-20",
    createdBy: USER_A,
  },
  {
    organizationId: ORG_1,
    opportunityId: O.wonOctober,
    vehicleId: U(7),
    status: "approved",
    currency: "USD",
    total: "45000.00",
    validUntil: "2026-11-20",
    createdBy: USER_A,
  },
  {
    organizationId: ORG_1,
    opportunityId: O.negotiatingWarning,
    vehicleId: U(2),
    status: "accepted",
    currency: "USD",
    total: "47500.00",
    validUntil: "2026-11-20",
    createdBy: USER_A,
  },
  // ORG_2.
  {
    organizationId: ORG_2,
    opportunityId: ORG_2_STALE,
    vehicleId: X(1),
    status: "sent",
    currency: "USD",
    total: "10000.00",
    validUntil: "2026-11-10",
    createdBy: USER_B,
  },
];

type SeedTestDrive = Readonly<{
  organizationId: string;
  opportunityId: string;
  vehicleId: string;
  status: "scheduled" | "confirmed" | "completed" | "no_show" | "cancelled";
  scheduledAt: Date;
  createdBy: string;
}>;

const drive = (
  status: SeedTestDrive["status"],
  scheduledAt: Date,
): SeedTestDrive => ({
  organizationId: ORG_1,
  opportunityId: O.negotiatingWarning,
  vehicleId: U(2),
  status,
  scheduledAt,
  createdBy: USER_A,
});

const TEST_DRIVES: SeedTestDrive[] = [
  drive("completed", new Date("2026-11-02T13:00:00Z")),
  drive("completed", new Date("2026-10-10T13:00:00Z")),
  drive("completed", new Date("2026-09-01T13:00:00Z")),
  drive("no_show", new Date("2026-10-29T13:00:00Z")),
  drive("cancelled", new Date("2026-10-20T13:00:00Z")),
  // Abiertas con la franja terminada: vencidas.
  drive("scheduled", new Date("2026-11-01T13:00:00Z")),
  // Justo en la frontera (ahora − 60 min): ya vencida.
  drive("confirmed", ago(HOUR)),
  // En horario: en curso y por venir hoy.
  drive("scheduled", ago(59 * MINUTE)),
  drive("confirmed", new Date(NOW.getTime() + 2 * HOUR)),
  // Afuera: mañana y justo en el fin del período (exclusivo).
  drive("scheduled", new Date("2026-11-04T13:00:00Z")),
  drive("cancelled", PERIOD_END),
  // ORG_2.
  {
    organizationId: ORG_2,
    opportunityId: ORG_2_STALE,
    vehicleId: X(1),
    status: "completed",
    scheduledAt: new Date("2026-10-21T13:00:00Z"),
    createdBy: USER_B,
  },
];

const isApproved = (status: QuoteStatus) =>
  status === "approved" ||
  status === "sent" ||
  status === "accepted" ||
  status === "rejected";
const isSent = (status: QuoteStatus) =>
  status === "sent" || status === "accepted" || status === "rejected";
const isDecided = (status: QuoteStatus) =>
  status === "accepted" || status === "rejected" || status === "withdrawn";

async function seed(admin: TestDatabase["admin"]): Promise<void> {
  await admin.begin(async (tx) => {
    await tx`INSERT INTO auth.users (id) VALUES (${USER_F})`;
    await tx`INSERT INTO public.profiles (id) VALUES (${USER_F})`;
    await tx`
      INSERT INTO public.organizations (id, name)
      VALUES (${ORG_4}, 'Organización 4')
    `;
    await tx`
      INSERT INTO public.memberships (organization_id, user_id, role)
      VALUES (${ORG_4}, ${USER_F}, 'admin')
    `;
    for (const vehicle of VEHICLES) {
      await tx`
        INSERT INTO public.vehicles ${tx({
          id: vehicle.id,
          organization_id: vehicle.organizationId,
          brand: "Toyota",
          model: "Hilux",
          year: 2024,
          status: vehicle.status,
          price: vehicle.price,
          currency: vehicle.currency,
          created_at: vehicle.createdAt,
          updated_at: vehicle.createdAt,
        })}
      `;
    }
    for (const [index, op] of OPPORTUNITIES.entries()) {
      const contactId = id(9000 + index);
      await tx`
        INSERT INTO public.contacts (id, organization_id, name)
        VALUES (${contactId}, ${op.organizationId}, ${`Cliente ${index}`})
      `;
      const closure = closureColumns(op.stage);
      await tx`
        INSERT INTO public.opportunities ${tx({
          id: op.id,
          organization_id: op.organizationId,
          contact_id: contactId,
          stage: op.stage,
          source: "web",
          vehicle_id: op.vehicleId,
          ...closure,
          loss_reason: op.lossReason ?? closure.loss_reason,
          last_activity_at: op.lastActivityAt,
          created_at: op.createdAt,
          updated_at: op.updatedAt,
        })}
      `;
    }
    // Con el superusuario: los estados y sellos de cada cotización cumplen
    // los CHECKs de 0016 (el número lo asigna el trigger).
    for (const quote of QUOTES) {
      await tx`
        INSERT INTO public.quotes ${tx({
          organization_id: quote.organizationId,
          opportunity_id: quote.opportunityId,
          vehicle_id: quote.vehicleId,
          status: quote.status,
          currency: quote.currency,
          list_price: quote.total,
          total_price: quote.total,
          valid_until: quote.validUntil,
          created_by: quote.createdBy,
          approved_by: isApproved(quote.status) ? quote.createdBy : null,
          approved_at: isApproved(quote.status) ? QUOTED_AT : null,
          sent_at: isSent(quote.status) ? QUOTED_AT : null,
          decided_at: isDecided(quote.status) ? QUOTED_AT : null,
          created_at: QUOTED_AT,
          updated_at: QUOTED_AT,
        })}
      `;
    }
    for (const testDrive of TEST_DRIVES) {
      await tx`
        INSERT INTO public.test_drives ${tx({
          organization_id: testDrive.organizationId,
          opportunity_id: testDrive.opportunityId,
          vehicle_id: testDrive.vehicleId,
          status: testDrive.status,
          scheduled_at: testDrive.scheduledAt,
          created_by: testDrive.createdBy,
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

/** Las métricas del loader, que para un admin siempre están listas. */
async function readyMetrics(
  ...args: Parameters<typeof getCockpitMetrics>
): Promise<CockpitMetrics> {
  const result = await getCockpitMetrics(...args);
  if (result.kind !== "ready") throw new Error("expected ready metrics");
  return result.metrics;
}

/**
 * Un contexto falsificado con rol admin (A-03): la vista directiva es de la
 * gerencia (DEC-054 §5), así que el aislamiento se prueba con un admin; un
 * seller no llega ni a la base.
 */
function forgedAdmin(userId: string, organizationId: string): TenantContext {
  const resolution = resolveTenant(
    { userId, claims: { sub: userId, role: "authenticated" } },
    [{ organizationId, organizationName: "Organización", role: "admin" }],
    undefined,
  );
  if (resolution.kind !== "resolved") throw new Error("unresolved tenant");
  return resolution.context;
}

/** Las métricas con un contexto que Tenant Resolution no habría emitido. */
async function forgedMetrics(ctx: TenantContext): Promise<CockpitMetrics> {
  request(null);
  mocks.forged = ctx;
  try {
    return await readyMetrics({}, NOW);
  } finally {
    mocks.forged = null;
  }
}

/** Lo que no depende de la organización: el período y la hora. */
const READ = {
  period: {
    kind: "30d",
    from: "2026-10-05",
    to: "2026-11-03",
    days: 30,
    label: "Últimos 30 días: 5 oct – 3 nov 2026",
    isDefault: true,
  },
  notice: null,
  generatedAt: "2026-11-03T17:30:00.000Z",
  generatedLabel: "14:30",
} as const;

const NO_QUOTE = { count: 0, amount: "0.00" } as const;

const NO_QUOTE_VALUE: CockpitMetrics["quoteValue"] = ["PYG", "USD"].map(
  (currency) => ({
    currency: currency as "PYG" | "USD",
    total: NO_QUOTE,
    approved: { ...NO_QUOTE, share: null },
    sent: { ...NO_QUOTE, share: null },
  }),
);

const EMPTY: CockpitMetrics = {
  ...READ,
  funnel: {
    open: 0,
    stages: [
      { stage: "new", count: 0, share: null },
      { stage: "qualifying", count: 0, share: null },
      { stage: "negotiating", count: 0, share: null },
    ],
  },
  conversion: { won: 0, lost: 0, closed: 0, rate: null },
  salesCycle: { won: 0, averageDays: null },
  lossReasons: { lost: 0, reasons: [] },
  quoteValue: NO_QUOTE_VALUE,
  testDrives: {
    completed: 0,
    noShow: 0,
    cancelled: 0,
    overdue: 0,
    upcoming: 0,
    due: 0,
    rate: null,
  },
  attention: { open: 0, active: 0, warning: 0, stale: 0, needsAttention: 0 },
  stock: {
    total: 0,
    statuses: [
      { status: "inPreparation", count: 0, share: null },
      { status: "available", count: 0, share: null },
      { status: "reserved", count: 0, share: null },
      { status: "sold", count: 0, share: null },
    ],
    published: 0,
    valuation: [
      { currency: "PYG", units: 0, amount: "0.00" },
      { currency: "USD", units: 0, amount: "0.00" },
    ],
    unpriced: 0,
    averageAgeDays: null,
  },
};

const ORG_1_30_DAYS: CockpitMetrics = {
  ...READ,
  funnel: {
    open: 5,
    stages: [
      { stage: "new", count: 2, share: 40 },
      { stage: "qualifying", count: 1, share: 20 },
      { stage: "negotiating", count: 2, share: 40 },
    ],
  },
  // Ganadas el 20 oct y el 1 nov; perdidas en el piso, el 30 y el 15 oct.
  conversion: { won: 2, lost: 3, closed: 5, rate: 40 },
  salesCycle: { won: 2, averageDays: 15 },
  lossReasons: {
    lost: 3,
    reasons: [
      { reason: "price", count: 2, share: 66.7 },
      { reason: "ghosted", count: 1, share: 33.3 },
    ],
  },
  quoteValue: [
    {
      currency: "PYG",
      total: { count: 1, amount: "245000000.00" },
      approved: { count: 0, amount: "0.00", share: 0 },
      sent: { count: 1, amount: "245000000.00", share: 100 },
    },
    {
      currency: "USD",
      total: { count: 3, amount: "144390.50" },
      approved: { count: 1, amount: "32990.50", share: 22.8 },
      sent: { count: 2, amount: "111400.00", share: 77.2 },
    },
  ],
  testDrives: {
    completed: 2,
    noShow: 1,
    cancelled: 1,
    overdue: 2,
    upcoming: 2,
    due: 6,
    rate: 33.3,
  },
  attention: { open: 5, active: 1, warning: 2, stale: 2, needsAttention: 4 },
  stock: {
    total: 7,
    statuses: [
      { status: "inPreparation", count: 1, share: 14.3 },
      { status: "available", count: 4, share: 57.1 },
      { status: "reserved", count: 1, share: 14.3 },
      { status: "sold", count: 1, share: 14.3 },
    ],
    published: 5,
    valuation: [
      { currency: "PYG", units: 1, amount: "245000000.00" },
      { currency: "USD", units: 3, amount: "143890.50" },
    ],
    unpriced: 1,
    // (10 + 20 + 30 + 40 + 50) días / 5 publicadas.
    averageAgeDays: 30,
  },
};

const ORG_2_30_DAYS: CockpitMetrics = {
  ...EMPTY,
  funnel: {
    open: 2,
    stages: [
      { stage: "new", count: 1, share: 50 },
      { stage: "qualifying", count: 0, share: 0 },
      { stage: "negotiating", count: 1, share: 50 },
    ],
  },
  conversion: { won: 1, lost: 0, closed: 1, rate: 100 },
  salesCycle: { won: 1, averageDays: 5 },
  quoteValue: [
    NO_QUOTE_VALUE[0]!,
    {
      currency: "USD",
      total: { count: 1, amount: "10000.00" },
      approved: { count: 0, amount: "0.00", share: 0 },
      sent: { count: 1, amount: "10000.00", share: 100 },
    },
  ],
  testDrives: { ...EMPTY.testDrives, completed: 1, due: 1, rate: 100 },
  attention: { open: 2, active: 1, warning: 0, stale: 1, needsAttention: 1 },
  stock: {
    ...EMPTY.stock,
    total: 1,
    statuses: [
      { status: "inPreparation", count: 0, share: 0 },
      { status: "available", count: 1, share: 100 },
      { status: "reserved", count: 0, share: 0 },
      { status: "sold", count: 0, share: 0 },
    ],
    published: 1,
    valuation: [
      { currency: "PYG", units: 0, amount: "0.00" },
      { currency: "USD", units: 1, amount: "10000.00" },
    ],
    averageAgeDays: 3,
  },
};

describe("loader real: requireTenant() → withTenant() → RLS", () => {
  it("A (ORG_1): embudo, conversión, motivos, ciclo, plata en juego, pruebas, atención y stock de los últimos 30 días", async () => {
    request(USER_A);
    expect(await readyMetrics({}, NOW)).toEqual(ORG_1_30_DAYS);
  });

  it("B (ORG_2) ve solo los números de ORG_2", async () => {
    request(USER_B);
    expect(await readyMetrics({}, NOW)).toEqual(ORG_2_30_DAYS);
  });

  it("C con ORG_1 activa es seller: la vista directiva queda restringida (DEC-054 §5)", async () => {
    request(USER_C, ORG_1);
    expect(await getCockpitMetrics({}, NOW)).toEqual({ kind: "restricted" });
  });

  it("C con ORG_3 activa ve solo ORG_3, con la suma exacta que un float no representa; nunca ORG_2 (inactiva)", async () => {
    request(USER_C, ORG_3);
    const metrics = await readyMetrics({}, NOW);
    expect(metrics.lossReasons).toEqual({
      lost: 1,
      reasons: [{ reason: "financing_rejected", count: 1, share: 100 }],
    });
    expect(metrics.conversion).toEqual({
      won: 0,
      lost: 1,
      closed: 1,
      rate: 0,
    });
    expect(metrics.stock.valuation).toEqual([
      { currency: "PYG", units: 0, amount: "0.00" },
      { currency: "USD", units: 2, amount: "1999999999999.98" },
    ]);
    expect(metrics.stock.averageAgeDays).toBe(2);
    expect(metrics.funnel.open).toBe(0);

    request(USER_C, ORG_2);
    expect(await redirectOf(getCockpitMetrics({}, NOW))).toBe(
      "/select-organization",
    );
  });

  it("una organización sin datos: ceros y las tasas sin dato, nunca 0 %", async () => {
    request(USER_F);
    expect(await readyMetrics({}, NOW)).toEqual(EMPTY);
  });

  it("sin sesión o sin membership activa, no llega a la base: redirige", async () => {
    request(null);
    expect(await redirectOf(getCockpitMetrics({}, NOW))).toBe("/login");
    request(USER_D);
    expect(await redirectOf(getCockpitMetrics({}, NOW))).toBe("/no-access");
    request(USER_E);
    expect(await redirectOf(getCockpitMetrics({}, NOW))).toBe("/no-access");
  });

  it("contexto falsificado (A-03): A con ORG_2 no cuenta ni ORG_2 ni ORG_1", async () => {
    expect(await forgedMetrics(forgedAdmin(USER_A, ORG_2))).toEqual(EMPTY);
  });
});

describe("el período de la URL cambia los flujos, no el estado de hoy", () => {
  const today = (metrics: CockpitMetrics) => ({
    funnel: metrics.funnel,
    quoteValue: metrics.quoteValue,
    attention: metrics.attention,
    stock: metrics.stock,
  });

  it("últimos 7 días: la ganada del 1 nov, la perdida del 30 oct y las pruebas desde el 28 oct", async () => {
    request(USER_A);
    const metrics = await readyMetrics({ period: "7d" }, NOW);
    expect(metrics.period).toMatchObject({ kind: "7d", from: "2026-10-28" });
    expect(metrics.conversion).toEqual({
      won: 1,
      lost: 1,
      closed: 2,
      rate: 50,
    });
    expect(metrics.salesCycle).toEqual({ won: 1, averageDays: 10 });
    expect(metrics.lossReasons.reasons).toEqual([
      { reason: "price", count: 1, share: 100 },
    ]);
    expect(metrics.testDrives).toEqual({
      completed: 1,
      noShow: 1,
      cancelled: 0,
      overdue: 2,
      upcoming: 2,
      due: 4,
      rate: 25,
    });
    expect(today(metrics)).toEqual(today(ORG_1_30_DAYS));
  });

  it("últimos 90 días: suma la ganada de 1 ms antes del piso de 30 días y la prueba del 1 sep", async () => {
    request(USER_A);
    const metrics = await readyMetrics({ period: "90d" }, NOW);
    expect(metrics.conversion).toEqual({
      won: 3,
      lost: 3,
      closed: 6,
      rate: 50,
    });
    // (20 + 10 + 60) días / 3 ventas.
    expect(metrics.salesCycle).toEqual({ won: 3, averageDays: 30 });
    expect(metrics.testDrives).toMatchObject({
      completed: 3,
      due: 7,
      rate: 42.9,
    });
    expect(today(metrics)).toEqual(today(ORG_1_30_DAYS));
  });

  it("todo el historial: sin piso, con la perdida de julio; el futuro sigue afuera", async () => {
    request(USER_A);
    const metrics = await readyMetrics({ period: "all" }, NOW);
    expect(metrics.period).toEqual({
      kind: "all",
      from: null,
      to: "2026-11-03",
      days: null,
      label: "Todo el historial: hasta el 3 nov 2026",
      isDefault: false,
    });
    expect(metrics.conversion).toEqual({
      won: 3,
      lost: 4,
      closed: 7,
      rate: 42.9,
    });
    expect(metrics.lossReasons.reasons).toEqual([
      { reason: "price", count: 2, share: 50 },
      { reason: "competitor", count: 1, share: 25 },
      { reason: "ghosted", count: 1, share: 25 },
    ]);
    // La de mañana y la del fin exacto del período no se cuentan.
    expect(metrics.testDrives).toMatchObject({
      completed: 3,
      cancelled: 1,
      upcoming: 2,
    });
    expect(today(metrics)).toEqual(today(ORG_1_30_DAYS));
  });

  it("un período inválido cae a los últimos 30 días con el aviso, sin romper", async () => {
    request(USER_A);
    expect(await readyMetrics({ period: "1y" }, NOW)).toEqual({
      ...ORG_1_30_DAYS,
      notice:
        "El período pedido no es válido. Se muestran los últimos 30 días.",
    });
  });

  it("al día siguiente del último día de validez, la cotización enviada deja de estar en juego", async () => {
    request(USER_A);
    const tomorrow = new Date(NOW.getTime() + DAY);
    const [, usd] = (await readyMetrics({}, tomorrow)).quoteValue;
    expect(usd).toEqual({
      currency: "USD",
      total: { count: 2, amount: "94490.50" },
      approved: { count: 1, amount: "32990.50", share: 34.9 },
      sent: { count: 1, amount: "61500.00", share: 65.1 },
    });
  });
});

describe("leer no escribe", () => {
  it("calcular las métricas no modifica oportunidades, unidades, cotizaciones ni pruebas", async () => {
    const snapshot = async () => ({
      opportunities: await db.admin`
        SELECT id, stage, vehicle_id, last_activity_at, updated_at
        FROM public.opportunities ORDER BY id
      `,
      vehicles: await db.admin`
        SELECT id, status, updated_at FROM public.vehicles ORDER BY id
      `,
      quotes: await db.admin`
        SELECT id, status, number, updated_at FROM public.quotes ORDER BY id
      `,
      testDrives: await db.admin`
        SELECT id, status, scheduled_at, updated_at
        FROM public.test_drives ORDER BY id
      `,
    });
    const before = await snapshot();
    request(USER_A);
    await readyMetrics({ period: "all" }, NOW);
    request(USER_B);
    await readyMetrics({}, NOW);
    expect(await snapshot()).toEqual(before);
  });
});

/*
 * Mutaciones puntuales: cada caso rompe una de las barreras y muestra que
 * los tests de arriba la detectan. Las mutaciones de base se revierten
 * siempre.
 */
describe("mutaciones: los tests detectan cada barrera rota", () => {
  it("sin el filtro explícito por organización, C con ORG_3 activa contaría también ORG_1", async () => {
    const ctx = tenantContext(USER_C, ORG_3);
    const unfiltered = await withTenant(ctx, async (tx) => ({
      opportunities:
        (await tx.select({ n: count() }).from(opportunities))[0]?.n ?? 0,
      vehicles: (await tx.select({ n: count() }).from(vehicles))[0]?.n ?? 0,
      quotes: (await tx.select({ n: count() }).from(quotes))[0]?.n ?? 0,
      testDrives: (await tx.select({ n: count() }).from(testDrives))[0]?.n ?? 0,
    }));
    const seeded = (organizationIds: string[]) => ({
      opportunities: OPPORTUNITIES.filter((op) =>
        organizationIds.includes(op.organizationId),
      ).length,
      vehicles: VEHICLES.filter((v) =>
        organizationIds.includes(v.organizationId),
      ).length,
      quotes: QUOTES.filter((q) => organizationIds.includes(q.organizationId))
        .length,
      testDrives: TEST_DRIVES.filter((d) =>
        organizationIds.includes(d.organizationId),
      ).length,
    });
    expect(unfiltered).toEqual(seeded([ORG_1, ORG_3]));
    // El loader real filtra: C con ORG_3 activa no ve el stock de ORG_1.
    request(USER_C, ORG_3);
    expect((await readyMetrics({}, NOW)).stock.total).toBe(2);
  });

  it("con RLS desactivado, el contexto falsificado contaría ORG_2: el filtro explícito no alcanza solo", async () => {
    const forged = forgedAdmin(USER_A, ORG_2);
    const tables = ["opportunities", "vehicles", "quotes", "test_drives"];
    for (const table of tables) {
      await db.admin.unsafe(
        `ALTER TABLE public.${table} DISABLE ROW LEVEL SECURITY`,
      );
    }
    try {
      // El filtro usa la organización del contexto: la falsificada pasa.
      expect(await forgedMetrics(forged)).toEqual(ORG_2_30_DAYS);
    } finally {
      for (const table of tables) {
        await db.admin.unsafe(
          `ALTER TABLE public.${table} ENABLE ROW LEVEL SECURITY`,
        );
      }
    }
    // Con RLS, el mismo contexto no ve nada.
    expect(await forgedMetrics(forged)).toEqual(EMPTY);
  });
});
