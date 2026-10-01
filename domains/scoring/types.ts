/*
 * Scoring (DEC-004, DEC-005): cuatro scores explicables. Acá viven los tipos
 * y las lecturas aprobadas. No hay fórmula: cómo se compone el Porandú Score
 * todavía no es una regla del producto y llega como dato (`ScoreComposition`).
 */

/** `null` = sin dato. No es un valor bajo y no penaliza el Porandú Score. */
export type ScoreValue = number | null;

export type SubScoreKey = "intent" | "fit" | "deal";

export type ScoreSet = {
  /** `null` = sin dato: todavía no hay señales con qué evaluarlo. */
  porandu: ScoreValue;
  /** Proporción de señales conocidas sobre las que se evaluó (0–1). */
  coverage: number;
  intent: ScoreValue;
  fit: ScoreValue;
  deal: ScoreValue;
};

/** Sin ninguna señal evaluada: todo "sin dato" y cobertura 0 (DEC-005). */
export const UNSCORED: ScoreSet = Object.freeze({
  porandu: null,
  coverage: 0,
  intent: null,
  fit: null,
  deal: null,
});

/** Nombres de los sub-scores (DEC-004). */
export const SUB_SCORE_LABELS: Record<SubScoreKey, string> = {
  intent: "Intent",
  fit: "Vehicle Fit",
  deal: "Deal Readiness",
};

/**
 * Explicación de cómo se compone un Porandú Score: peso relativo de cada
 * sub-score, en el orden en que se muestra. Es un dato que provee la fuente
 * (en B1, el mock), no una constante del dominio.
 */
export type ScoreComposition = readonly {
  key: SubScoreKey;
  /** Proporción del total (0–1). */
  weight: number;
}[];

/** Escala de Intent del Visual Blueprint §3, con copy es-PY. */
const INTENT_BANDS: readonly { min: number; label: string }[] = [
  { min: 90, label: "Ventana de compra" },
  { min: 80, label: "Alta intención" },
  { min: 65, label: "Intención calificada" },
  { min: 40, label: "Interés" },
  { min: 0, label: "Exploratorio" },
];

export function intentBand(value: ScoreValue): string {
  if (value === null) return "Sin dato";
  return (
    INTENT_BANDS.find((band) => value >= band.min)?.label ?? "Exploratorio"
  );
}

export type DriverKind =
  | "timing"
  | "budget"
  | "tradeIn"
  | "financing"
  | "vehicle"
  | "engagement"
  | "testDrive"
  | "stock";

/** Señal que explica un score ("¿Por qué ahora?"), con fuente y momento. */
export type Driver = {
  kind: DriverKind;
  label: string;
  detail: string;
  source: string;
  at: string;
  /** Peso de la señal en el score (0–100). */
  strength: number;
};
