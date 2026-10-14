import type { DemandSnapshot } from "@/domains/demand/snapshot";
import { findMatchesForDemand } from "@/domains/match/engine";
import { hasMatchableDemand } from "@/domains/match/presentation";
import type { MatchableVehicle } from "@/domains/match/types";
import { stageLabel } from "@/domains/opportunities/labels";
import { minutesSince } from "@/domains/opportunities/recency";
import { isTerminalStage, type Stage } from "@/domains/opportunities/stages";
import type { NbaKind, NextBestAction } from "@/domains/opportunities/types";

import type {
  NbaCode,
  Recency,
  RecencyState,
  ScoreComposition,
  ScoreExplanation,
  ScorePenalty,
  ScoreSet,
  ScoreValue,
  StockFit,
  SubScoreKey,
} from "./types";

/*
 * Motor de inteligencia v0 (Hito 3, DEC-035): recencia, Porandú Score
 * (el "Health Score" de la oportunidad) y Next Best Action. Determinista,
 * síncrono, explicable y puro: no carga datos ni conoce la base, React o
 * Next. Estado derivado: se calcula en cada lectura con `now` explícito y
 * nunca se persiste, así que no puede desincronizarse de los hechos.
 *
 *   last_activity_at ─► recencia ─────────────────┐
 *   etapa ───────────► Deal Readiness ─┐          ├─► penalización
 *   unidad vinculada ┐                 ├─► base ──┴─► Porandú Score
 *   Match v0 ────────┴► Vehicle Fit ───┘
 *   (Intent: sin dato hasta las conversaciones)
 *
 *   recencia + etapa + unidad + Match v0 + bitácora ─► Next Best Action
 *
 * Los cuatro scores son los de DEC-004. Un sub-score sin dato no penaliza:
 * la base es el promedio ponderado de los conocidos y la cobertura dice qué
 * parte de la composición se evaluó (DEC-005). Los pesos y los puntos son
 * provisorios: se recalibran con datos del piloto (DEC-004).
 */

const MINUTES_PER_HOUR = 60;
const MINUTES_PER_DAY = 24 * MINUTES_PER_HOUR;

/** Límites de los estados de recencia, en días. */
export const RECENCY_STATE_DAYS = { warning: 2, stale: 5 } as const;

/**
 * Composición del Porandú Score v0: la conceptual del Master Context §10
 * (Intent 40 %, Vehicle Fit 30 %, Deal Readiness 30 %), que ahora sí es la
 * fórmula con que se calcula la base.
 */
export const PORANDU_SCORE_COMPOSITION: ScoreComposition = [
  { key: "intent", weight: 0.4 },
  { key: "fit", weight: 0.3 },
  { key: "deal", weight: 0.3 },
];

/** Deal Readiness por etapa: las avanzadas parten de una base mayor. */
export const DEAL_READINESS_BY_STAGE: Readonly<Record<Stage, number>> = {
  new: 20,
  qualifying: 45,
  negotiating: 75,
  won: 100,
  lost: 0,
};

/** Vehicle Fit con una unidad del stock vinculada a la negociación. */
export const LINKED_VEHICLE_FIT = 100;

/** Puntos que resta la inactividad al Porandú Score de una oportunidad abierta. */
export const RECENCY_PENALTY: Readonly<Record<RecencyState, number>> = {
  active: 0,
  warning: 15,
  stale: 40,
};

/** Una nota de la bitácora es reciente si tiene menos de estos días. */
export const NOTE_RECENT_DAYS = 2;

/** Porandú Score de una etapa terminal: el resultado ya se conoce. */
const OUTCOME_SCORE: Readonly<Record<"won" | "lost", number>> = {
  won: 100,
  lost: 0,
};

/** Cuántas acciones secundarias acompañan a la primaria (B1 §3.2). */
const MAX_SECONDARY_ACTIONS = 2;

/** Lo que el motor necesita de una oportunidad. */
export type ScoringInput = Readonly<{
  stage: Stage;
  /** Última interacción con el cliente (`last_activity_at`). */
  lastActivityAt: Date;
  /** Nota más reciente de la bitácora (DEC-033), o null si no tiene. */
  lastNoteAt: Date | null;
  /** Tiene una unidad del stock vinculada (`vehicle_id`, DEC-033). */
  hasLinkedVehicle: boolean;
  /** Match v0 de la demanda vigente contra el stock disponible. */
  stockFit: StockFit;
}>;

/** Todo lo que el motor deriva de una oportunidad en un momento dado. */
export type OpportunityIntelligence = Readonly<{
  recency: Recency;
  scores: ScoreSet;
  explanation: ScoreExplanation;
  /** `null` en una oportunidad cerrada: no hay nada que hacer. */
  nba: NextBestAction | null;
}>;

function assertValidDate(date: Date, name: string): void {
  if (Number.isNaN(date.getTime())) {
    throw new RangeError(`scoring: invalid ${name}`);
  }
}

/** Estado de recencia para los minutos transcurridos. */
export function recencyState(minutes: number): RecencyState {
  if (minutes < RECENCY_STATE_DAYS.warning * MINUTES_PER_DAY) return "active";
  if (minutes <= RECENCY_STATE_DAYS.stale * MINUTES_PER_DAY) return "warning";
  return "stale";
}

/** Instantes que separan los estados de recencia en un momento dado. */
export type RecencyCutoffs = Readonly<{
  /** `last_activity_at` igual o anterior: al menos Enfriándose. */
  warning: Date;
  /** `last_activity_at` igual o anterior: Inactiva. */
  stale: Date;
}>;

/**
 * La regla de `recencyState()` expresada como instantes de corte para `now`,
 * para que la base cuente estados sin repetir los umbrales (Hito 5,
 * DEC-037 §8). Como `minutesSince()` trunca a minutos enteros:
 *
 * - Enfriándose desde 2 días exactos: `minutos ≥ 2880` ⇔ `last ≤ now − 2880 min`;
 * - Inactiva desde que pasa los 5 días: `minutos > 7200` ⇔ `minutos ≥ 7201`
 *   ⇔ `last ≤ now − 7201 min`.
 *
 * Una fecha futura queda después de los dos cortes: Activa, como en
 * `evaluateRecency()`.
 */
export function recencyCutoffs(now: Date): RecencyCutoffs {
  assertValidDate(now, "now");
  const at = (minutes: number) => new Date(now.getTime() - minutes * 60_000);
  return {
    warning: at(RECENCY_STATE_DAYS.warning * MINUTES_PER_DAY),
    stale: at(RECENCY_STATE_DAYS.stale * MINUTES_PER_DAY + 1),
  };
}

/**
 * Recencia desde `lastActivityAt` hasta `now`: minutos, horas y días
 * enteros, y su estado. Una fecha futura (reloj desfasado) cuenta como 0.
 */
export function evaluateRecency(lastActivityAt: Date, now: Date): Recency {
  assertValidDate(lastActivityAt, "lastActivityAt");
  assertValidDate(now, "now");
  const minutes = minutesSince(lastActivityAt, now);
  return {
    state: recencyState(minutes),
    minutes,
    hours: Math.floor(minutes / MINUTES_PER_HOUR),
    days: Math.floor(minutes / MINUTES_PER_DAY),
  };
}

/**
 * Match v0 (DEC-031) de la demanda contra las unidades del stock: el puntaje
 * del Top Match, o por qué no lo hay. Mismos tres casos "sin match" que el
 * rail de /opportunities/[id]. Unidades de más de una organización fallan
 * cerrado (lo exige el motor de Match).
 */
export function stockFit(
  demand: DemandSnapshot,
  vehicles: readonly MatchableVehicle[],
): StockFit {
  if (!hasMatchableDemand(demand)) return { kind: "no_demand" };
  if (vehicles.length === 0) return { kind: "no_stock" };
  const [top] = findMatchesForDemand(demand, vehicles);
  return top ? { kind: "match", score: top.score.total } : { kind: "no_match" };
}

type Factor = Readonly<{ value: ScoreValue; reason: string }>;

function plural(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`;
}

/** Intent: sin dato hasta que existan conversaciones (Hito 2). */
function intentFactor(): Factor {
  return { value: null, reason: "Sin dato: llega con las conversaciones" };
}

/**
 * Vehicle Fit: una unidad vinculada suma lo máximo; si no, el Top Match del
 * stock. "No coincide" es 0; sin demanda o sin stock es sin dato (DEC-005).
 */
function fitFactor(input: ScoringInput): Factor {
  if (input.hasLinkedVehicle) {
    return { value: LINKED_VEHICLE_FIT, reason: "Unidad del stock vinculada" };
  }
  const fit = input.stockFit;
  switch (fit.kind) {
    case "match":
      return {
        value: fit.score,
        reason: `Top Match en stock: ${fit.score} pts`,
      };
    case "no_match":
      return { value: 0, reason: "Ninguna unidad disponible coincide" };
    case "no_demand":
      return { value: null, reason: "Sin dato: falta lo que busca" };
    case "no_stock":
      return { value: null, reason: "Sin dato: no hay unidades disponibles" };
  }
}

/** Deal Readiness: la base de la etapa. */
function dealFactor(stage: Stage): Factor {
  return {
    value: DEAL_READINESS_BY_STAGE[stage],
    reason: `Etapa ${stageLabel(stage)}`,
  };
}

/**
 * Promedio ponderado de los sub-scores conocidos y la cobertura (la suma de
 * sus pesos). Se calcula con pesos enteros (en %) para que el redondeo sea
 * exacto: 87,5 redondea a 88, nunca a 87 por un error de coma flotante.
 */
function weightedBase(
  values: Readonly<Record<SubScoreKey, ScoreValue>>,
): Readonly<{ base: number | null; coverage: number }> {
  let weight = 0;
  let sum = 0;
  for (const part of PORANDU_SCORE_COMPOSITION) {
    const value = values[part.key];
    if (value === null) continue;
    const percent = Math.round(part.weight * 100);
    weight += percent;
    sum += percent * value;
  }
  return {
    base: weight === 0 ? null : sum / weight,
    coverage: weight / 100,
  };
}

function clampScore(value: number): number {
  return Math.min(100, Math.max(0, Math.round(value)));
}

function inactivityPenalty(recency: Recency): ScorePenalty | null {
  const points = RECENCY_PENALTY[recency.state];
  if (points === 0) return null;
  const elapsed = plural(recency.days, "día", "días");
  return {
    kind: "inactivity",
    label:
      recency.state === "stale"
        ? `Inactiva hace ${elapsed} · riesgo de pérdida`
        : `Sin actividad hace ${elapsed}`,
    points: -points,
  };
}

/**
 * Porandú Score v0 con su explicación. Abierta: base ponderada menos la
 * penalización por inactividad, entre 0 y 100. Cerrada: el resultado
 * (Ganada 100, Perdida 0), sin penalizaciones.
 */
export function scoreOpportunity(
  input: ScoringInput,
  recency: Recency,
): Readonly<{ scores: ScoreSet; explanation: ScoreExplanation }> {
  const intent = intentFactor();
  const fit = fitFactor(input);
  const deal = dealFactor(input.stage);
  const values = { intent: intent.value, fit: fit.value, deal: deal.value };
  const factors = {
    intent: intent.reason,
    fit: fit.reason,
    deal: deal.reason,
  };
  const { base, coverage } = weightedBase(values);

  if (input.stage === "won" || input.stage === "lost") {
    return {
      scores: { porandu: OUTCOME_SCORE[input.stage], coverage, ...values },
      explanation: {
        factors,
        penalties: [],
        outcome:
          input.stage === "won"
            ? "Ganada: la venta se concretó"
            : "Perdida: la oportunidad se descartó",
      },
    };
  }

  const penalty = inactivityPenalty(recency);
  const penalties = penalty ? [penalty] : [];
  const porandu =
    base === null
      ? null
      : clampScore(
          penalties.reduce((total, item) => total + item.points, base),
        );
  return {
    scores: { porandu, coverage, ...values },
    explanation: { factors, penalties, outcome: null },
  };
}

type Suggestion = Readonly<{
  code: NbaCode;
  kind: NbaKind;
  action: string;
  reason: string;
}>;

function linkVehicleReason(fit: StockFit): string {
  const prefix = "En negociación sin una unidad vinculada";
  switch (fit.kind) {
    case "match":
      return `${prefix}. El Top Match del stock suma ${fit.score} pts.`;
    case "no_match":
      return `${prefix}, y ninguna unidad disponible coincide con lo que busca.`;
    case "no_demand":
      return `${prefix}. Cargá lo que busca para encontrarla en el stock.`;
    case "no_stock":
      return `${prefix}, y no hay unidades disponibles en stock.`;
  }
}

/** Días enteros desde la nota más reciente, o null sin notas. */
function noteAgeDays(lastNoteAt: Date | null, now: Date): number | null {
  if (lastNoteAt === null) return null;
  assertValidDate(lastNoteAt, "lastNoteAt");
  return Math.floor(minutesSince(lastNoteAt, now) / MINUTES_PER_DAY);
}

/**
 * Reglas de la Next Best Action, en orden de prioridad. Todas las que se
 * cumplen se devuelven: la primera es la acción primaria y las dos
 * siguientes, las secundarias.
 */
function suggestions(
  input: ScoringInput,
  recency: Recency,
  now: Date,
): Suggestion[] {
  const result: Suggestion[] = [];
  if (recency.state === "stale") {
    result.push({
      code: "recover_stale",
      kind: "call",
      action: "Retomar contacto urgente",
      reason: `Sin actividad del cliente hace ${plural(recency.days, "día", "días")}: riesgo de pérdida.`,
    });
  }
  if (input.stage === "negotiating" && !input.hasLinkedVehicle) {
    result.push({
      code: "link_vehicle",
      kind: "linkVehicle",
      action: "Vincular unidad de stock",
      reason: linkVehicleReason(input.stockFit),
    });
  }
  const noteDays = noteAgeDays(input.lastNoteAt, now);
  if (noteDays === null || noteDays >= NOTE_RECENT_DAYS) {
    result.push({
      code: "log_contact_update",
      kind: "note",
      action: "Registrar actualización de contacto",
      reason:
        noteDays === null
          ? "Todavía no hay notas en la bitácora."
          : `La última nota es de hace ${plural(noteDays, "día", "días")}.`,
    });
  }
  if (recency.state === "warning") {
    result.push({
      code: "follow_up",
      kind: "message",
      action: "Hacer seguimiento",
      reason: `Sin actividad del cliente hace ${plural(recency.days, "día", "días")}.`,
    });
  }
  return result;
}

const ON_TRACK: Suggestion = {
  code: "on_track",
  kind: "message",
  action: "Sostener el seguimiento",
  reason: "Actividad y bitácora al día.",
};

/**
 * Next Best Action de una oportunidad abierta: la regla de mayor prioridad
 * que se cumple, con su porqué y hasta dos secundarias. Sin ninguna, la
 * oportunidad está al día. Una cerrada no tiene acción (null). Ninguna
 * sugerencia cambia condiciones económicas: ninguna requiere aprobación.
 */
export function nextBestAction(
  input: ScoringInput,
  recency: Recency,
  now: Date,
): NextBestAction | null {
  if (isTerminalStage(input.stage)) return null;
  const [primary = ON_TRACK, ...rest] = suggestions(input, recency, now);
  return {
    code: primary.code,
    kind: primary.kind,
    action: primary.action,
    reason: primary.reason,
    secondary: rest
      .slice(0, MAX_SECONDARY_ACTIONS)
      .map((suggestion) => suggestion.action),
    urgent: primary.code === "recover_stale",
  };
}

/** Recencia, Porandú Score con su explicación y NBA de una oportunidad. */
export function evaluateOpportunity(
  input: ScoringInput,
  now: Date,
): OpportunityIntelligence {
  const recency = evaluateRecency(input.lastActivityAt, now);
  const { scores, explanation } = scoreOpportunity(input, recency);
  return {
    recency,
    scores,
    explanation,
    nba: nextBestAction(input, recency, now),
  };
}
