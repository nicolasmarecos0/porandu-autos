import type { DemandSnapshot } from "@/domains/demand/snapshot";
import {
  formatKm,
  formatPrice,
  vehicleDetail,
  vehicleName,
} from "@/domains/vehicles/stock";

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

function card(
  result: MatchResult,
  candidates: ReadonlyMap<string, MatchCandidate>,
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
    top: card(top, byId),
    alternative: alternative ? card(alternative, byId) : null,
  };
}
