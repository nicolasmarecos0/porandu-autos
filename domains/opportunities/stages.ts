/*
 * Etapas comerciales de una oportunidad y su máquina de estados (H1.6,
 * DEC-032). Es el ciclo de la venta: de la consulta al cierre. No es el
 * Lifecycle de posventa, que sigue fuera de alcance (DEC-029).
 *
 *   new ──► qualifying ──► negotiating ──► won
 *    │          │               │
 *    └──────────┴───────────────┴────────► lost (con motivo)
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
 * Motivo de pérdida estructurado. Es obligatorio al pasar a `lost` (DEC-032
 * §3) y no existe en ninguna otra etapa. `other` es la salida cuando
 * ninguno aplica; no hay texto libre.
 */
export const LOSS_REASONS = [
  "price",
  "vehicle_not_available",
  "bought_elsewhere",
  "no_response",
  "unqualified",
  "other",
] as const;

export type LossReason = (typeof LOSS_REASONS)[number];

export function isLossReason(value: unknown): value is LossReason {
  return (
    typeof value === "string" &&
    (LOSS_REASONS as readonly string[]).includes(value)
  );
}

/**
 * Campos que el servidor lee del pedido: la oportunidad, la etapa de
 * destino y, para `lost`, el motivo. Organización, usuario, etapa de origen
 * y reloj nunca salen del cliente.
 */
export const STAGE_CHANGE_FIELDS = {
  opportunityId: "opportunityId",
  stage: "stage",
  lossReason: "lossReason",
} as const;

/** Lo que se pide: la etapa de destino y, si es `lost`, su motivo. */
export type StageChangeRequest = Readonly<{
  to: Stage;
  lossReason: LossReason | null;
}>;

/** Qué hacer con un pedido, dada la etapa actual de la oportunidad. */
export type StageChangePlan =
  /** Escribir: `lossReason` solo viaja con `lost`. */
  | Readonly<{
      kind: "change";
      from: Stage;
      to: Stage;
      lossReason: LossReason | null;
    }>
  /** Ya está en la etapa pedida (p. ej. otra persona la movió antes). */
  | Readonly<{ kind: "unchanged"; stage: Stage }>
  /** El par no existe en la máquina (incluye salir de una etapa terminal). */
  | Readonly<{ kind: "invalid_transition"; from: Stage; to: Stage }>
  /** Pasar a `lost` exige un motivo. */
  | Readonly<{ kind: "loss_reason_required"; from: Stage }>;

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
  if (to === "lost") {
    if (request.lossReason === null) {
      return { kind: "loss_reason_required", from };
    }
    return { kind: "change", from, to, lossReason: request.lossReason };
  }
  return { kind: "change", from, to, lossReason: null };
}
