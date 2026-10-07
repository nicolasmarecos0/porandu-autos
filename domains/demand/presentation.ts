import { formatAmount, formatMoney, type Money } from "@/domains/money";

import {
  DEMAND_FACTS,
  type DemandFact,
  type DemandValues,
  type DesiredVehicle,
  type PurchaseType,
  type YearRange,
} from "./facts";
import type { DemandFormField } from "./form";
import {
  isHumanRow,
  type CurrentStatus,
  type DemandTruth,
  type FactTruth,
  type HistoryEntry,
  type UnknownReason,
} from "./resolver";

/*
 * Presentación de la demanda (H1.4, DEC-030 §10): copy es-PY y valores
 * formateados, derivados de Current Truth. Pura y apta para el navegador. No
 * decide nada: lo vigente lo decide el resolver.
 *
 * Unknown se muestra "Sin dato" (DEC-005). Los valores humanos no llevan
 * marca en la cola; el tono de advertencia queda para "Detectado" (H2a+).
 */

/** Etiqueta de cada fact, en las filas de "Busca" y del detalle. */
export const DEMAND_FACT_LABELS: Readonly<Record<DemandFact, string>> = {
  desired_vehicle: "Vehículo",
  year_range: "Año",
  budget_max: "Presupuesto",
  purchase_type: "Pago",
  trade_in_intent: "Usado",
  down_payment: "Entrega inicial",
};

/** Pregunta 1: tipo de compra. */
export const PURCHASE_TYPE_LABELS: Readonly<Record<PurchaseType, string>> = {
  cash: "Contado",
  financed: "Financiado",
  undecided: "A definir",
};

/** Estado vigente de un fact. */
export const DEMAND_STATUS_LABELS: Readonly<Record<CurrentStatus, string>> = {
  confirmed: "Confirmado",
  corrected: "Corregido",
  detected: "Detectado",
  unknown: "Sin dato",
};

export const NO_DATA = "Sin dato";
export const UNDEFINED_VEHICLE = "Vehículo sin definir";

/** "Toyota Hilux", "Hilux" o "Toyota · modelo sin definir". */
export function vehicleTitle({ brand, model }: DesiredVehicle): string {
  if (brand && model) return `${brand} ${model}`;
  if (model) return model;
  return `${brand} · modelo sin definir`;
}

/** "Desde 2022", "Hasta 2020", "2018 a 2021" o "2022". */
export function yearRangeLabel({ min, max }: YearRange): string {
  if (min !== undefined && max !== undefined) {
    return min === max ? String(min) : `${min} a ${max}`;
  }
  return min !== undefined ? `Desde ${min}` : `Hasta ${max}`;
}

/** Presupuesto: precio total máximo ("Hasta Gs. 250.000.000"). */
export function budgetLabel(budget: Money): string {
  return `Hasta ${formatMoney(budget)}`;
}

/** Entrega inicial: "Gs. 50.000.000", o 0 es "Sin entrega inicial". */
export function downPaymentLabel(downPayment: Money): string {
  return /^0+(\.0+)?$/.test(downPayment.amount)
    ? "Sin entrega inicial"
    : formatMoney(downPayment);
}

/** Valor de un fact, formateado para leer. */
export function formatDemandValue<F extends DemandFact>(
  fact: F,
  value: DemandValues[F],
): string {
  switch (fact) {
    case "desired_vehicle":
      return vehicleTitle(value as DesiredVehicle);
    case "year_range":
      return yearRangeLabel(value as YearRange);
    case "budget_max":
      return budgetLabel(value as Money);
    case "down_payment":
      return downPaymentLabel(value as Money);
    case "purchase_type":
      return PURCHASE_TYPE_LABELS[value as PurchaseType];
    case "trade_in_intent":
      return value ? "Sí" : "No";
  }
  throw new Error(`unknown demand fact: ${String(fact)}`);
}

/** Valor de un fact como lo precarga el formulario "Lo que busca". */
export function demandFormInput<F extends DemandFact>(
  fact: F,
  value: DemandValues[F],
): Readonly<Partial<Record<DemandFormField, string>>> {
  switch (fact) {
    case "desired_vehicle": {
      const { brand, model } = value as DesiredVehicle;
      return { brand: brand ?? "", model: model ?? "" };
    }
    case "year_range": {
      const { min, max } = value as YearRange;
      return {
        yearMin: min === undefined ? "" : String(min),
        yearMax: max === undefined ? "" : String(max),
      };
    }
    case "budget_max": {
      const { amount, currency } = value as Money;
      return { budgetAmount: formatAmount(amount), budgetCurrency: currency };
    }
    case "down_payment": {
      const { amount, currency } = value as Money;
      return {
        downPaymentAmount: formatAmount(amount),
        downPaymentCurrency: currency,
      };
    }
    case "purchase_type":
      return { purchaseType: value as PurchaseType };
    case "trade_in_intent":
      return { tradeIn: value ? "yes" : "no" };
  }
  throw new Error(`unknown demand fact: ${String(fact)}`);
}

/**
 * Lo que la cola (Client Component) recibe de un fact: valor formateado,
 * estado y los ids que la edición necesita (compare-and-set y Quitar). Sin
 * evidencia, historial ni ids de usuario (DEC-030 §10).
 */
export type DemandFactSummary = Readonly<{
  fact: DemandFact;
  status: CurrentStatus;
  /** Valor formateado, o null si es Sin dato. */
  display: string | null;
  /** Campos del formulario precargados con el valor vigente. */
  input: Readonly<Partial<Record<DemandFormField, string>>>;
  unknownReason: UnknownReason | null;
  /** Último acto humano del fact: lo que vio el usuario al editar. */
  headId: string | null;
  /** Fila que sustenta el valor vigente: la que reemplaza o quita. */
  currentFactId: string | null;
  /** Hay una detección pendiente de revisión (H2a+). */
  pending: boolean;
}>;

/** El vehículo de la cola y de la card "Busca". */
export type DemandVehicle = Readonly<{
  title: string;
  /**
   * `legacy`: interés libre de H1.1/H1.2, solo mientras `desired_vehicle`
   * nunca se cargó. Se muestra como "Dato anterior".
   */
  source: "demand" | "legacy";
}>;

export type DemandSummary = Readonly<{
  facts: Readonly<{ [F in DemandFact]: DemandFactSummary }>;
  /** Null: "Vehículo sin definir". */
  vehicle: DemandVehicle | null;
}>;

/** Interés legado de la oportunidad (`interest_model`, `interest_version`). */
export type LegacyInterest = Readonly<{ model?: string; version?: string }>;

function factSummary<F extends DemandFact>(
  truth: FactTruth<F>,
): DemandFactSummary {
  const value = truth.status === "unknown" ? null : truth.value;
  return {
    fact: truth.fact,
    status: truth.status,
    display: value === null ? null : formatDemandValue(truth.fact, value),
    input: value === null ? {} : demandFormInput(truth.fact, value),
    unknownReason: truth.unknownReason,
    headId: truth.headId,
    currentFactId: truth.factId,
    pending: truth.pending !== null,
  };
}

/**
 * Resumen de la demanda para la cola. El legado solo aparece mientras
 * `desired_vehicle` nunca se cargó: una vez capturado (aunque después se
 * haya quitado), nunca vuelve como vehículo.
 */
export function demandSummary(
  truth: DemandTruth,
  legacy: LegacyInterest = {},
): DemandSummary {
  const facts = Object.fromEntries(
    DEMAND_FACTS.map((fact) => [fact, factSummary(truth[fact] as FactTruth)]),
  ) as unknown as DemandSummary["facts"];
  const desired = truth.desired_vehicle;
  const legacyTitle = [legacy.model, legacy.version]
    .map((part) => part?.trim())
    .filter(Boolean)
    .join(" ");
  const vehicle: DemandVehicle | null =
    desired.status !== "unknown" && desired.value
      ? { title: vehicleTitle(desired.value), source: "demand" }
      : desired.unknownReason === "never_captured" && legacyTitle
        ? { title: legacyTitle, source: "legacy" }
        : null;
  return { facts, vehicle };
}

/*
 * Detalle de la demanda en /opportunities/[id] (DEC-030 §10, criterio U5):
 * responde "¿Por qué Porandú cree que este cliente busca esto?" para cada
 * fact, con su historial append-only. Corre en el servidor: el autor se
 * presenta como "Vos" u "Otro miembro" a partir del usuario que mira, y
 * nunca se expone otro id de usuario.
 */

/** Zona horaria de presentación: P1 opera en Paraguay. */
export const DEMAND_TIME_ZONE = "America/Asuncion";

const DATE_TIME = new Intl.DateTimeFormat("es-PY", {
  timeZone: DEMAND_TIME_ZONE,
  day: "numeric",
  month: "short",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

/** Fecha y hora de Asunción: "6 oct 2026 14:32". */
export function formatDemandDate(date: Date): string {
  const parts = Object.fromEntries(
    DATE_TIME.formatToParts(date).map((part) => [part.type, part.value]),
  );
  const month = (parts.month ?? "").replace(/\.$/, "");
  return `${parts.day} ${month} ${parts.year} ${parts.hour}:${parts.minute}`;
}

/** Autor visible: "Vos", "Otro miembro" o, sin miembro, una detección. */
export function authorLabel(
  recordedBy: string | null,
  viewerUserId: string,
): string {
  if (recordedBy === null) return "Detección automática";
  return recordedBy === viewerUserId ? "Vos" : "Otro miembro";
}

/** Etiqueta de una fila del historial (spec §10). */
function historyLabel<F extends DemandFact>(
  entry: HistoryEntry<F>,
  truth: FactTruth<F>,
  byId: ReadonlyMap<string, HistoryEntry<F>>,
): string {
  switch (entry.label) {
    case "current":
      return "Actual";
    case "superseded":
      return "Reemplazado";
    case "erroneous":
      return "Corregido";
    case "withdrawn":
      return "Quitado";
    case "discarded":
      return "Descartado";
    case "pending":
      return "Pendiente";
    case "corroboration":
      return "Coincide";
    case "covered":
      return "Anterior";
    case "rejection": {
      // El acto que quitó o descartó: si dejó el fact en Sin dato y sigue
      // siendo el último, es lo actual; si quitó un valor humano y después
      // hubo otro, quedó reemplazado.
      if (truth.status === "unknown" && truth.headId === entry.factId) {
        return "Actual";
      }
      const target = entry.targetFactId
        ? byId.get(entry.targetFactId)
        : undefined;
      return target?.sourceKind === "member" ? "Reemplazado" : "Descartado";
    }
  }
}

export type DemandHistoryItem = Readonly<{
  factId: string;
  /** Valor formateado, o "Sin dato" para un acto que quitó o descartó. */
  display: string;
  label: string;
  author: string;
  at: string;
  /** "Nota de la edición: …" o, de una detección, "Evidencia: …". */
  note: string | null;
}>;

export type DemandFactDetail = Readonly<{
  fact: DemandFact;
  label: string;
  status: CurrentStatus;
  /** Badge: Confirmado, Corregido o Detectado. Null si es Sin dato. */
  statusLabel: string | null;
  display: string | null;
  /** Por qué Porandú cree esto: autor, fecha, valor anterior, nota. */
  explanation: readonly string[];
  history: readonly DemandHistoryItem[];
}>;

export type DemandDetail = Readonly<{
  facts: readonly DemandFactDetail[];
  /** Interés libre de H1.1/H1.2, solo mientras nunca se cargó un vehículo. */
  legacy: string | null;
  /** Ningún fact se cargó todavía. */
  empty: boolean;
}>;

/** Orden del detalle: el de la card "Busca". */
const DETAIL_ORDER: readonly DemandFact[] = [
  "desired_vehicle",
  "year_range",
  "budget_max",
  "purchase_type",
  "down_payment",
  "trade_in_intent",
];

/**
 * La nota de un acto humano es "Nota de la edición"; lo que trae una
 * detección (H2a+) es "Evidencia".
 */
function noteLine(
  text: string | null,
  sourceKind: HistoryEntry["sourceKind"],
): string | null {
  if (!text) return null;
  return isHumanRow({ sourceKind })
    ? `Nota de la edición: ${text}`
    : `Evidencia: ${text}`;
}

function explain<F extends DemandFact>(
  truth: FactTruth<F>,
  viewerUserId: string,
  createdAt: Date,
): string[] {
  const lines: string[] = [];
  const note = (text: string | null) => {
    const line = noteLine(text, "member");
    if (line) lines.push(line);
  };
  switch (truth.status) {
    case "confirmed":
    case "corrected": {
      const author = authorLabel(truth.recordedBy, viewerUserId);
      const at = formatDemandDate(truth.recordedAt!);
      lines.push(
        truth.recordedAt!.getTime() === createdAt.getTime()
          ? `Cargado al crear la oportunidad por ${author} · ${at}`
          : `${DEMAND_STATUS_LABELS[truth.status]} por ${author} · ${at}`,
      );
      break;
    }
    case "detected":
      lines.push(
        `Detectado automáticamente · ${formatDemandDate(truth.recordedAt!)}`,
      );
      break;
    case "unknown":
      switch (truth.unknownReason) {
        case "never_captured":
          lines.push("Todavía no se cargó");
          break;
        case "withdrawn":
          lines.push(
            `Quitado por ${authorLabel(truth.closedBy?.recordedBy ?? null, viewerUserId)} · ${formatDemandDate(truth.closedBy!.recordedAt)}`,
          );
          note(truth.closedBy?.evidenceText ?? null);
          break;
        case "dismissed":
          lines.push(
            `Se descartó lo detectado · ${authorLabel(truth.closedBy?.recordedBy ?? null, viewerUserId)} · ${formatDemandDate(truth.closedBy!.recordedAt)}`,
          );
          note(truth.closedBy?.evidenceText ?? null);
          break;
        default:
          lines.push("No pudimos leer este dato. Avisá al administrador.");
      }
      return lines.concat(pendingLine(truth));
  }
  if (
    truth.replaced !== null &&
    truth.value !== null &&
    formatDemandValue(truth.fact, truth.replaced) !==
      formatDemandValue(truth.fact, truth.value)
  ) {
    lines.push(`Antes: ${formatDemandValue(truth.fact, truth.replaced)}`);
  }
  // La evidencia mostrada es la del ancla o, si el ancla humana no tiene
  // nota y aceptó una detección, la de esa detección.
  const anchor = truth.history.find((entry) => entry.factId === truth.factId);
  const evidence = noteLine(
    truth.evidenceText,
    anchor?.evidenceText ? anchor.sourceKind : "extractor",
  );
  if (evidence) lines.push(evidence);
  return lines.concat(pendingLine(truth));
}

/** H2a+: una detección distinta espera que un humano la revise. */
function pendingLine<F extends DemandFact>(truth: FactTruth<F>): string[] {
  return truth.pending
    ? [
        `Detectado sin revisar: ${formatDemandValue(truth.fact, truth.pending.value)}`,
      ]
    : [];
}

function factDetail<F extends DemandFact>(
  truth: FactTruth<F>,
  viewerUserId: string,
  createdAt: Date,
): DemandFactDetail {
  const byId = new Map(truth.history.map((entry) => [entry.factId, entry]));
  const value = truth.status === "unknown" ? null : truth.value;
  return {
    fact: truth.fact,
    label: DEMAND_FACT_LABELS[truth.fact],
    status: truth.status,
    statusLabel:
      truth.status === "unknown" ? null : DEMAND_STATUS_LABELS[truth.status],
    display: value === null ? null : formatDemandValue(truth.fact, value),
    explanation: explain(truth, viewerUserId, createdAt),
    history: truth.history.map((entry) => ({
      factId: entry.factId,
      display:
        entry.value === null
          ? NO_DATA
          : formatDemandValue(truth.fact, entry.value),
      label: historyLabel(entry, truth, byId),
      author: authorLabel(entry.recordedBy, viewerUserId),
      at: formatDemandDate(entry.recordedAt),
      note: noteLine(entry.evidenceText, entry.sourceKind),
    })),
  };
}

/**
 * Detalle de la demanda para el usuario que mira (`viewerUserId`).
 * `createdAt` es el alta de la oportunidad: lo cargado en esa misma
 * transacción se explica como "Cargado al crear la oportunidad".
 */
export function demandDetail(
  truth: DemandTruth,
  {
    viewerUserId,
    createdAt,
    legacy = {},
  }: Readonly<{
    viewerUserId: string;
    createdAt: Date;
    legacy?: LegacyInterest;
  }>,
): DemandDetail {
  const facts = DETAIL_ORDER.map((fact) =>
    factDetail(truth[fact] as FactTruth, viewerUserId, createdAt),
  );
  const legacyText = [legacy.model, legacy.version]
    .map((part) => part?.trim())
    .filter(Boolean)
    .join(" ");
  return {
    facts,
    legacy:
      truth.desired_vehicle.unknownReason === "never_captured" && legacyText
        ? legacyText
        : null,
    empty: DEMAND_FACTS.every(
      (fact) => truth[fact].unknownReason === "never_captured",
    ),
  };
}
