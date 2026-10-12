/*
 * Scoring (DEC-004, DEC-005, DEC-035): cuatro scores explicables. Acá viven
 * los tipos y las lecturas aprobadas. La fórmula v0 del Porandú Score, la
 * recencia y la Next Best Action las calcula el motor puro de `./engine`.
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
 * sub-score, en el orden en que se muestra. La fuente la entrega junto con
 * los scores (desde DEC-035, la del motor v0) para que el anillo y el
 * desglose dibujen la misma fórmula con que se calculó.
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

/*
 * Motor de inteligencia v0 (DEC-035). Estado derivado: se calcula en cada
 * lectura y nunca se persiste.
 */

/**
 * Recencia comercial de una oportunidad, desde `last_activity_at`:
 * `active` (menos de 2 días), `warning` (de 2 a 5 días) y `stale` (más de
 * 5 días). No reemplaza las bandas en minutos de B1 (🔥 🟢 🟡 ❄️), que miden
 * la conversación en vivo.
 */
export type RecencyState = "active" | "warning" | "stale";

/** Copy de cada estado de recencia (es-PY). */
export const RECENCY_STATE_LABELS: Readonly<Record<RecencyState, string>> = {
  active: "Activa",
  warning: "Enfriándose",
  stale: "Inactiva",
};

/** Tiempo transcurrido desde la última actividad y su estado. */
export type Recency = Readonly<{
  state: RecencyState;
  /** Minutos enteros (nunca negativo: un reloj adelantado cuenta como 0). */
  minutes: number;
  /** Horas enteras. */
  hours: number;
  /** Días enteros. */
  days: number;
}>;

/**
 * Lo que Match v0 (DEC-031) dice de la demanda frente al stock disponible.
 * Distingue "no coincide" (`no_match`) de "sin dato" (`no_demand`,
 * `no_stock`), como exige DEC-005.
 */
export type StockFit =
  | Readonly<{
      kind: "match";
      /** Puntaje del Top Match (40–100). */ score: number;
    }>
  | Readonly<{ kind: "no_match" }>
  | Readonly<{ kind: "no_demand" }>
  | Readonly<{ kind: "no_stock" }>;

/** Puntos que se le restan al Porandú Score, con su motivo legible. */
export type ScorePenalty = Readonly<{
  /** Qué la causa. En v0, solo la inactividad. */
  kind: "inactivity";
  label: string;
  /** Delta con signo: siempre negativo. */
  points: number;
}>;

/** Por qué el Porandú Score vale lo que vale. */
export type ScoreExplanation = Readonly<{
  /** Motivo de cada sub-score, o por qué es sin dato. */
  factors: Readonly<Record<SubScoreKey, string>>;
  /** Penalizaciones aplicadas (hoy, solo la inactividad). */
  penalties: readonly ScorePenalty[];
  /**
   * Con una etapa terminal, el score es su resultado (Ganada 100, Perdida
   * 0) y esta nota lo dice. `null` en una oportunidad abierta.
   */
  outcome: string | null;
}>;

/** Regla que eligió la Next Best Action (DEC-035 §5), en orden de prioridad. */
export type NbaCode =
  | "recover_stale"
  | "link_vehicle"
  | "log_contact_update"
  | "follow_up"
  | "on_track";
