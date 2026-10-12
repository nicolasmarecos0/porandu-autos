import "server-only";

import { and, asc, desc, eq } from "drizzle-orm";

import { demandSummary } from "@/domains/demand/presentation";
import { resolveDemand, type DemandTruth } from "@/domains/demand/resolver";
import { demandSnapshot } from "@/domains/demand/snapshot";
import type { MatchableVehicle } from "@/domains/match/types";
import { SOURCE_LABELS } from "@/domains/opportunities/labels";
import { initialsOf, maskPhone } from "@/domains/opportunities/prospect";
import { bucketFromRecency } from "@/domains/opportunities/queue";
import { minuteOfDay } from "@/domains/opportunities/recency";
import type {
  Channel,
  Opportunity,
  Stage,
} from "@/domains/opportunities/types";
import {
  evaluateOpportunity,
  PORANDU_SCORE_COMPOSITION,
  stockFit,
} from "@/domains/scoring/engine";
import type { ScoreComposition } from "@/domains/scoring/types";
import { requireTenant } from "@/lib/tenant/session";

import { contacts, opportunities } from "../schema";
import { withTenant, type ScopedTransaction } from "../tenant";
import { selectDemandRows } from "./demand-rows";
import { selectLastNoteTimes } from "./opportunity-notes";
import { selectMatchCandidates } from "./vehicles";

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
 * Lo que la base todavía no tiene (señales, matches de la cola, trade-in,
 * responsable, conversación en vivo) llega como "sin dato": nunca se
 * completa con valores inventados.
 *
 * Demanda (H1.4, DEC-030): el ledger de todas las oportunidades de la cola
 * se lee por lote en la misma transacción withTenant() (filtro por
 * organización + RLS), el resolver corre en el servidor y a la página solo
 * llega un resumen por oportunidad: valores formateados, estado y los ids
 * de la edición. Sin evidencia, historial ni ids de usuario.
 *
 * Inteligencia (Hito 3, DEC-035): estado derivado, nunca persistido. En la
 * misma transacción se leen por lote las unidades disponibles de la
 * organización activa (las candidatas de Match v0) y la última nota de cada
 * oportunidad; el motor puro (domains/scoring/engine.ts) calcula en memoria,
 * con `now`, la recencia, el Porandú Score con su explicación y la NBA. De
 * los matches solo se usa el puntaje del Top Match (Vehicle Fit): la cola no
 * muestra tarjetas de match. Leer no escribe nada: ni `last_activity_at`, ni
 * scores, ni matches.
 */

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
  /** Unidad vinculada a la negociación (DEC-033), o null. */
  vehicleId: string | null;
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
      vehicleId: opportunities.vehicleId,
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
 * Lo que el motor de inteligencia lee además de la fila (DEC-035): el stock
 * disponible de la organización (candidatas de Match v0) y la nota más
 * reciente de la oportunidad.
 */
export type QueueSignals = Readonly<{
  stock: readonly MatchableVehicle[];
  lastNoteAt: Date | null;
}>;

const NO_SIGNALS: QueueSignals = { stock: [], lastNoteAt: null };

/**
 * Fila persistida → ViewModel de Opportunities. Pura: `now` fija el momento
 * de la recencia, `demand` es la Current Truth de su ledger y `signals`, el
 * stock y la bitácora. Solo completa lo persistido y lo que se deriva de
 * ello, incluida la inteligencia del motor (DEC-035).
 */
export function toOpportunity(
  row: OpportunityQueueRow,
  now: Date,
  demand: DemandTruth = resolveDemand([]),
  signals: QueueSignals = NO_SIGNALS,
): Opportunity {
  const stage = stageFromDb[row.stage];
  const intelligence = evaluateOpportunity(
    {
      stage,
      lastActivityAt: row.lastActivityAt,
      lastNoteAt: signals.lastNoteAt,
      hasLinkedVehicle: row.vehicleId !== null,
      stockFit: stockFit(demandSnapshot(demand), signals.stock),
    },
    now,
  );
  const { minutes, state } = intelligence.recency;
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
    scores: intelligence.scores,
    scoreExplanation: intelligence.explanation,
    lastActivity: { minutes, state },
    stage,
    bucket: bucketFromRecency(minutes),
    ...(intelligence.nba ? { nba: intelligence.nba } : {}),
    drivers: [],
  };
}

/** Loader de la página /opportunities: la cola de la organización activa. */
export async function getOpportunityQueue(
  now: Date = new Date(),
): Promise<OpportunityQueue> {
  const ctx = await requireTenant();
  const { rows, demand, stock, lastNotes } = await withTenant(
    ctx,
    async (tx) => {
      const rows = await selectQueue(tx, ctx.organizationId);
      const ids = rows.map((row) => row.id);
      // Sin oportunidades no se lee nada más: no hay a quién evaluar.
      const demand = await selectDemandRows(tx, ctx.organizationId, ids);
      const stock =
        rows.length === 0
          ? []
          : await selectMatchCandidates(tx, ctx.organizationId);
      const lastNotes = await selectLastNoteTimes(tx, ctx.organizationId, ids);
      return { rows, demand, stock, lastNotes };
    },
  );
  return {
    opportunities: rows.map((row) =>
      toOpportunity(row, now, resolveDemand(demand.get(row.id) ?? []), {
        stock,
        lastNoteAt: lastNotes.get(row.id) ?? null,
      }),
    ),
    referenceMinuteOfDay: minuteOfDay(now, PRESENTATION_TIME_ZONE),
    scoreComposition: PORANDU_SCORE_COMPOSITION,
  };
}
