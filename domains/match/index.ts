/*
 * Match v0 (H1.5, DEC-031): API pública del dominio. Los evaluadores por
 * dimensión quedan en ./evaluators; el resto del producto usa el motor y la
 * presentación del rail.
 */

export { evaluateMatch, findMatchesForDemand, MATCH_THRESHOLD } from "./engine";
export { MATCH_POINTS } from "./evaluators";
export {
  hasMatchableDemand,
  matchRail,
  type MatchCandidate,
  type MatchCard,
  type MatchRail,
  type MatchRailEmptyReason,
} from "./presentation";
export {
  MATCH_REASONS,
  type MatchableVehicle,
  type MatchDimension,
  type MatchReason,
  type MatchResult,
  type MatchScore,
} from "./types";
