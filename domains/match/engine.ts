import type { DemandSnapshot } from "@/domains/demand/snapshot";

import {
  evaluateBudget,
  evaluateDesiredVehicle,
  evaluateYearRange,
} from "./evaluators";
import {
  MATCH_REASONS,
  type MatchableVehicle,
  type MatchReason,
  type MatchResult,
} from "./types";

/*
 * Motor de Match v0 (H1.5, DEC-029 §7, DEC-031): determinista, síncrono y
 * explicable, sin jobs ni IA. Cruza el `DemandSnapshot` de una oportunidad
 * con unidades del stock y devuelve los matches con su puntaje (0–100) y sus
 * razones.
 *
 * - Solo participan unidades `available`; cualquier otro estado descalifica.
 * - Una marca distinta descalifica.
 * - Un fact Unknown no penaliza ni descalifica (DEC-005).
 * - Un fact `detected` pesa como uno confirmado: DEC-031 no los distingue
 *   (en H1.4 la única fuente es el vendedor y no hay detecciones).
 * - No hay FX: un presupuesto y un precio en monedas distintas son sin dato.
 */

/** Puntaje mínimo de un match aprobado. */
export const MATCH_THRESHOLD = 40;

/**
 * Evalúa una unidad contra la demanda. Devuelve null si no hay match: la
 * unidad no está disponible, la marca es distinta o el puntaje no llega a
 * MATCH_THRESHOLD.
 */
export function evaluateMatch(
  demand: DemandSnapshot,
  vehicle: MatchableVehicle,
): MatchResult | null {
  if (vehicle.status !== "available") return null;

  const fit = evaluateDesiredVehicle(demand.desired_vehicle.value, vehicle);
  if (fit.status === "disqualified") return null;
  const year = evaluateYearRange(demand.year_range.value, vehicle.year);
  const budget = evaluateBudget(demand.budget_max.value, vehicle.price);

  const total = fit.points + year.points + budget.points;
  if (total < MATCH_THRESHOLD) return null;

  const reasons: MatchReason[] = [fit, year, budget]
    .map((evaluation) => evaluation.reason)
    .filter((reason) => reason !== null);
  reasons.push(MATCH_REASONS.available);

  return {
    vehicleId: vehicle.id,
    score: {
      total,
      vehicle: fit.points,
      year: year.points,
      budget: budget.points,
    },
    reasons,
  };
}

/**
 * Matches de una demanda entre las unidades de una organización, del mayor
 * puntaje al menor. Un empate conserva el orden de entrada (el del loader):
 * el resultado es determinista.
 *
 * Aislamiento: la evaluación es pura por unidad, pero el lote tiene que ser
 * coherente. Unidades de más de una organización son un error del llamador
 * (la carga va por un único `withTenant()`) y fallan cerrado.
 */
export function findMatchesForDemand(
  demand: DemandSnapshot,
  vehicles: readonly MatchableVehicle[],
): MatchResult[] {
  const organizations = new Set(vehicles.map((v) => v.organizationId));
  if (organizations.size > 1) {
    throw new Error("match: vehicles from more than one organization");
  }
  return vehicles
    .map((vehicle) => evaluateMatch(demand, vehicle))
    .filter((result) => result !== null)
    .sort((a, b) => b.score.total - a.score.total);
}
