import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import { getOpportunityPipeline } from "@/db/queries/pipeline";
import type { TenantContext } from "@/db/tenant";
import { todayInAsuncion } from "@/domains/opportunities/closure";
import {
  CLOSED_COLUMN_LIMIT,
  type PipelineBoard,
  type PipelineCard,
} from "@/domains/opportunities/pipeline";
import type { Stage } from "@/domains/opportunities/stages";

import { closureColumns } from "./support/closures";
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
 * Tablero de oportunidades (propuesta DEC-048) contra PostgreSQL con las
 * migraciones aplicadas, por el boundary real: getOpportunityPipeline() →
 * requireTenant() (mockeado con el contexto del miembro) → withTenant()
 * (app_runtime que asume authenticated con sus claims) → las lecturas → RLS.
 *
 * Prueba que el tablero trae solo la organización activa (también para un
 * usuario con varias), la ventana y el tope de las cerradas, las acciones
 * pendientes (cotizaciones por aprobar vigentes, pruebas vencidas y la
 * unidad por vincular), el total de la cotización aceptada y que leer no
 * escribe nada. Mover una tarjeta usa las Server Actions de DEC-032 y
 * DEC-034, que ya prueban opportunity-stages.test.ts y
 * opportunity-closure.test.ts.
 *
 * Las fechas se fijan relativas al reloj real (T0) y el tablero se pide con
 * `new Date()`, así que las ventanas son las de la corrida.
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

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** El reloj real al sembrar: las fechas se fijan relativas a él. */
const T0 = new Date();
const from = (offset: number) => new Date(T0.getTime() + offset);

const id = (n: number) =>
  `40000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

const seededOf = (organizationId: string, stage: Stage) => {
  const found = OPPORTUNITIES.find(
    (o) => o.organizationId === organizationId && o.stage === stage,
  );
  if (!found) throw new Error(`no ${stage} opportunity for ${organizationId}`);
  return found;
};

const availableVehicleOf = (organizationId: string) => {
  const found = VEHICLES.find(
    (v) => v.organizationId === organizationId && v.status === "available",
  );
  if (!found) throw new Error(`no vehicle for ${organizationId}`);
  return found.id;
};

/** Sembradas en support/opportunities.ts. */
const QUALIFYING_1 = seededOf(ORG_1, "qualifying").id;
const NEGOTIATING_2 = seededOf(ORG_2, "negotiating").id;
const NEGOTIATING_3 = seededOf(ORG_3, "negotiating").id;
const VEH_1 = availableVehicleOf(ORG_1);
const VEH_3 = availableVehicleOf(ORG_3);

/** Contactos propios de este test, uno por organización. */
const CONTACT = { [ORG_1]: id(1), [ORG_2]: id(2), [ORG_3]: id(3) } as const;

/** Las oportunidades que siembra este test. */
const seeded = {
  wonRecent: id(101),
  lostRecent: id(102),
  lostOld: id(103),
  negotiatingActive: id(104),
  draftQuote: "",
};

let server: TestServer;
let db: TestDatabase;

type OpportunitySeed = Readonly<{
  id: string;
  organizationId: string;
  stage: Stage;
  vehicleId?: string;
  lastActivityAt: Date;
  updatedAt: Date;
}>;

async function opportunity(seed: OpportunitySeed): Promise<void> {
  await db.admin`
    INSERT INTO public.opportunities ${db.admin({
      id: seed.id,
      organization_id: seed.organizationId,
      contact_id: CONTACT[seed.organizationId as keyof typeof CONTACT],
      stage: seed.stage,
      source: "whatsapp",
      vehicle_id: seed.vehicleId ?? null,
      last_activity_at: seed.lastActivityAt,
      created_at: from(-60 * DAY),
      updated_at: seed.updatedAt,
      ...closureColumns(seed.stage),
    })}
  `;
}

type QuoteSeed = Readonly<{
  opportunityId: string;
  status: "draft" | "accepted";
  createdAt: Date;
  validDays: number;
  totalPrice?: string;
}>;

async function quote(seed: QuoteSeed): Promise<string> {
  const decided = seed.status === "accepted";
  const total = seed.totalPrice ?? "49900.00";
  const [row] = await db.admin<{ id: string }[]>`
    INSERT INTO public.quotes ${db.admin({
      organization_id: ORG_1,
      opportunity_id: seed.opportunityId,
      vehicle_id: VEH_1,
      status: seed.status,
      currency: "USD",
      list_price: total,
      total_price: total,
      valid_until: todayInAsuncion(
        new Date(seed.createdAt.getTime() + seed.validDays * DAY),
      ),
      created_by: USER_A,
      approved_by: decided ? USER_A : null,
      approved_at: decided ? seed.createdAt : null,
      sent_at: decided ? seed.createdAt : null,
      decided_at: decided ? seed.createdAt : null,
      created_at: seed.createdAt,
      updated_at: seed.createdAt,
    })}
    RETURNING id
  `;
  return row!.id;
}

async function testDrive(
  opportunityId: string,
  status: string,
  scheduledAt: Date,
): Promise<void> {
  await db.admin`
    INSERT INTO public.test_drives ${db.admin({
      organization_id: ORG_1,
      opportunity_id: opportunityId,
      vehicle_id: VEH_1,
      status,
      scheduled_at: scheduledAt,
      created_by: USER_A,
    })}
  `;
}

beforeAll(async () => {
  server = await startTestServer();
  db = await server.createDatabase();
  await runMigrations(db.migrationUrl);
  await seedTenants(db.admin);
  await seedOpportunities(db.admin);
  await seedVehicles(db.admin);
  await db.admin`
    INSERT INTO public.contacts ${db.admin(
      Object.entries(CONTACT).map(([organizationId, contactId]) => ({
        id: contactId,
        organization_id: organizationId,
        name: `Contacto ${organizationId.at(-1)}`,
      })),
    )}
  `;
  vi.stubEnv("RUNTIME_DATABASE_URL", await db.runtimeUrl());

  // ORG_1 · cerradas: una ganada y una perdida en la ventana, y una perdida
  // de hace 40 días (afuera).
  await opportunity({
    id: seeded.wonRecent,
    organizationId: ORG_1,
    stage: "won",
    vehicleId: VEH_1,
    lastActivityAt: from(-3 * DAY),
    updatedAt: from(-2 * DAY),
  });
  await opportunity({
    id: seeded.lostRecent,
    organizationId: ORG_1,
    stage: "lost",
    lastActivityAt: from(-3 * DAY),
    updatedAt: from(-HOUR),
  });
  await opportunity({
    id: seeded.lostOld,
    organizationId: ORG_1,
    stage: "lost",
    lastActivityAt: from(-50 * DAY),
    updatedAt: from(-40 * DAY),
  });
  // ORG_1 · en negociación, activa, sin unidad: "Vincular unidad".
  await opportunity({
    id: seeded.negotiatingActive,
    organizationId: ORG_1,
    stage: "negotiating",
    lastActivityAt: from(-10 * MINUTE),
    updatedAt: from(-10 * MINUTE),
  });

  // ORG_1 · cotizaciones de la calificación sembrada: un borrador vigente
  // (por aprobar), un borrador vencido (no cuenta) y, en la negociación, una
  // aceptada (precarga el precio final al ganarla).
  seeded.draftQuote = await quote({
    opportunityId: QUALIFYING_1,
    status: "draft",
    createdAt: from(-HOUR),
    validDays: 7,
  });
  await quote({
    opportunityId: QUALIFYING_1,
    status: "draft",
    createdAt: from(-10 * DAY),
    validDays: 3,
  });
  await quote({
    opportunityId: seeded.negotiatingActive,
    status: "accepted",
    createdAt: from(-2 * HOUR),
    validDays: 7,
    totalPrice: "47500.00",
  });

  // ORG_1 · pruebas de la calificación: dos vencidas (franja terminada, en
  // la ventana), una cancelada, una en curso y una vencida de hace 10 días
  // (afuera de la ventana del Cockpit).
  await testDrive(QUALIFYING_1, "scheduled", from(-3 * HOUR));
  await testDrive(QUALIFYING_1, "confirmed", from(-26 * HOUR));
  await testDrive(QUALIFYING_1, "cancelled", from(-2 * HOUR));
  await testDrive(QUALIFYING_1, "scheduled", from(-30 * MINUTE));
  await testDrive(QUALIFYING_1, "confirmed", from(-10 * DAY));

  // ORG_3 · la negociación sembrada con su unidad vinculada (pase de unidad
  // en negociación: lo admite el trigger) y más perdidas que el tope.
  await db.admin`
    UPDATE public.opportunities SET vehicle_id = ${VEH_3}
    WHERE organization_id = ${ORG_3} AND id = ${NEGOTIATING_3}
  `;
  for (let n = 0; n < CLOSED_COLUMN_LIMIT + 2; n += 1) {
    await opportunity({
      id: id(300 + n),
      organizationId: ORG_3,
      stage: "lost",
      lastActivityAt: from(-5 * DAY),
      updatedAt: from(-(n + 1) * HOUR),
    });
  }
});

afterAll(async () => {
  await closeRuntimePool();
  vi.unstubAllEnvs();
  await server?.close();
});

beforeEach(() => {
  vi.clearAllMocks();
});

async function boardAs(ctx: TenantContext): Promise<PipelineBoard> {
  mocks.requireTenant.mockResolvedValue(ctx);
  return getOpportunityPipeline(new Date());
}

function columnIds(board: PipelineBoard, stage: Stage): string[] {
  return board.columns
    .find((column) => column.stage === stage)!
    .cards.map((card) => card.id);
}

function cardOf(board: PipelineBoard, opportunityId: string): PipelineCard {
  const found = board.columns
    .flatMap((column) => column.cards)
    .find((card) => card.id === opportunityId);
  if (!found) throw new Error(`card ${opportunityId} not on the board`);
  return found;
}

const sortedIds = (organizationId: string, stage: Stage) =>
  OPPORTUNITIES.filter(
    (o) => o.organizationId === organizationId && o.stage === stage,
  )
    .map((o) => o.id)
    .sort();

describe("getOpportunityPipeline()", () => {
  it("C en ORG_1 ve solo las oportunidades de ORG_1, en la columna de su etapa", async () => {
    const board = await boardAs(tenantContext(USER_C, ORG_1));

    expect(columnIds(board, "new").sort()).toEqual(sortedIds(ORG_1, "new"));
    expect(columnIds(board, "qualifying").sort()).toEqual(
      sortedIds(ORG_1, "qualifying"),
    );
    expect(columnIds(board, "negotiating")).toEqual([seeded.negotiatingActive]);
    // Cerradas en la ventana de 30 días; la perdida de hace 40, afuera.
    expect(columnIds(board, "won")).toEqual([seeded.wonRecent]);
    expect(columnIds(board, "lost")).toEqual([seeded.lostRecent]);
    expect(board.summary.open).toBe(
      OPPORTUNITIES.filter((o) => o.organizationId === ORG_1).length + 1,
    );
  });

  it("C con varias organizaciones solo ve la activa (ORG_3)", async () => {
    const board = await boardAs(tenantContext(USER_C, ORG_3));
    expect(columnIds(board, "negotiating")).toEqual([NEGOTIATING_3]);
    expect(columnIds(board, "new")).toEqual([]);
    expect(columnIds(board, "qualifying")).toEqual([]);
    expect(columnIds(board, "won")).toEqual([]);
  });

  it("B en ORG_2 no ve nada de ORG_1 ni de ORG_3", async () => {
    const board = await boardAs(tenantContext(USER_B, ORG_2));
    const ids = board.columns.flatMap((column) =>
      column.cards.map((card) => card.id),
    );
    expect(ids.sort()).toEqual(
      OPPORTUNITIES.filter((o) => o.organizationId === ORG_2)
        .map((o) => o.id)
        .sort(),
    );
    // La negociación de ORG_2 no tiene unidad: "Vincular unidad".
    expect(cardOf(board, NEGOTIATING_2).pending.map((p) => p.kind)).toEqual([
      "link_vehicle",
    ]);
  });

  it("una membership inactiva no ve nada (RLS), aunque el contexto lo pida", async () => {
    const board = await boardAs(tenantContext(USER_C, ORG_2));
    expect(board.columns.every((column) => column.cards.length === 0)).toBe(
      true,
    );
    expect(board.summary).toEqual({ open: 0, stale: 0, pending: 0 });
  });

  it("cerradas: de la más reciente a la más vieja, con el tope y el total de la ventana", async () => {
    const board = await boardAs(tenantContext(USER_C, ORG_3));
    const lost = board.columns.find((column) => column.stage === "lost")!;
    expect(lost.cards).toHaveLength(CLOSED_COLUMN_LIMIT);
    expect(lost.total).toBe(CLOSED_COLUMN_LIMIT + 2);
    expect(lost.cards.map((card) => card.id)).toEqual(
      Array.from({ length: CLOSED_COLUMN_LIMIT }, (_, n) => id(300 + n)),
    );
    expect(lost.cards[0]?.closure).toMatchObject({
      label: "Perdida",
      reason: "Precio",
    });
  });

  it("acciones pendientes: un borrador vigente por aprobar y las pruebas vencidas de la ventana", async () => {
    const board = await boardAs(tenantContext(USER_A, ORG_1));
    const card = cardOf(board, QUALIFYING_1);
    expect(card.pending).toEqual([
      expect.objectContaining({
        kind: "quote_approval",
        label: "Cotización por aprobar",
        target: {
          kind: "quote",
          opportunityId: QUALIFYING_1,
          quoteId: seeded.draftQuote,
        },
      }),
      expect.objectContaining({
        kind: "test_drive_result",
        label: "2 pruebas sin resultado",
        target: {
          kind: "calendar_day",
          day: todayInAsuncion(from(-3 * HOUR)),
        },
      }),
    ]);
  });

  it("en negociación: sin unidad pide vincular y precarga el total de la aceptada", async () => {
    const board = await boardAs(tenantContext(USER_A, ORG_1));
    const card = cardOf(board, seeded.negotiatingActive);
    expect(card.pending.map((p) => p.kind)).toEqual(["link_vehicle"]);
    expect(card.saleVehicle).toBeNull();
    expect(card.acceptedQuoteTotal).toEqual({
      amount: "47500.00",
      currency: "USD",
    });
    expect(card.recency).toMatchObject({ state: "active", label: "Activa" });
  });

  it("con la unidad vinculada, la unidad es la primera línea y la que se vende", async () => {
    const board = await boardAs(tenantContext(USER_C, ORG_3));
    const card = cardOf(board, NEGOTIATING_3);
    expect(card).toMatchObject({
      headline: "Mitsubishi L200 Triton",
      headlineSource: "unit",
      detail: "GLS 2.4 4x4 MT · 2025",
      saleVehicle: {
        name: "Mitsubishi L200 Triton",
        detail: "GLS 2.4 4x4 MT · 2025",
      },
      pending: [],
    });
  });

  it("la ganada muestra la unidad vendida y no tiene score ni alertas", async () => {
    const board = await boardAs(tenantContext(USER_A, ORG_1));
    expect(cardOf(board, seeded.wonRecent)).toMatchObject({
      stage: "won",
      headline: "Toyota Hilux",
      score: null,
      recency: null,
      pending: [],
      closure: { label: "Ganada", reason: null },
    });
  });

  it("leer no escribe nada", async () => {
    const snapshot = () => db.admin`
      SELECT id, stage, last_activity_at, updated_at, vehicle_id
      FROM public.opportunities ORDER BY id
    `;
    const quotesSnapshot = () => db.admin`
      SELECT id, status, updated_at FROM public.quotes ORDER BY id
    `;
    const before = [await snapshot(), await quotesSnapshot()];
    await boardAs(tenantContext(USER_A, ORG_1));
    await boardAs(tenantContext(USER_C, ORG_3));
    expect([await snapshot(), await quotesSnapshot()]).toEqual(before);
  });
});
