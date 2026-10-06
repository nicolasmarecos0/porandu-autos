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
import type {
  CurrentStatus,
  DemandTruth,
  FactTruth,
  UnknownReason,
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
