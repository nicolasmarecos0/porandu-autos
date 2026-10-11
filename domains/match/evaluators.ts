import type { DesiredVehicle, YearRange } from "@/domains/demand/facts";
import { MAX_AMOUNT_INTEGER_DIGITS, type Money } from "@/domains/money";

import {
  MATCH_REASONS,
  type DimensionEvaluation,
  type MatchableVehicle,
  type VehicleEvaluation,
} from "./types";

/*
 * Evaluación por dimensión de Match v0 (DEC-031): funciones puras y
 * deterministas. Cada una recibe el valor vigente del fact (o null si es
 * Unknown) y el dato de la unidad, y devuelve su estado, puntos y razón.
 *
 * Un dato faltante no penaliza (DEC-005): suma 0 y no descalifica. La única
 * descalificación por dimensión es una marca distinta.
 */

/** Puntos de cada criterio. El máximo posible es 45 + 25 + 30 = 100. */
export const MATCH_POINTS = {
  brandAndModel: 45,
  brand: 35,
  yearInRange: 25,
  priceWithinBudget: 30,
  priceNearBudget: 10,
} as const;

const UNKNOWN: DimensionEvaluation = {
  status: "unknown",
  points: 0,
  reason: null,
};

const MISMATCH: DimensionEvaluation = {
  status: "mismatch",
  points: 0,
  reason: null,
};

/** Normalización de Match para marca y modelo: sin bordes ni mayúsculas. */
export function normalizeName(text: string): string {
  return text.trim().toLowerCase();
}

/**
 * Vehículo buscado:
 * - marca y modelo definidos: coinciden los dos → 45; misma marca y otro
 *   modelo → 0, sin descalificar;
 * - solo marca: coincide → 35;
 * - marca distinta → descalifica;
 * - Unknown → 0, sin descalificar.
 *
 * Solo modelo, sin marca: DEC-031 no le asigna puntaje. No se inventa uno:
 * queda como sin dato (0, sin descalificar).
 */
export function evaluateDesiredVehicle(
  desired: DesiredVehicle | null,
  vehicle: Pick<MatchableVehicle, "brand" | "model">,
): VehicleEvaluation {
  if (desired?.brand === undefined) return UNKNOWN;
  if (normalizeName(desired.brand) !== normalizeName(vehicle.brand)) {
    return { status: "disqualified" };
  }
  if (desired.model === undefined) {
    return {
      status: "match",
      points: MATCH_POINTS.brand,
      reason: MATCH_REASONS.brand,
    };
  }
  return normalizeName(desired.model) === normalizeName(vehicle.model)
    ? {
        status: "match",
        points: MATCH_POINTS.brandAndModel,
        reason: MATCH_REASONS.brandAndModel,
      }
    : MISMATCH;
}

/**
 * Año: dentro de [min, max], con los extremos incluidos y el ausente
 * abierto → 25. Fuera del rango → 0, sin descalificar.
 */
export function evaluateYearRange(
  range: YearRange | null,
  year: number,
): DimensionEvaluation {
  if (range === null || (range.min === undefined && range.max === undefined)) {
    return UNKNOWN;
  }
  const aboveMin = range.min === undefined || year >= range.min;
  const belowMax = range.max === undefined || year <= range.max;
  return aboveMin && belowMax
    ? {
        status: "match",
        points: MATCH_POINTS.yearInRange,
        reason: MATCH_REASONS.yearInRange,
      }
    : MISMATCH;
}

const DECIMAL = /^(\d+)(?:\.(\d{1,2}))?$/;

/**
 * Monto exacto en centavos, sin pasar por float. `numeric(14, 2)` deja 12
 * dígitos enteros: el resultado (y diez veces él) es un entero exacto en un
 * `number`. Un monto mal formado es un dato corrupto y falla cerrado; el
 * mensaje no incluye el valor (DEC-030 §6).
 */
function toCents(amount: string): number {
  const match = DECIMAL.exec(amount);
  const integer = match?.[1]?.replace(/^0+(?=\d)/, "");
  if (!match || !integer || integer.length > MAX_AMOUNT_INTEGER_DIGITS) {
    throw new Error("invalid money amount");
  }
  return Number(integer) * 100 + Number((match[2] ?? "").padEnd(2, "0"));
}

/**
 * Presupuesto (`budget_max`) contra el precio publicado, en la misma moneda:
 * - precio ≤ presupuesto → 30;
 * - excede en menos del 10 % → 10 ("cercano");
 * - excede en el 10 % o más → 0, sin descalificar.
 *
 * Monedas distintas: no hay conversión (DEC-025 §5, DEC-030 §7). Es sin
 * dato: 0, sin descalificar y sin razón de precio. Lo mismo si falta el
 * presupuesto o el precio.
 */
export function evaluateBudget(
  budget: Money | null,
  price: Money | null,
): DimensionEvaluation {
  if (budget === null || price === null) return UNKNOWN;
  if (budget.currency !== price.currency) return UNKNOWN;
  const max = toCents(budget.amount);
  const asked = toCents(price.amount);
  if (asked <= max) {
    return {
      status: "match",
      points: MATCH_POINTS.priceWithinBudget,
      reason: MATCH_REASONS.priceWithinBudget,
    };
  }
  // Exceso menor al 10 % del presupuesto, en enteros: exceso · 10 < presupuesto.
  return (asked - max) * 10 < max
    ? {
        status: "partial",
        points: MATCH_POINTS.priceNearBudget,
        reason: MATCH_REASONS.priceNearBudget,
      }
    : MISMATCH;
}
