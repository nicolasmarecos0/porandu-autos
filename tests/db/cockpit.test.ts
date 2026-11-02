import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import { getCockpitFeed } from "@/db/queries/cockpit";
import { recordConversationRead } from "@/db/queries/conversation-reads";
import { ingestInboundMessage } from "@/db/queries/ingest-whatsapp-message";
import type { TenantContext } from "@/db/tenant";
import type { CockpitEvent, CockpitFeed } from "@/domains/cockpit/feed";
import { RECENT_EVENT_LIMIT } from "@/domains/cockpit/window";
import { todayInAsuncion } from "@/domains/opportunities/closure";

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
 * Feed del Cockpit (Hito 15, DEC-047) contra PostgreSQL con las migraciones
 * aplicadas, por el boundary real: getCockpitFeed() → requireTenant()
 * (mockeado con el contexto del miembro) → withTenant() (app_runtime que
 * asume authenticated con sus claims) → las cinco lecturas → RLS.
 *
 * Prueba que cada fuente trae solo lo de la organización activa (también un
 * usuario con varias organizaciones), las ventanas (próximas hasta mañana,
 * en curso, vencidas y recientes de siete días, abiertas y no cerradas), el
 * leído por miembro (que uno lea no saca el chat del feed de otro), las
 * notas propias fuera, el tope de cada fuente con su total y que leer no
 * escribe nada.
 *
 * Los mensajes los registra la base con su reloj (`created_at = now()`):
 * el resto de las fechas se fija relativo al reloj real (T0) y el feed se
 * pide con `new Date()`, así que las ventanas son las de la corrida.
 *
 * Tenants (support/tenants.ts): A: admin de ORG_1 · B: admin de ORG_2 ·
 * C: seller de ORG_1, admin de ORG_3 y seller inactivo de ORG_2.
 */

vi.mock("server-only", () => ({}));

const mocks = vi.hoisted(() => ({ requireTenant: vi.fn() }));

vi.mock("@/lib/tenant/session", () => ({
  requireTenant: mocks.requireTenant,
  resolveRequestTenant: vi.fn(),
}));

const LINE_1 = "300000000000011";
const LINE_2 = "300000000000012";

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** El reloj real al sembrar: las fechas se fijan relativas a él. */
const T0 = new Date();
const from = (offset: number) => new Date(T0.getTime() + offset);

const opportunityOf = (organizationId: string, stage?: string) => {
  const found = OPPORTUNITIES.find(
    (o) =>
      o.organizationId === organizationId &&
      (stage === undefined || o.stage === stage),
  );
  if (!found) throw new Error(`no opportunity for ${organizationId}`);
  return found.id;
};

const vehicleOf = (organizationId: string) => {
  const found = VEHICLES.find(
    (v) => v.organizationId === organizationId && v.status === "available",
  );
  if (!found) throw new Error(`no vehicle for ${organizationId}`);
  return found.id;
};

const OPP_1 = opportunityOf(ORG_1, "qualifying");
const OPP_2 = opportunityOf(ORG_2);
const OPP_3 = opportunityOf(ORG_3);
const VEH_1 = vehicleOf(ORG_1);
const VEH_2 = vehicleOf(ORG_2);
const VEH_3 = vehicleOf(ORG_3);

let server: TestServer;
let db: TestDatabase;

/** Los ids sembrados que el feed tiene que mostrar u ocultar. */
const seeded = {
  conversation1: "",
  conversation1Newest: "",
  conversation2: "",
  conversationOrg2: "",
  upcoming: "",
  inProgress: "",
  cancelledUpcoming: "",
  farUpcoming: "",
  upcomingOrg2: "",
  overdue: "",
  completedPast: "",
  staleOverdue: "",
  quoteRecent: "",
  quoteOld: "",
  quoteOrg2: "",
  noteByA: "",
  noteByC: "",
  noteOrg2: "",
};

let sequence = 0;

/** Un entrante por la ingesta, como lo registra el webhook. */
async function inbound(lineId: string, phone: string, content: string) {
  sequence += 1;
  const result = await ingestInboundMessage({
    lineId,
    externalId: `wamid.COCKPIT${String(sequence).padStart(8, "0")}`,
    phone,
    phoneNormalized: phone,
    contactName: `Cliente ${sequence}`,
    content,
    preview: content,
    sentAt: from(-MINUTE),
  });
  if (result.outcome !== "recorded") throw new Error("not recorded");
  return result;
}

type DriveSeed = {
  organizationId: string;
  opportunityId: string;
  vehicleId: string;
  status: string;
  scheduledAt: Date;
};

async function testDrive(seed: DriveSeed): Promise<string> {
  const [row] = await db.admin<{ id: string }[]>`
    INSERT INTO public.test_drives ${db.admin({
      organization_id: seed.organizationId,
      opportunity_id: seed.opportunityId,
      vehicle_id: seed.vehicleId,
      status: seed.status,
      scheduled_at: seed.scheduledAt,
      created_by: seed.organizationId === ORG_2 ? USER_B : USER_A,
    })}
    RETURNING id
  `;
  return row!.id;
}

/** Una cotización aprobada, con su alta y su último cambio en `at`. */
async function quote(
  organizationId: string,
  opportunityId: string,
  vehicleId: string,
  at: Date,
): Promise<string> {
  const createdBy = organizationId === ORG_2 ? USER_B : USER_A;
  const [row] = await db.admin<{ id: string }[]>`
    INSERT INTO public.quotes ${db.admin({
      organization_id: organizationId,
      opportunity_id: opportunityId,
      vehicle_id: vehicleId,
      status: "approved",
      currency: "USD",
      list_price: "49900.00",
      total_price: "49900.00",
      valid_until: todayInAsuncion(new Date(at.getTime() + 7 * DAY)),
      created_by: createdBy,
      approved_by: createdBy,
      approved_at: at,
      created_at: at,
      updated_at: at,
    })}
    RETURNING id
  `;
  return row!.id;
}

async function note(
  organizationId: string,
  opportunityId: string,
  recordedBy: string,
  at: Date,
): Promise<string> {
  const [row] = await db.admin<{ id: string }[]>`
    INSERT INTO public.opportunity_notes ${db.admin({
      organization_id: organizationId,
      opportunity_id: opportunityId,
      body: "Vuelve el viernes con la esposa.",
      recorded_by: recordedBy,
      recorded_at: at,
    })}
    RETURNING id
  `;
  return row!.id;
}

beforeAll(async () => {
  server = await startTestServer();
  db = await server.createDatabase();
  await runMigrations(db.migrationUrl);
  await seedTenants(db.admin);
  await seedOpportunities(db.admin);
  await seedVehicles(db.admin);
  await db.admin`
    INSERT INTO public.whatsapp_lines ${db.admin([
      { organization_id: ORG_1, phone_number_id: LINE_1, active: true },
      { organization_id: ORG_2, phone_number_id: LINE_2, active: true },
    ])}
  `;
  vi.stubEnv("RUNTIME_DATABASE_URL", await db.runtimeUrl());

  // Chats: dos de ORG_1 (uno con dos entrantes) y uno de ORG_2.
  const first = await inbound(LINE_1, "+595981700001", "Hola");
  const newest = await inbound(
    LINE_1,
    "+595981700001",
    "¿Tienen financiación en 36 cuotas?",
  );
  seeded.conversation1 = first.conversationId;
  seeded.conversation1Newest = newest.messageId;
  seeded.conversation2 = (
    await inbound(LINE_1, "+595981700002", "Busco una Hilux")
  ).conversationId;
  seeded.conversationOrg2 = (
    await inbound(LINE_2, "+595981700003", "Hola desde ORG_2")
  ).conversationId;

  const drive = (
    organizationId: string,
    status: string,
    offset: number,
  ): DriveSeed => ({
    organizationId,
    opportunityId:
      organizationId === ORG_1
        ? OPP_1
        : organizationId === ORG_2
          ? OPP_2
          : OPP_3,
    vehicleId:
      organizationId === ORG_1
        ? VEH_1
        : organizationId === ORG_2
          ? VEH_2
          : VEH_3,
    status,
    scheduledAt: from(offset),
  });
  seeded.upcoming = await testDrive(drive(ORG_1, "confirmed", 2 * HOUR));
  seeded.inProgress = await testDrive(drive(ORG_1, "scheduled", -30 * MINUTE));
  seeded.cancelledUpcoming = await testDrive(
    drive(ORG_1, "cancelled", 3 * HOUR),
  );
  seeded.farUpcoming = await testDrive(drive(ORG_1, "scheduled", 3 * DAY));
  seeded.upcomingOrg2 = await testDrive(drive(ORG_2, "confirmed", 2 * HOUR));
  seeded.overdue = await testDrive(drive(ORG_1, "scheduled", -3 * HOUR));
  seeded.completedPast = await testDrive(drive(ORG_1, "completed", -4 * HOUR));
  seeded.staleOverdue = await testDrive(drive(ORG_1, "confirmed", -10 * DAY));

  seeded.quoteRecent = await quote(ORG_1, OPP_1, VEH_1, from(-2 * HOUR));
  seeded.quoteOld = await quote(ORG_1, OPP_1, VEH_1, from(-8 * DAY));
  seeded.quoteOrg2 = await quote(ORG_2, OPP_2, VEH_2, from(-2 * HOUR));

  seeded.noteByA = await note(ORG_1, OPP_1, USER_A, from(-HOUR));
  seeded.noteByC = await note(ORG_1, OPP_1, USER_C, from(-HOUR));
  seeded.noteOrg2 = await note(ORG_2, OPP_2, USER_B, from(-HOUR));
});

afterAll(async () => {
  await closeRuntimePool();
  vi.unstubAllEnvs();
  await server?.close();
});

beforeEach(() => {
  vi.clearAllMocks();
});

async function feedAs(ctx: TenantContext): Promise<CockpitFeed> {
  mocks.requireTenant.mockResolvedValue(ctx);
  return getCockpitFeed(new Date());
}

const recentKeys = (feed: CockpitFeed) =>
  feed.recent.flatMap((group) => group.events.map((event) => event.key));

const upcomingKeys = (feed: CockpitFeed) =>
  feed.upcoming.map((event) => event.key);

const tileValue = (feed: CockpitFeed, key: string) =>
  feed.summary.find((tile) => tile.key === key)?.value;

describe("getCockpitFeed()", () => {
  it("C en ORG_1 ve cada fuente de su organización, en su ventana", async () => {
    const feed = await feedAs(tenantContext(USER_C, ORG_1));

    // Próximas: en curso y por venir hasta mañana, la más cercana arriba.
    expect(upcomingKeys(feed)).toEqual([
      `test_drive:${seeded.inProgress}`,
      `test_drive:${seeded.upcoming}`,
    ]);
    const [inProgress] = feed.upcoming;
    expect(inProgress).toMatchObject({
      kind: "test_drive",
      phase: "in_progress",
    });

    const recent = recentKeys(feed);
    expect(new Set(recent)).toEqual(
      new Set([
        `message:${seeded.conversation1}`,
        `message:${seeded.conversation2}`,
        `test_drive:${seeded.overdue}`,
        `quote:${seeded.quoteRecent}`,
        `note:${seeded.noteByA}`,
      ]),
    );

    // Del más nuevo al más viejo: los chats (recién registrados), la nota
    // (hace una hora), la cotización (dos horas) y la prueba vencida (tres).
    expect(recent.slice(2)).toEqual([
      `note:${seeded.noteByA}`,
      `quote:${seeded.quoteRecent}`,
      `test_drive:${seeded.overdue}`,
    ]);

    const chat = feed.recent
      .flatMap((group) => group.events)
      .find(
        (event): event is Extract<CockpitEvent, { kind: "message" }> =>
          event.key === `message:${seeded.conversation1}`,
      );
    expect(chat).toMatchObject({
      unread: 2,
      headline: "2 mensajes sin leer",
      detail: "¿Tienen financiación en 36 cuotas?",
      action: {
        label: "Responder",
        target: {
          kind: "conversation",
          conversationId: seeded.conversation1,
        },
      },
    });

    expect(tileValue(feed, "unread")).toBe(2);
    expect(feed.summary[0]?.hint).toBe("3 mensajes");
    expect(tileValue(feed, "upcoming")).toBe(2);
    expect(tileValue(feed, "overdue")).toBe(1);
    expect(tileValue(feed, "quotes")).toBe(1);
    expect(feed.recentTotal).toBe(5);
  });

  it("nada de otra organización llega al feed, aunque C tenga una membership inactiva en ella", async () => {
    const feed = await feedAs(tenantContext(USER_C, ORG_1));
    const keys = [...recentKeys(feed), ...upcomingKeys(feed)];
    for (const foreign of [
      `message:${seeded.conversationOrg2}`,
      `test_drive:${seeded.upcomingOrg2}`,
      `quote:${seeded.quoteOrg2}`,
      `note:${seeded.noteOrg2}`,
    ]) {
      expect(keys).not.toContain(foreign);
    }

    // B, en ORG_2, ve lo suyo y nada de ORG_1.
    const org2 = await feedAs(tenantContext(USER_B, ORG_2));
    expect(upcomingKeys(org2)).toEqual([`test_drive:${seeded.upcomingOrg2}`]);
    expect(new Set(recentKeys(org2))).toEqual(
      new Set([
        `message:${seeded.conversationOrg2}`,
        `quote:${seeded.quoteOrg2}`,
      ]),
    );
  });

  it("deja afuera lo cerrado y lo que cae fuera de cada ventana", async () => {
    const feed = await feedAs(tenantContext(USER_C, ORG_1));
    const keys = [...recentKeys(feed), ...upcomingKeys(feed)];
    for (const outside of [
      `test_drive:${seeded.cancelledUpcoming}`,
      `test_drive:${seeded.farUpcoming}`,
      `test_drive:${seeded.completedPast}`,
      `test_drive:${seeded.staleOverdue}`,
      `quote:${seeded.quoteOld}`,
    ]) {
      expect(keys).not.toContain(outside);
    }
  });

  it("las notas propias no son novedad: A ve la de C y no la suya", async () => {
    const asA = recentKeys(await feedAs(tenantContext(USER_A, ORG_1)));
    expect(asA).toContain(`note:${seeded.noteByC}`);
    expect(asA).not.toContain(`note:${seeded.noteByA}`);
  });

  it("el leído es por miembro: cuando C lee, el chat sale de su feed y sigue en el de A", async () => {
    const asC = tenantContext(USER_C, ORG_1);
    const outcome = await recordConversationRead(asC, {
      conversationId: seeded.conversation1,
      upToMessageId: seeded.conversation1Newest,
    });
    expect(outcome.outcome).toBe("marked");

    const feedC = await feedAs(asC);
    expect(recentKeys(feedC)).not.toContain(`message:${seeded.conversation1}`);
    expect(recentKeys(feedC)).toContain(`message:${seeded.conversation2}`);
    expect(tileValue(feedC, "unread")).toBe(1);

    const feedA = await feedAs(tenantContext(USER_A, ORG_1));
    expect(recentKeys(feedA)).toContain(`message:${seeded.conversation1}`);
    expect(tileValue(feedA, "unread")).toBe(2);
  });

  it("leer el feed no escribe nada", async () => {
    type Snapshot = {
      reads: string;
      activity: Date | null;
      quote: Date;
      drive: Date;
    };
    const snapshot = async () => {
      const [row] = await db.admin<Snapshot[]>`
        SELECT
          (SELECT count(*)::text FROM public.conversation_reads) AS reads,
          (SELECT max(last_activity_at) FROM public.opportunities) AS activity,
          (SELECT updated_at FROM public.quotes WHERE id = ${seeded.quoteRecent}) AS quote,
          (SELECT updated_at FROM public.test_drives WHERE id = ${seeded.overdue}) AS drive
      `;
      return row;
    };
    const before = await snapshot();
    await feedAs(tenantContext(USER_A, ORG_1));
    await feedAs(tenantContext(USER_C, ORG_1));
    expect(await snapshot()).toEqual(before);
  });

  it("C con ORG_3 activa ve solo ORG_3, y cada fuente corta en su tope con el total", async () => {
    const asC3 = tenantContext(USER_C, ORG_3);
    const empty = await feedAs(asC3);
    expect(recentKeys(empty)).toEqual([]);
    expect(upcomingKeys(empty)).toEqual([]);

    const extra = RECENT_EVENT_LIMIT + 2;
    const ids: string[] = [];
    for (let i = 0; i < extra; i += 1) {
      ids.push(await quote(ORG_3, OPP_3, VEH_3, from(-(i + 1) * MINUTE)));
    }

    const feed = await feedAs(asC3);
    // Las más nuevas primero: la del minuto anterior a T0 arriba.
    expect(recentKeys(feed)).toEqual(
      ids.slice(0, RECENT_EVENT_LIMIT).map((quoteId) => `quote:${quoteId}`),
    );
    expect(feed.recentShown).toBe(RECENT_EVENT_LIMIT);
    expect(feed.recentTotal).toBe(extra);
    expect(tileValue(feed, "quotes")).toBe(extra);
  });
});
