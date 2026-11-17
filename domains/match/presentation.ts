import type { DemandSnapshot } from "@/domains/demand/snapshot";
import { formatMoney, moneyDifference, type Money } from "@/domains/money";
import { bodyTypeOf } from "@/domains/vehicles/body-type";
import {
  formatKm,
  formatPrice,
  vehicleDetail,
  vehicleName,
} from "@/domains/vehicles/stock";
import type { BodyType } from "@/domains/vehicles/types";

import type {
  MatchableVehicle,
  MatchReason,
  MatchResult,
  MatchScore,
} from "./types";

/*
 * Matches en el Opportunity Workspace (H1.5, DEC-031 §5): lo que el Vehicle
 * Rail de /opportunities/[id] muestra a partir de los resultados del motor.
 * Pura: no carga datos ni conoce la base, React o Next.
 *
 * Sin demanda evaluable, sin unidades disponibles o sin matches que lleguen
 * al umbral, el rail dice cuál de los tres casos es ("sin dato" honesto) y
 * nunca completa con un vehículo inventado.
 */

/** Unidad candidata: lo que Match evalúa más lo que el rail muestra. */
export type MatchCandidate = MatchableVehicle &
  Readonly<{ version?: string; km?: number }>;

/**
 * Precio de la unidad contra el presupuesto del cliente, en la misma moneda
 * (DEC-058): `under` está debajo, `over` lo excede y `equal` es igual.
 * `amount` es la diferencia absoluta, formateada ("USD 8.100").
 */
export type BudgetDelta = Readonly<{
  kind: "under" | "equal" | "over";
  amount: string;
}>;

/**
 * Lo que queda por pagar después de la entrega inicial declarada, en la
 * misma moneda que el precio (DEC-058). Es una resta: no hay tasa, plazo ni
 * cuota (DEC-003). Con un usado en parte de pago, el saldo es antes de su
 * valor de toma.
 */
export type MatchBalance = Readonly<{
  /** "Saldo", o "Saldo sin usado" si entrega uno: no descuenta su toma. */
  label: string;
  /** La entrega inicial declarada ("USD 20.000"). */
  downPayment: string;
  /** Precio menos la entrega inicial ("USD 29.900"). */
  amount: string;
}>;

/** Tarjeta de un match: identidad de la unidad, puntaje y razones. */
export type MatchCard = Readonly<{
  vehicleId: string;
  /** "Toyota Hilux". */
  name: string;
  /** Versión y año: "SRV 2.8 4x4 AT · 2025". */
  detail: string;
  /** "USD 49.900", o null si la unidad no tiene precio. */
  price: string | null;
  /** "0 km", o null sin dato. */
  km: string | null;
  score: MatchScore;
  reasons: readonly MatchReason[];
  /** 0 km (`new`) o usada (`used`), del kilometraje; null sin dato. */
  condition: "new" | "used" | null;
  /**
   * Carrocería para la representación genérica, por el modelo (DEC-058);
   * null si el modelo no está en la tabla.
   */
  body: BodyType | null;
  /** Contra el presupuesto del cliente; null sin presupuesto comparable. */
  budgetDelta: BudgetDelta | null;
  /** Saldo después de la entrega inicial; null sin entrega comparable. */
  balance: MatchBalance | null;
}>;

/**
 * Por qué no hay matches para mostrar:
 * - `no_demand`: la demanda no tiene vehículo, años ni presupuesto;
 * - `no_stock`: la organización no tiene unidades disponibles;
 * - `no_match`: ninguna unidad disponible llega al umbral.
 */
export type MatchRailEmptyReason = "no_demand" | "no_stock" | "no_match";

export type MatchRail =
  | Readonly<{
      kind: "matches";
      top: MatchCard;
      /** El segundo mejor match, si existe. */
      alternative: MatchCard | null;
    }>
  | Readonly<{ kind: "empty"; reason: MatchRailEmptyReason }>;

/** ¿La demanda tiene algún fact que Match v0 evalúa? */
export function hasMatchableDemand(demand: DemandSnapshot): boolean {
  return (
    demand.desired_vehicle.value !== null ||
    demand.year_range.value !== null ||
    demand.budget_max.value !== null
  );
}

/** Precio contra presupuesto, o null sin los dos en la misma moneda. */
export function budgetDelta(
  price: Money | null,
  budget: Money | null,
): BudgetDelta | null {
  if (price === null || budget === null) return null;
  const difference = moneyDifference(budget, price);
  if (difference === null) return null;
  return {
    kind:
      difference.sign > 0 ? "under" : difference.sign < 0 ? "over" : "equal",
    amount: formatMoney(difference.amount),
  };
}

/**
 * Saldo después de la entrega inicial declarada, o null si falta alguno de
 * los dos, si las monedas difieren, si no hay entrega o si la entrega cubre
 * el precio.
 */
export function matchBalance(
  price: Money | null,
  demand: DemandSnapshot,
): MatchBalance | null {
  const downPayment = demand.down_payment.value;
  if (price === null || downPayment === null) return null;
  if (/^0+(\.0+)?$/.test(downPayment.amount)) return null;
  const rest = moneyDifference(price, downPayment);
  if (rest === null || rest.sign <= 0) return null;
  return {
    label: demand.trade_in_intent.value === true ? "Saldo sin usado" : "Saldo",
    downPayment: formatMoney(downPayment),
    amount: formatMoney(rest.amount),
  };
}

function card(
  result: MatchResult,
  candidates: ReadonlyMap<string, MatchCandidate>,
  demand: DemandSnapshot,
): MatchCard {
  const vehicle = candidates.get(result.vehicleId);
  if (!vehicle) throw new Error("match: result for an unknown vehicle");
  return {
    vehicleId: vehicle.id,
    name: vehicleName(vehicle),
    detail: vehicleDetail(vehicle),
    price: vehicle.price ? formatPrice(vehicle.price) : null,
    km: vehicle.km === undefined ? null : formatKm(vehicle.km),
    score: result.score,
    reasons: result.reasons,
    condition:
      vehicle.km === undefined ? null : vehicle.km === 0 ? "new" : "used",
    body: bodyTypeOf(vehicle),
    budgetDelta: budgetDelta(vehicle.price, demand.budget_max.value),
    balance: matchBalance(vehicle.price, demand),
  };
}

/**
 * Rail de matches de una oportunidad: el Top Match y la alternativa (los dos
 * primeros de `matches`, ya ordenados por el motor) o el motivo de su
 * ausencia.
 */
export function matchRail(
  demand: DemandSnapshot,
  candidates: readonly MatchCandidate[],
  matches: readonly MatchResult[],
): MatchRail {
  if (!hasMatchableDemand(demand)) {
    return { kind: "empty", reason: "no_demand" };
  }
  if (candidates.length === 0) return { kind: "empty", reason: "no_stock" };
  const [top, alternative] = matches;
  if (!top) return { kind: "empty", reason: "no_match" };
  const byId = new Map(candidates.map((vehicle) => [vehicle.id, vehicle]));
  return {
    kind: "matches",
    top: card(top, byId, demand),
    alternative: alternative ? card(alternative, byId, demand) : null,
  };
}
