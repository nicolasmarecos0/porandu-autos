/*
 * Etapas comerciales de una oportunidad y su máquina de estados (H1.6,
 * DEC-032). Es el ciclo de la venta: de la consulta al cierre. No es el
 * Lifecycle de posventa, que sigue fuera de alcance (DEC-029).
 *
 *   new ──► qualifying ──► negotiating ──► won
 *    │          │               │
 *    └──────────┴───────────────┴────────► lost
 *
 * Los pases a `won` y `lost` cierran la oportunidad: llevan sus metadatos
 * (DEC-034) y tienen su propia puerta y su propio planner (`./closure`).
 *
 * Módulo puro y apto para el navegador: la UI lo usa para ofrecer las
 * acciones, pero la regla la imponen el servidor (planStageChange() sobre la
 * fila bloqueada) y la base (un trigger que valida el par etapa anterior →
 * etapa nueva, que espeja esta matriz). Un test cruza las dos.
 */

export const OPPORTUNITY_STAGES = [
  "new",
  "qualifying",
  "negotiating",
  "won",
  "lost",
] as const;

export type Stage = (typeof OPPORTUNITY_STAGES)[number];

/** Etapas de cierre: de ellas no se sale (ni entre sí ni hacia atrás). */
export const TERMINAL_STAGES = [
  "won",
  "lost",
] as const satisfies readonly Stage[];

/** Etapa de toda oportunidad recién creada (DEC-024 §5). */
export const INITIAL_STAGE = "new" as const satisfies Stage;

/**
 * Transiciones válidas. No hay saltos (de `new` no se pasa a `negotiating`),
 * ni vuelta atrás, ni salida de una etapa terminal.
 */
const TRANSITIONS: Readonly<Record<Stage, readonly Stage[]>> = {
  new: ["qualifying", "lost"],
  qualifying: ["negotiating", "lost"],
  negotiating: ["won", "lost"],
  won: [],
  lost: [],
};

export function isStage(value: unknown): value is Stage {
  return (
    typeof value === "string" &&
    (OPPORTUNITY_STAGES as readonly string[]).includes(value)
  );
}

export function isTerminalStage(stage: Stage): boolean {
  return (TERMINAL_STAGES as readonly Stage[]).includes(stage);
}

/** Etapas a las que se puede pasar desde `from`, en el orden del flujo. */
export function nextStages(from: Stage): readonly Stage[] {
  return TRANSITIONS[from];
}

export function canTransition(from: Stage, to: Stage): boolean {
  return TRANSITIONS[from].includes(to);
}

/** Etapas desde las que se puede llegar a `to`. */
export function sourceStagesOf(to: Stage): readonly Stage[] {
  return OPPORTUNITY_STAGES.filter((from) => canTransition(from, to));
}

/**
 * Campos que el servidor lee del pedido: la oportunidad y la etapa de
 * destino. Organización, usuario, etapa de origen y reloj nunca salen del
 * cliente. Un cierre (`won` o `lost`) no viaja por acá: tiene su propia
 * puerta, con sus metadatos (DEC-034, `./closure`).
 */
export const STAGE_CHANGE_FIELDS = {
  opportunityId: "opportunityId",
  stage: "stage",
} as const;

/** Lo que se pide: la etapa de destino. */
export type StageChangeRequest = Readonly<{ to: Stage }>;

/** Qué hacer con un pedido, dada la etapa actual de la oportunidad. */
export type StageChangePlan =
  /** Escribir el avance (nunca un cierre). */
  | Readonly<{ kind: "change"; from: Stage; to: Stage }>
  /** Ya está en la etapa pedida (p. ej. otra persona la movió antes). */
  | Readonly<{ kind: "unchanged"; stage: Stage }>
  /** El par no existe en la máquina (incluye salir de una etapa terminal). */
  | Readonly<{ kind: "invalid_transition"; from: Stage; to: Stage }>
  /**
   * El pase es válido, pero cierra la oportunidad: se hace con
   * closeOpportunity(), que escribe la etapa junto con sus metadatos
   * (DEC-034 §1).
   */
  | Readonly<{
      kind: "closure_required";
      from: Stage;
      to: (typeof TERMINAL_STAGES)[number];
    }>;

/**
 * Decide, sin tocar nada, qué pasa con un pedido de cambio de etapa. Pedir
 * la etapa actual es idempotente (`unchanged`), aun en una etapa terminal.
 */
export function planStageChange(
  from: Stage,
  request: StageChangeRequest,
): StageChangePlan {
  const { to } = request;
  if (from === to) return { kind: "unchanged", stage: from };
  if (!canTransition(from, to)) return { kind: "invalid_transition", from, to };
  if (to === "won" || to === "lost") {
    return { kind: "closure_required", from, to };
  }
  return { kind: "change", from, to };
}
