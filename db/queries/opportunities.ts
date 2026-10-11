import "server-only";

import { and, asc, desc, eq } from "drizzle-orm";

import { demandSummary } from "@/domains/demand/presentation";
import { resolveDemand, type DemandTruth } from "@/domains/demand/resolver";
import { SOURCE_LABELS } from "@/domains/opportunities/labels";
import { initialsOf, maskPhone } from "@/domains/opportunities/prospect";
import { bucketFromRecency } from "@/domains/opportunities/queue";
import { minuteOfDay, minutesSince } from "@/domains/opportunities/recency";
import type {
  Channel,
  Opportunity,
  Stage,
} from "@/domains/opportunities/types";
import { UNSCORED, type ScoreComposition } from "@/domains/scoring/types";
import { requireTenant } from "@/lib/tenant/session";

import { contacts, opportunities } from "../schema";
import { withTenant, type ScopedTransaction } from "../tenant";
import { selectDemandRows } from "./demand-rows";

/*
 * Cola de Opportunities desde PostgreSQL (H1.1). Es la única fuente de la
 * lista: el fixture de B1 (mocks/opportunities.ts) ya no la alimenta.
 *
 *   request → requireTenant() → TenantContext → withTenant() → query con
 *   filtro explícito por organización → RLS → ViewModel de la UI
 *
 * - requireTenant() valida en cada request la organización activa contra
 *   las memberships activas del usuario (DEC-021). El layout de (app) es solo
 *   un gate de UX: este loader pide su propio contexto.
 * - withTenant() corre la lectura como `authenticated` con los claims de la
 *   request; RLS deja ver solo organizaciones con membership activa.
 * - El filtro por `ctx.organizationId` es defensa en profundidad (ADR-001
 *   §2): con varias memberships activas, RLS deja ver todas sus
 *   organizaciones y el filtro deja solo la activa.
 *
 * Lo que la base todavía no tiene (scores, NBA, señales, matches, trade-in,
 * responsable, conversación en vivo) llega como "sin dato": nunca se
 * completa con valores inventados.
 *
 * Demanda (H1.4, DEC-030): el ledger de todas las oportunidades de la cola
 * se lee por lote en la misma transacción withTenant() (filtro por
 * organización + RLS), el resolver corre en el servidor y a la página solo
 * llega un resumen por oportunidad: valores formateados, estado y los ids
 * de la edición. Sin evidencia, historial ni ids de usuario.
 */

/**
 * Composición conceptual del Porandú Score (Master Context §10: Intent 40 %,
 * Vehicle Fit 30 %, Deal Readiness 30 %). Solo dibuja el anillo, hoy todo
 * "sin dato". No es la fórmula del producto (DEC-004): la fija Hito 3.
 */
const CONCEPTUAL_SCORE_COMPOSITION: ScoreComposition = [
  { key: "intent", weight: 0.4 },
  { key: "fit", weight: 0.3 },
  { key: "deal", weight: 0.3 },
];

/**
 * Zona horaria con que se presenta la recencia ("ayer", "hace 3 días"). Las
 * organizaciones todavía no guardan su zona horaria (TB §10): P1 opera en
 * Paraguay.
 */
const PRESENTATION_TIME_ZONE = "America/Asuncion";

type OpportunityRecord = typeof opportunities.$inferSelect;

export const stageFromDb: Record<OpportunityRecord["stage"], Stage> = {
  new: "new",
  qualifying: "qualifying",
  negotiating: "negotiating",
  won: "won",
  lost: "lost",
};

// Mismo copy que el formulario de alta: una sola fuente (domains/).
export const channelFromDb: Record<OpportunityRecord["source"], Channel> =
  SOURCE_LABELS;

/** Lo que la cola lee de la base: solo lo persistido que muestra la UI. */
export type OpportunityQueueRow = Readonly<{
  id: string;
  stage: OpportunityRecord["stage"];
  source: OpportunityRecord["source"];
  interestModel: string | null;
  interestVersion: string | null;
  lastActivityAt: Date;
  contactName: string;
  contactPhone: string | null;
  contactCity: string | null;
}>;

export type OpportunityQueue = Readonly<{
  opportunities: readonly Opportunity[];
  /** Hora actual en minutos desde medianoche (zona de presentación). */
  referenceMinuteOfDay: number;
  scoreComposition: ScoreComposition;
}>;

function selectQueue(
  tx: ScopedTransaction,
  organizationId: string,
): Promise<OpportunityQueueRow[]> {
  return tx
    .select({
      id: opportunities.id,
      stage: opportunities.stage,
      source: opportunities.source,
      interestModel: opportunities.interestModel,
      interestVersion: opportunities.interestVersion,
      lastActivityAt: opportunities.lastActivityAt,
      contactName: contacts.name,
      contactPhone: contacts.phone,
      contactCity: contacts.city,
    })
    .from(opportunities)
    .innerJoin(
      contacts,
      and(
        eq(contacts.organizationId, opportunities.organizationId),
        eq(contacts.id, opportunities.contactId),
      ),
    )
    .where(eq(opportunities.organizationId, organizationId))
    .orderBy(desc(opportunities.lastActivityAt), asc(opportunities.id));
}

/** Texto opcional: vacío o en blanco es "sin dato". */
function present(value: string | null): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

/**
 * Fila persistida → ViewModel de Opportunities. Pura: `now` fija el momento
 * de la recencia y `demand` es la Current Truth de su ledger. Solo completa
 * lo persistido y lo que se deriva de ello.
 */
export function toOpportunity(
  row: OpportunityQueueRow,
  now: Date,
  demand: DemandTruth = resolveDemand([]),
): Opportunity {
  const minutes = minutesSince(row.lastActivityAt, now);
  const phone = row.contactPhone ? maskPhone(row.contactPhone) : undefined;
  const city = present(row.contactCity);
  const model = present(row.interestModel);
  const version = present(row.interestVersion);
  return {
    id: row.id,
    prospect: {
      name: row.contactName,
      initials: initialsOf(row.contactName),
      ...(phone ? { phone } : {}),
      ...(city ? { city } : {}),
      channel: channelFromDb[row.source],
      // Sin conversaciones persistidas todavía (Hito 2).
      live: false,
    },
    // El legado no es fuente de verdad: solo es el vehículo "Dato anterior"
    // mientras `desired_vehicle` nunca se cargó.
    demand: demandSummary(demand, {
      ...(model ? { model } : {}),
      ...(version ? { version } : {}),
    }),
    interest: {},
    scores: UNSCORED,
    lastActivity: { minutes },
    stage: stageFromDb[row.stage],
    bucket: bucketFromRecency(minutes),
    drivers: [],
  };
}

/** Loader de la página /opportunities: la cola de la organización activa. */
export async function getOpportunityQueue(
  now: Date = new Date(),
): Promise<OpportunityQueue> {
  const ctx = await requireTenant();
  const { rows, demand } = await withTenant(ctx, async (tx) => {
    const rows = await selectQueue(tx, ctx.organizationId);
    const demand = await selectDemandRows(
      tx,
      ctx.organizationId,
      rows.map((row) => row.id),
    );
    return { rows, demand };
  });
  return {
    opportunities: rows.map((row) =>
      toOpportunity(row, now, resolveDemand(demand.get(row.id) ?? [])),
    ),
    referenceMinuteOfDay: minuteOfDay(now, PRESENTATION_TIME_ZONE),
    scoreComposition: CONCEPTUAL_SCORE_COMPOSITION,
  };
}
