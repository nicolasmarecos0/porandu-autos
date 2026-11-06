import "server-only";

import { and, asc, desc, eq, gte, inArray, lte, max, sql } from "drizzle-orm";

import { OPEN_TEST_DRIVE_STATUSES } from "@/domains/calendar/test-drives";
import type { Currency } from "@/domains/money";
import {
  CLOSED_COLUMN_LIMIT,
  OPEN_STAGES,
  pipelineBoard,
  pipelineWindow,
  type ClosedSource,
  type PipelineBoard,
  type PipelineRow,
  type PipelineWindow,
  type QuoteSignals,
  type TestDriveSignals,
} from "@/domains/opportunities/pipeline";
import { requireTenant } from "@/lib/tenant/session";

import {
  contacts,
  opportunities,
  quotes,
  testDrives,
  vehicles,
} from "../schema";
import { withTenant, type ScopedTransaction } from "../tenant";
import { selectDemandRows } from "./demand-rows";
import { selectLastNoteTimes } from "./opportunity-notes";
import { selectMatchCandidates, statusFromDb } from "./vehicles";

/*
 * Tablero de oportunidades: el embudo de ventas (propuesta DEC-048). Solo
 * lee:
 *
 *   request → requireTenant() → TenantContext → withTenant() → lecturas
 *   acotadas en la misma transacción, filtradas por la organización activa →
 *   RLS → domains/opportunities/pipeline.ts (inteligencia, alertas, orden y
 *   topes) → ViewModel
 *
 *   1. Abiertas (new, qualifying, negotiating) con su contacto y su unidad
 *      vinculada · filtro por organización y etapa.
 *   2. Ganadas y 3. perdidas de los últimos 30 días de Asunción, de la más
 *      reciente a la más vieja, a lo sumo CLOSED_COLUMN_LIMIT, con su total
 *      (`count(*) over ()`, antes del LIMIT) · el índice parcial
 *      opportunities (organization_id, updated_at) WHERE stage IN ('won',
 *      'lost') de 0017.
 *   4. El ledger de demanda de las tarjetas (selectDemandRows(), DEC-030).
 *   5. El stock disponible, una sola vez: las candidatas de Match v0
 *      (selectMatchCandidates(), DEC-031), como la cola.
 *   6. La nota más reciente de cada abierta (selectLastNoteTimes(),
 *      DEC-035 §5).
 *   7. Las cotizaciones de las abiertas, agregadas por oportunidad:
 *      borradores vigentes por aprobar (DEC-042 §2) y el total de la
 *      aceptada (DEC-042 §7) · índice quotes (organization_id,
 *      opportunity_id).
 *   8. Las pruebas de manejo vencidas de las abiertas (DEC-047 §3.3),
 *      agregadas por oportunidad · índice test_drives (organization_id,
 *      opportunity_id).
 *
 * Cada lectura filtra por `organization_id` además de RLS (ADR-001 §2: con
 * varias memberships activas, RLS deja ver todas y el filtro deja solo la
 * activa) y cada tabla unida lo hace por las dos columnas de su FK
 * compuesta (organization_id, id). Los instantes se ligan con operadores de
 * columna (`gte`, `lte`) para que viajen como timestamptz, y el día de
 * validez viaja como `YYYY-MM-DD` contra la columna `date`.
 *
 * Leer no cambia nada: ni `last_activity_at`, ni `updated_at`, ni estados.
 * Sin caché compartida entre requests (DEC-043 §6): la página es dinámica
 * (lee cookies) y cada request lee el último dato confirmado. Mover una
 * tarjeta no pasa por acá: va por las Server Actions de DEC-032 y DEC-034.
 */

/** Lo que una tarjeta lee de la oportunidad, su contacto y su unidad. */
const cardColumns = {
  id: opportunities.id,
  stage: opportunities.stage,
  interestModel: opportunities.interestModel,
  interestVersion: opportunities.interestVersion,
  lastActivityAt: opportunities.lastActivityAt,
  updatedAt: opportunities.updatedAt,
  lossReason: opportunities.lossReason,
  contactName: contacts.name,
  vehicleId: vehicles.id,
  vehicleBrand: vehicles.brand,
  vehicleModel: vehicles.model,
  vehicleVersion: vehicles.version,
  vehicleYear: vehicles.year,
  // El cierre Ganada la vende (propuesta DEC-051): la confirmación dice qué
  // pasa con su estado o por qué no se puede.
  vehicleStatus: vehicles.status,
};

/** El contacto de la oportunidad, por las dos columnas de la FK compuesta. */
const contactOfOpportunity = and(
  eq(contacts.organizationId, opportunities.organizationId),
  eq(contacts.id, opportunities.contactId),
);

/** La unidad vinculada (DEC-033), por las dos columnas de la FK compuesta. */
const vehicleOfOpportunity = and(
  eq(vehicles.organizationId, opportunities.organizationId),
  eq(vehicles.id, opportunities.vehicleId),
);

type CardRecord = Readonly<{
  id: string;
  stage: PipelineRow["stage"];
  interestModel: string | null;
  interestVersion: string | null;
  lastActivityAt: Date;
  updatedAt: Date;
  lossReason: PipelineRow["lossReason"];
  contactName: string;
  vehicleId: string | null;
  vehicleBrand: string | null;
  vehicleModel: string | null;
  vehicleVersion: string | null;
  vehicleYear: number | null;
  vehicleStatus: (typeof vehicles.$inferSelect)["status"] | null;
}>;

/** Fila leída → fila del dominio. Pura. */
export function toPipelineRow(record: CardRecord): PipelineRow {
  const { vehicleId, vehicleBrand, vehicleModel, vehicleYear, vehicleStatus } =
    record;
  return {
    id: record.id,
    stage: record.stage,
    contactName: record.contactName,
    interestModel: record.interestModel,
    interestVersion: record.interestVersion,
    lastActivityAt: record.lastActivityAt,
    updatedAt: record.updatedAt,
    lossReason: record.lossReason,
    vehicle:
      vehicleId !== null &&
      vehicleBrand !== null &&
      vehicleModel !== null &&
      vehicleYear !== null &&
      vehicleStatus !== null
        ? {
            id: vehicleId,
            brand: vehicleBrand,
            model: vehicleModel,
            version: record.vehicleVersion,
            year: vehicleYear,
            status: statusFromDb[vehicleStatus],
          }
        : null,
  };
}

/** 1. Las abiertas de la organización activa. */
async function selectOpenRows(
  tx: ScopedTransaction,
  organizationId: string,
): Promise<PipelineRow[]> {
  const records = await tx
    .select(cardColumns)
    .from(opportunities)
    .innerJoin(contacts, contactOfOpportunity)
    .leftJoin(vehicles, vehicleOfOpportunity)
    .where(
      and(
        eq(opportunities.organizationId, organizationId),
        inArray(opportunities.stage, [...OPEN_STAGES]),
      ),
    )
    .orderBy(desc(opportunities.lastActivityAt), asc(opportunities.id));
  return records.map(toPipelineRow);
}

/** 2 y 3. Las cerradas de una etapa desde `from` (fecha de cierre). */
async function selectClosedRows(
  tx: ScopedTransaction,
  organizationId: string,
  stage: "won" | "lost",
  from: Date,
): Promise<ClosedSource> {
  const records = await tx
    .select({
      ...cardColumns,
      total: sql<number>`count(*) over ()`.mapWith(Number),
    })
    .from(opportunities)
    .innerJoin(contacts, contactOfOpportunity)
    .leftJoin(vehicles, vehicleOfOpportunity)
    .where(
      and(
        eq(opportunities.organizationId, organizationId),
        eq(opportunities.stage, stage),
        // DEC-037 §5: la fecha de cierre de una cerrada es `updated_at`.
        gte(opportunities.updatedAt, from),
      ),
    )
    .orderBy(desc(opportunities.updatedAt), desc(opportunities.id))
    .limit(CLOSED_COLUMN_LIMIT);
  return {
    rows: records.map(toPipelineRow),
    total: records[0]?.total ?? 0,
  };
}

/**
 * 7. Cotizaciones de las abiertas, una fila por oportunidad. A lo sumo una
 * aceptada por oportunidad (índice único `quotes_accepted_opportunity_key`),
 * así que su total y su moneda salen de un `max()` filtrado.
 */
async function selectQuoteSignals(
  tx: ScopedTransaction,
  organizationId: string,
  opportunityIds: readonly string[],
  today: string,
): Promise<Map<string, QuoteSignals>> {
  const signals = new Map<string, QuoteSignals>();
  if (opportunityIds.length === 0) return signals;
  // Vigente: `valid_until` no anterior al día de Asunción (DEC-042 §4).
  const awaitingApproval = and(
    eq(quotes.status, "draft"),
    gte(quotes.validUntil, today),
  );
  const accepted = eq(quotes.status, "accepted");
  const rows = await tx
    .select({
      opportunityId: quotes.opportunityId,
      toApprove:
        sql<number>`count(*) filter (where ${awaitingApproval})`.mapWith(
          Number,
        ),
      latestDraftId: sql<
        string | null
      >`(array_agg(${quotes.id} order by ${quotes.createdAt} desc, ${quotes.id} desc) filter (where ${awaitingApproval}))[1]`,
      acceptedTotal: sql<
        string | null
      >`max(${quotes.totalPrice}) filter (where ${accepted})`,
      acceptedCurrency: sql<Currency | null>`max(${quotes.currency}) filter (where ${accepted})`,
    })
    .from(quotes)
    .where(
      and(
        eq(quotes.organizationId, organizationId),
        inArray(quotes.opportunityId, [...opportunityIds]),
        inArray(quotes.status, ["draft", "accepted"]),
      ),
    )
    .groupBy(quotes.opportunityId);
  for (const row of rows) {
    signals.set(row.opportunityId, {
      toApprove: row.toApprove,
      latestDraftId: row.latestDraftId,
      accepted:
        row.acceptedTotal !== null && row.acceptedCurrency !== null
          ? { amount: row.acceptedTotal, currency: row.acceptedCurrency }
          : null,
    });
  }
  return signals;
}

/**
 * 8. Pruebas vencidas de las abiertas: abiertas (`scheduled` o `confirmed`)
 * con la franja terminada, agendadas en la ventana reciente. Las mismas que
 * el Cockpit muestra como "Registrar resultado" (DEC-047 §3.3).
 */
async function selectOverdueTestDrives(
  tx: ScopedTransaction,
  organizationId: string,
  opportunityIds: readonly string[],
  window: Pick<PipelineWindow, "overdueFrom" | "overdueUntil">,
): Promise<Map<string, TestDriveSignals>> {
  const signals = new Map<string, TestDriveSignals>();
  if (opportunityIds.length === 0) return signals;
  const rows = await tx
    .select({
      opportunityId: testDrives.opportunityId,
      overdue: sql<number>`count(*)`.mapWith(Number),
      latestAt: max(testDrives.scheduledAt),
    })
    .from(testDrives)
    .where(
      and(
        eq(testDrives.organizationId, organizationId),
        inArray(testDrives.opportunityId, [...opportunityIds]),
        inArray(testDrives.status, [...OPEN_TEST_DRIVE_STATUSES]),
        gte(testDrives.scheduledAt, window.overdueFrom),
        lte(testDrives.scheduledAt, window.overdueUntil),
      ),
    )
    .groupBy(testDrives.opportunityId);
  for (const row of rows) {
    if (row.latestAt) {
      signals.set(row.opportunityId, {
        overdue: row.overdue,
        latestAt: row.latestAt,
      });
    }
  }
  return signals;
}

/**
 * Loader de /opportunities/pipeline. `now` es el instante de la request:
 * fija la recencia, la ventana de cerradas y el día de validez.
 */
export async function getOpportunityPipeline(
  now: Date = new Date(),
): Promise<PipelineBoard> {
  const ctx = await requireTenant();
  const window = pipelineWindow(now);
  const { organizationId } = ctx;

  const source = await withTenant(ctx, async (tx) => {
    const open = await selectOpenRows(tx, organizationId);
    const won = await selectClosedRows(
      tx,
      organizationId,
      "won",
      window.closedFrom,
    );
    const lost = await selectClosedRows(
      tx,
      organizationId,
      "lost",
      window.closedFrom,
    );
    const openIds = open.map((row) => row.id);
    const cardIds = [
      ...openIds,
      ...won.rows.map((row) => row.id),
      ...lost.rows.map((row) => row.id),
    ];
    const demand = await selectDemandRows(tx, organizationId, cardIds);
    // Sin abiertas no hay a quién evaluar contra el stock.
    const stock =
      open.length === 0 ? [] : await selectMatchCandidates(tx, organizationId);
    const lastNotes = await selectLastNoteTimes(tx, organizationId, openIds);
    const quoteSignals = await selectQuoteSignals(
      tx,
      organizationId,
      openIds,
      window.today,
    );
    const testDriveSignals = await selectOverdueTestDrives(
      tx,
      organizationId,
      openIds,
      window,
    );
    return {
      open,
      won,
      lost,
      demand,
      stock,
      lastNotes,
      quotes: quoteSignals,
      testDrives: testDriveSignals,
    };
  });

  return pipelineBoard(source, window);
}
