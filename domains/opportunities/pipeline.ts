import {
  addDays,
  isoDate,
  startOfZonedDay,
  zonedDate,
} from "@/domains/calendar/zoned-time";
import { cockpitWindow } from "@/domains/cockpit/window";
import {
  chatDaysAgo,
  chatListTime,
  chatTime,
} from "@/domains/conversations/chat-time";
import {
  demandSummary,
  UNDEFINED_VEHICLE,
} from "@/domains/demand/presentation";
import {
  resolveDemand,
  type DemandRow,
  type DemandTruth,
} from "@/domains/demand/resolver";
import { demandSnapshot } from "@/domains/demand/snapshot";
import type { MatchableVehicle } from "@/domains/match/types";
import type { Money } from "@/domains/money";
import { evaluateOpportunity, stockFit } from "@/domains/scoring/engine";
import {
  RECENCY_STATE_LABELS,
  type Recency,
  type RecencyState,
} from "@/domains/scoring/types";
import {
  vehicleDetail,
  vehicleName,
  type VehicleStatus,
} from "@/domains/vehicles/stock";

import type { LossReason } from "./closure";
import { STAGES } from "./labels";
import {
  closureOf,
  compareOpenCards,
  isStaleCard,
  opportunityTarget,
} from "./pipeline-moves";
import { initialsOf } from "./prospect";
import { isTerminalStage, OPPORTUNITY_STAGES, type Stage } from "./stages";
import {
  tradeInClosureNotice,
  type TradeInClosureNotice,
  type TradeInClosureRow,
} from "./trade-in-presentation";
import type { NextBestAction } from "./types";

/*
 * Tablero de oportunidades: el embudo de ventas (Pipeline como vista de
 * Opportunities, DEC-001 y B1 §4; propuesta DEC-048). Una columna por etapa
 * de DEC-032 (Nueva, En calificación, En negociación, Ganada y Perdida) y
 * una tarjeta por oportunidad.
 *
 * Módulo puro: arma el ViewModel en el servidor a partir de las filas que
 * leyó el loader (db/queries/pipeline.ts) y de `now`. No carga datos ni
 * conoce la base, React o Next. Las reglas de movimiento y el reductor
 * optimista, que sí viajan al navegador, viven en ./pipeline-moves.ts.
 *
 * - Abiertas (Nueva, En calificación, En negociación): todas, ordenadas por
 *   Porandú Score (DEC-035 §7), con la recencia y las acciones pendientes.
 *   Cada columna muestra a lo sumo OPEN_COLUMN_LIMIT y dice cuántas hay.
 * - Cerradas (Ganada, Perdida): las cerradas en los últimos
 *   CLOSED_WINDOW_DAYS días de Asunción, de la más reciente a la más vieja,
 *   a lo sumo CLOSED_COLUMN_LIMIT. La fecha de cierre es `updated_at`
 *   (DEC-037 §5). El historial completo sigue en la cola y en Inteligencia.
 *
 * La inteligencia es la misma de la cola: el motor puro de DEC-035
 * (recencia, Porandú Score y NBA) sobre la demanda vigente (DEC-030), Match
 * v0 contra el stock disponible (DEC-031), la bitácora y la unidad
 * vinculada. Nada se persiste.
 *
 * Alertas de cada tarjeta abierta (sutiles: color siempre junto a un texto,
 * DEC-013):
 * - Inactividad: el estado de recencia de DEC-035 §2 (Enfriándose desde 2
 *   días, Inactiva desde 5) con el tiempo sin actividad del cliente.
 * - Acciones pendientes, en orden de prioridad:
 *   1. cotizaciones en borrador vigentes: esperan la aprobación humana
 *      obligatoria antes de enviarse (DEC-042 §2);
 *   2. pruebas de manejo abiertas con la franja terminada en los últimos
 *      siete días: falta registrar el resultado (la misma "vencida" del
 *      Cockpit, DEC-047 §3.3);
 *   3. en negociación sin unidad vinculada: la condición de la NBA
 *      `link_vehicle` (DEC-035 §5), con su porqué cuando es la primaria.
 *   Las demás NBA (seguimiento, recuperar, registrar) ya las dice la
 *   inactividad o son la rutina de la cola: no recargan la tarjeta.
 */

/** Zona de presentación: P1 opera en Paraguay. */
export const PIPELINE_TIME_ZONE = "America/Asuncion";

/** Días de calendario de las columnas cerradas: hoy y los 29 anteriores. */
export const CLOSED_WINDOW_DAYS = 30;

/** Tope de tarjetas de una columna cerrada: las más recientes. */
export const CLOSED_COLUMN_LIMIT = 30;

/** Tope de tarjetas de una columna abierta: las de mayor prioridad. */
export const OPEN_COLUMN_LIMIT = 100;

/** Etapas abiertas: las columnas del trabajo en curso. */
export const OPEN_STAGES = [
  "new",
  "qualifying",
  "negotiating",
] as const satisfies readonly Stage[];

export type OpenStage = (typeof OPEN_STAGES)[number];

/** Qué parte del tiempo mira el tablero, en días de Asunción. */
export type PipelineWindow = Readonly<{
  /** Instante de la request. */
  now: Date;
  /** Día de Asunción de `now`, "AAAA-MM-DD" (validez de cotizaciones). */
  today: string;
  /** Primer instante de la ventana de cerradas (inclusive). */
  closedFrom: Date;
  /** Pruebas vencidas agendadas desde este instante (inclusive)… */
  overdueFrom: Date;
  /** …hasta este (inclusive): `now` menos la franja de 60 minutos. */
  overdueUntil: Date;
}>;

export function pipelineWindow(now: Date): PipelineWindow {
  const today = zonedDate(now, PIPELINE_TIME_ZONE);
  const first = addDays(today, -(CLOSED_WINDOW_DAYS - 1));
  // La "prueba vencida" es la del Cockpit: un solo criterio en el producto.
  const cockpit = cockpitWindow(now);
  return {
    now,
    today: isoDate(today),
    closedFrom: startOfZonedDay(
      first.year,
      first.month,
      first.day,
      PIPELINE_TIME_ZONE,
    ),
    overdueFrom: cockpit.recentFrom,
    overdueUntil: cockpit.upcomingFrom,
  };
}

/* ── Lo que lee el loader ───────────────────────────────────────────── */

/** La unidad vinculada a la oportunidad (DEC-033), tal como está en stock. */
export type PipelineVehicle = Readonly<{
  id: string;
  brand: string;
  model: string;
  version: string | null;
  year: number;
  /** Estado de Stock: ganar la vende (DEC-051). */
  status: VehicleStatus;
}>;

/** Una oportunidad del tablero, como la lee la base. */
export type PipelineRow = Readonly<{
  id: string;
  stage: Stage;
  contactName: string;
  /** Interés legado (H1.1): solo mientras la demanda nunca se cargó. */
  interestModel: string | null;
  interestVersion: string | null;
  /** Última interacción con el cliente (DEC-036 §1). */
  lastActivityAt: Date;
  /** En una cerrada, la fecha del cierre (DEC-037 §5). */
  updatedAt: Date;
  lossReason: LossReason | null;
  vehicle: PipelineVehicle | null;
}>;

/** Cotizaciones de una oportunidad que importan al tablero (DEC-042). */
export type QuoteSignals = Readonly<{
  /** Borradores vigentes: esperan la aprobación humana. */
  toApprove: number;
  /** El borrador vigente más reciente: para ir directo a revisarlo. */
  latestDraftId: string | null;
  /** Total de la cotización aceptada (a lo sumo una), o null. */
  accepted: Money | null;
}>;

/**
 * La toma vigente de una abierta (Hito 20, DEC-052 §5): lo que la
 * confirmación de Ganada avisa sobre el usado en parte de pago.
 */
export type PipelineTradeIn = TradeInClosureRow;

/** Pruebas de manejo vencidas de una oportunidad (DEC-047 §3.3). */
export type TestDriveSignals = Readonly<{
  overdue: number;
  /** La más reciente: la agenda abre en su día. */
  latestAt: Date;
}>;

/** Las cerradas de una etapa en la ventana: las primeras y el total. */
export type ClosedSource = Readonly<{
  rows: readonly PipelineRow[];
  total: number;
}>;

export type PipelineSource = Readonly<{
  /** Todas las abiertas de la organización activa. */
  open: readonly PipelineRow[];
  won: ClosedSource;
  lost: ClosedSource;
  /** Ledger de demanda de cada oportunidad del tablero (DEC-030). */
  demand: ReadonlyMap<string, readonly DemandRow[]>;
  /** Unidades disponibles: candidatas de Match v0 (DEC-031). */
  stock: readonly MatchableVehicle[];
  /** Nota más reciente de cada abierta (DEC-033). */
  lastNotes: ReadonlyMap<string, Date>;
  quotes: ReadonlyMap<string, QuoteSignals>;
  testDrives: ReadonlyMap<string, TestDriveSignals>;
  /** La toma vigente de cada abierta, si tiene (DEC-052). */
  tradeIns: ReadonlyMap<string, PipelineTradeIn>;
}>;

/* ── ViewModel ──────────────────────────────────────────────────────── */

/** Adónde lleva una acción pendiente. La UI arma el enlace. */
export type PipelineTarget =
  | Readonly<{ kind: "opportunity"; opportunityId: string }>
  | Readonly<{ kind: "quote"; opportunityId: string; quoteId: string }>
  | Readonly<{ kind: "calendar_day"; day: string }>;

export type PendingActionKind =
  "quote_approval" | "test_drive_result" | "link_vehicle";

/** Algo que la oportunidad espera del equipo. */
export type PendingAction = Readonly<{
  kind: PendingActionKind;
  /** "Cotización por aprobar", "2 pruebas sin resultado"… */
  label: string;
  /** Por qué importa: título del chip y texto para lectores de pantalla. */
  description: string;
  tone: "brand" | "warning";
  target: PipelineTarget;
}>;

/** Inactividad de una abierta (DEC-035 §2). */
export type CardRecency = Readonly<{
  state: RecencyState;
  /** "Activa", "Enfriándose" o "Inactiva". */
  label: string;
  /** Minutos sin actividad del cliente: ordenan a igual score. */
  minutes: number;
  /** Corto, para la tarjeta: "35 min", "5 h", "3 d". */
  elapsed: string;
  /** Completo: "Última actividad del cliente hace 3 días". */
  description: string;
}>;

/** Cierre de una tarjeta Ganada o Perdida. */
export type CardClosure = Readonly<{
  /** "Ganada" o "Perdida". */
  label: string;
  /** Motivo de la pérdida ("Precio"), o null. */
  reason: string | null;
  /** Cuándo: "hoy", "ayer", "lunes", "28 oct". */
  when: string;
  /** Instante ISO del cierre; null mientras se guarda. */
  at: string | null;
}>;

/**
 * La unidad que se vende al marcarla ganada (la vinculada), con su estado de
 * Stock: la confirmación avisa que pasa a Vendida, o por qué no puede
 * (DEC-051).
 */
export type SaleVehicleSummary = Readonly<{
  name: string;
  detail: string;
  status: VehicleStatus;
}>;

export type PipelineCard = Readonly<{
  id: string;
  stage: Stage;
  name: string;
  initials: string;
  /** Primera línea: la unidad vinculada o lo que busca. */
  headline: string;
  headlineSource: "unit" | "demand" | "legacy" | "none";
  /** Segunda línea: versión y año de la unidad, o años o presupuesto. */
  detail: string | null;
  /** Porandú Score de una abierta (DEC-035). Null: sin dato o cerrada. */
  score: number | null;
  /** Solo abiertas. */
  recency: CardRecency | null;
  /** Solo abiertas, de la más importante a la menos. */
  pending: readonly PendingAction[];
  /** Solo cerradas. */
  closure: CardClosure | null;
  /** Para "Marcar como ganada": sin unidad no se ofrece confirmar. */
  saleVehicle: SaleVehicleSummary | null;
  /** Precarga el precio final al ganarla (DEC-042 §7). */
  acceptedQuoteTotal: Money | null;
  /**
   * Para "Marcar como ganada": la toma aceptada entra al stock al confirmar;
   * una sin decidir, no (DEC-052 §5). Solo abiertas.
   */
  tradeIn: TradeInClosureNotice | null;
}>;

export type PipelineColumn = Readonly<{
  stage: Stage;
  label: string;
  /** Qué significa la etapa, o la ventana de una cerrada. */
  hint: string;
  /** Las que se muestran, en orden. */
  cards: readonly PipelineCard[];
  /** Cuántas hay: abiertas, todas; cerradas, las de la ventana. */
  total: number;
  /** Inactivas entre las abiertas de la columna. */
  stale: number;
  /** Tope de tarjetas de la columna. */
  limit: number;
}>;

export type PipelineBoard = Readonly<{
  /** Una por etapa, en el orden del flujo (DEC-032 §1). */
  columns: readonly PipelineColumn[];
  summary: Readonly<{
    /** Oportunidades abiertas. */
    open: number;
    /** Abiertas Inactivas. */
    stale: number;
    /** Abiertas con alguna acción pendiente. */
    pending: number;
  }>;
  closedWindowDays: number;
  /** Instante de la lectura (ISO). */
  generatedAt: string;
  /** Hora de Asunción de la lectura: "14:32". */
  generatedLabel: string;
}>;

/* ── Armado ─────────────────────────────────────────────────────────── */

const MINUTES_PER_HOUR = 60;
const MINUTES_PER_DAY = 24 * MINUTES_PER_HOUR;

function plural(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`;
}

/** "ahora", "35 min", "5 h", "3 d". */
export function elapsedShort(minutes: number): string {
  if (minutes < 1) return "ahora";
  if (minutes < MINUTES_PER_HOUR) return `${minutes} min`;
  if (minutes < MINUTES_PER_DAY) {
    return `${Math.floor(minutes / MINUTES_PER_HOUR)} h`;
  }
  return `${Math.floor(minutes / MINUTES_PER_DAY)} d`;
}

function elapsedDescription(recency: Recency): string {
  if (recency.minutes < 1) return "Última actividad del cliente: ahora";
  const span =
    recency.minutes < MINUTES_PER_HOUR
      ? plural(recency.minutes, "minuto", "minutos")
      : recency.minutes < MINUTES_PER_DAY
        ? plural(recency.hours, "hora", "horas")
        : plural(recency.days, "día", "días");
  return `Última actividad del cliente hace ${span}`;
}

function cardRecency(recency: Recency): CardRecency {
  return {
    state: recency.state,
    label: RECENCY_STATE_LABELS[recency.state],
    minutes: recency.minutes,
    elapsed: elapsedShort(recency.minutes),
    description: elapsedDescription(recency),
  };
}

/** Cuándo se cerró, en días de Asunción: "hoy", "ayer", "lunes", "28 oct". */
export function closedWhen(at: Date, now: Date): string {
  const days = chatDaysAgo(at, now);
  if (days === 0) return "hoy";
  if (days === 1) return "ayer";
  return chatListTime(at, now).toLowerCase();
}

function unitOf(vehicle: PipelineVehicle) {
  return {
    brand: vehicle.brand,
    model: vehicle.model,
    ...(vehicle.version ? { version: vehicle.version } : {}),
    year: vehicle.year,
  };
}

function saleVehicleOf(
  vehicle: PipelineVehicle | null,
): SaleVehicleSummary | null {
  if (!vehicle) return null;
  const unit = unitOf(vehicle);
  return {
    name: vehicleName(unit),
    detail: vehicleDetail(unit),
    status: vehicle.status,
  };
}

/**
 * Primera y segunda línea: la unidad vinculada si la hay (es lo que se
 * negocia o se vendió); si no, lo que busca (DEC-030) o, mientras la
 * demanda nunca se cargó, el interés legado.
 */
function headlineOf(
  row: PipelineRow,
  truth: DemandTruth,
): Pick<PipelineCard, "headline" | "headlineSource" | "detail"> {
  const sold = saleVehicleOf(row.vehicle);
  if (sold) {
    return { headline: sold.name, headlineSource: "unit", detail: sold.detail };
  }
  const summary = demandSummary(truth, {
    ...(row.interestModel ? { model: row.interestModel } : {}),
    ...(row.interestVersion ? { version: row.interestVersion } : {}),
  });
  const detail =
    summary.facts.year_range.display ?? summary.facts.budget_max.display;
  return summary.vehicle
    ? {
        headline: summary.vehicle.title,
        headlineSource: summary.vehicle.source,
        detail,
      }
    : { headline: UNDEFINED_VEHICLE, headlineSource: "none", detail };
}

function count(n: number, one: string, many: string): string {
  return n === 1 ? one : `${n} ${many}`;
}

/** Acciones pendientes de una abierta, de la más importante a la menos. */
function pendingActions(
  row: PipelineRow,
  nba: NextBestAction | null,
  quotes: QuoteSignals | undefined,
  testDrives: TestDriveSignals | undefined,
): readonly PendingAction[] {
  const pending: PendingAction[] = [];
  if (quotes && quotes.toApprove > 0) {
    pending.push({
      kind: "quote_approval",
      label: count(
        quotes.toApprove,
        "Cotización por aprobar",
        "cotizaciones por aprobar",
      ),
      description: "Falta la aprobación humana antes de entregarla al cliente.",
      tone: "brand",
      target:
        quotes.toApprove === 1 && quotes.latestDraftId
          ? {
              kind: "quote",
              opportunityId: row.id,
              quoteId: quotes.latestDraftId,
            }
          : opportunityTarget(row.id),
    });
  }
  if (testDrives && testDrives.overdue > 0) {
    pending.push({
      kind: "test_drive_result",
      label: count(
        testDrives.overdue,
        "Prueba sin resultado",
        "pruebas sin resultado",
      ),
      description:
        "La prueba de manejo ya pasó: falta registrar si se realizó.",
      tone: "warning",
      target: {
        kind: "calendar_day",
        day: isoDate(zonedDate(testDrives.latestAt, PIPELINE_TIME_ZONE)),
      },
    });
  }
  // La condición de la NBA `link_vehicle` (DEC-035 §5): sigue pendiente
  // aunque la NBA primaria sea otra (p. ej. recuperar una inactiva).
  if (row.stage === "negotiating" && row.vehicle === null) {
    pending.push({
      kind: "link_vehicle",
      label: "Vincular unidad",
      description:
        nba?.code === "link_vehicle"
          ? nba.reason
          : "En negociación sin una unidad del stock vinculada.",
      tone: "brand",
      target: opportunityTarget(row.id),
    });
  }
  return pending;
}

function identityOf(
  row: PipelineRow,
): Pick<PipelineCard, "id" | "stage" | "name" | "initials"> {
  return {
    id: row.id,
    stage: row.stage,
    name: row.contactName,
    initials: initialsOf(row.contactName),
  };
}

function openCard(
  row: PipelineRow,
  source: PipelineSource,
  now: Date,
): PipelineCard {
  const truth = resolveDemand(source.demand.get(row.id) ?? []);
  const intelligence = evaluateOpportunity(
    {
      stage: row.stage,
      lastActivityAt: row.lastActivityAt,
      lastNoteAt: source.lastNotes.get(row.id) ?? null,
      hasLinkedVehicle: row.vehicle !== null,
      stockFit: stockFit(demandSnapshot(truth), source.stock),
    },
    now,
  );
  const quotes = source.quotes.get(row.id);
  return {
    ...identityOf(row),
    ...headlineOf(row, truth),
    score: intelligence.scores.porandu,
    recency: cardRecency(intelligence.recency),
    pending: pendingActions(
      row,
      intelligence.nba,
      quotes,
      source.testDrives.get(row.id),
    ),
    closure: null,
    saleVehicle: saleVehicleOf(row.vehicle),
    acceptedQuoteTotal: quotes?.accepted ?? null,
    tradeIn: tradeInClosureNotice(source.tradeIns.get(row.id) ?? null),
  };
}

function closedCard(
  row: PipelineRow,
  stage: "won" | "lost",
  source: PipelineSource,
  now: Date,
): PipelineCard {
  const truth = resolveDemand(source.demand.get(row.id) ?? []);
  return {
    ...identityOf(row),
    ...headlineOf(row, truth),
    score: null,
    recency: null,
    pending: [],
    closure: closureOf(
      stage,
      row.lossReason,
      closedWhen(row.updatedAt, now),
      row.updatedAt.toISOString(),
    ),
    saleVehicle: null,
    acceptedQuoteTotal: null,
    tradeIn: null,
  };
}

const STAGE_HINTS: Readonly<Record<Stage, string>> = Object.fromEntries(
  STAGES.map((stage) => [stage.id, stage.hint]),
) as Record<Stage, string>;

const STAGE_LABELS: Readonly<Record<Stage, string>> = Object.fromEntries(
  STAGES.map((stage) => [stage.id, stage.label]),
) as Record<Stage, string>;

/**
 * El tablero: cinco columnas en el orden del flujo, con sus tarjetas y
 * conteos. Determinista para las mismas filas y el mismo `now`.
 */
export function pipelineBoard(
  source: PipelineSource,
  window: PipelineWindow,
): PipelineBoard {
  const { now } = window;
  const open = source.open
    .filter((row) => !isTerminalStage(row.stage))
    .map((row) => openCard(row, source, now));

  const columns = OPPORTUNITY_STAGES.map((stage): PipelineColumn => {
    if (stage === "won" || stage === "lost") {
      const closed = source[stage];
      const rows = closed.rows
        .filter((row) => row.stage === stage)
        .slice(0, CLOSED_COLUMN_LIMIT);
      return {
        stage,
        label: STAGE_LABELS[stage],
        hint: `Últimos ${CLOSED_WINDOW_DAYS} días`,
        cards: rows.map((row) => closedCard(row, stage, source, now)),
        total: Math.max(closed.total, rows.length),
        stale: 0,
        limit: CLOSED_COLUMN_LIMIT,
      };
    }
    const all = open
      .filter((card) => card.stage === stage)
      .toSorted(compareOpenCards);
    return {
      stage,
      label: STAGE_LABELS[stage],
      hint: STAGE_HINTS[stage],
      cards: all.slice(0, OPEN_COLUMN_LIMIT),
      total: all.length,
      stale: all.filter(isStaleCard).length,
      limit: OPEN_COLUMN_LIMIT,
    };
  });

  return {
    columns,
    summary: {
      open: open.length,
      stale: open.filter(isStaleCard).length,
      pending: open.filter((card) => card.pending.length > 0).length,
    },
    closedWindowDays: CLOSED_WINDOW_DAYS,
    generatedAt: now.toISOString(),
    generatedLabel: chatTime(now),
  };
}
