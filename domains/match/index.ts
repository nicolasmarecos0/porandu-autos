/*
 * Match v0 (H1.5, DEC-031): API pública del dominio. Los evaluadores por
 * dimensión quedan en ./evaluators; el resto del producto usa el motor.
 */

export { evaluateMatch, findMatchesForDemand, MATCH_THRESHOLD } from "./engine";
export { MATCH_POINTS } from "./evaluators";
export {
  MATCH_REASONS,
  type MatchableVehicle,
  type MatchDimension,
  type MatchReason,
  type MatchResult,
  type MatchScore,
} from "./types";
