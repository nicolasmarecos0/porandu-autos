import type { Money } from "@/domains/money";
import type { VehicleStatus } from "@/domains/vehicles/stock";

/*
 * Match v0 (H1.5, DEC-029 §7, DEC-031): tipos del motor determinista,
 * síncrono y explicable que cruza la demanda de una oportunidad
 * (`DemandSnapshot`, domains/demand) con las unidades del stock. Módulo puro:
 * no carga datos ni conoce la base, React o Next.
 */

/**
 * Lo mínimo de una unidad que Match necesita. Los nombres son los del
 * inventario (DEC-025, `StockVehicle`): `brand`, no `make`.
 */
export type MatchableVehicle = Readonly<{
  id: string;
  organizationId: string;
  /** Solo `available` participa: cualquier otro estado descalifica. */
  status: VehicleStatus;
  brand: string;
  model: string;
  /** Año modelo. Obligatorio en el inventario (DEC-025 §3). */
  year: number;
  /**
   * Precio publicado con su moneda, siempre juntos (DEC-025 §5): un precio
   * sin moneda no es representable. `null` = sin dato.
   */
  price: Money | null;
}>;

/** Dimensiones que puntúan. La disponibilidad es una condición, no suma. */
export type MatchDimension = "vehicle" | "year" | "budget";

/**
 * Resultado de una dimensión, para distinguir "sin dato" de "no coincide"
 * (DEC-005):
 * - `match`: coincide con lo que la demanda define;
 * - `partial`: coincide en parte: misma marca con otro modelo (no suma,
 *   pero se explica) o precio apenas sobre el presupuesto (puntaje
 *   reducido);
 * - `mismatch`: hay dato de los dos lados y no coincide;
 * - `unknown`: falta el dato, o no es comparable (monedas distintas,
 *   DEC-030 §7). Nunca penaliza.
 */
export type DimensionStatus = "match" | "partial" | "mismatch" | "unknown";

/** Copy de cada razón (es-PY), para el asesor comercial. */
export const MATCH_REASONS = {
  brandAndModel: "Marca y modelo coinciden exactamente",
  model: "Modelo coincide con el buscado",
  brand: "Marca coincide con la buscada",
  alternativeModel: "Misma marca, modelo alternativo",
  yearInRange: "Año dentro del rango buscado",
  priceWithinBudget: "Precio dentro del presupuesto",
  priceNearBudget: "Precio cercano al presupuesto",
  available: "Unidad disponible en stock",
} as const;

/** Razón legible de un match: siempre una de MATCH_REASONS. */
export type MatchReason = (typeof MATCH_REASONS)[keyof typeof MATCH_REASONS];

export type DimensionEvaluation = Readonly<{
  status: DimensionStatus;
  points: number;
  /**
   * Cuando la dimensión explica algo: suma puntos o, con un modelo
   * alternativo de la misma marca, dice por qué no suma.
   */
  reason: MatchReason | null;
}>;

/** El vehículo buscado, además, puede descalificar (marca distinta). */
export type VehicleEvaluation =
  DimensionEvaluation | Readonly<{ status: "disqualified" }>;

/** Puntaje de un match: el total (0–100) y lo que aporta cada dimensión. */
export type MatchScore = Readonly<
  { total: number } & Record<MatchDimension, number>
>;

export type MatchResult = Readonly<{
  vehicleId: string;
  score: MatchScore;
  /** Por qué es un match, en el orden vehículo, año, precio, stock. */
  reasons: readonly MatchReason[];
}>;
