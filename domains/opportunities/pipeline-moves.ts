import type { LossReason } from "./closure";
import { LOSS_REASON_LABELS, STAGE_ACTION_LABELS, stageLabel } from "./labels";
import type {
  CardClosure,
  PipelineCard,
  PipelineColumn,
  PipelineTarget,
} from "./pipeline";
import {
  canTransition,
  isTerminalStage,
  nextStages,
  OPPORTUNITY_STAGES,
  type Stage,
} from "./stages";

/*
 * Reglas de movimiento del tablero de oportunidades (embudo de ventas,
 * propuesta DEC-048). Módulo puro, liviano y apto para el navegador: es lo
 * único del dominio del tablero que viaja al cliente (el armado del tablero,
 * con el motor de inteligencia, corre en el servidor: ./pipeline.ts).
 *
 * El tablero no inventa reglas: mover una tarjeta es pedir un pase de la
 * máquina de estados de DEC-032 (./stages.ts), que la base vuelve a exigir
 * con su trigger.
 *
 *   Nueva ──► En calificación ──► En negociación ──► Ganada
 *     │             │                   │
 *     └─────────────┴───────────────────┴──────────► Perdida
 *
 * - Avanzar (`new → qualifying`, `qualifying → negotiating`) es soltar la
 *   tarjeta: un solo gesto, como el click de DEC-032 §8. Va por
 *   changeOpportunityStage().
 * - Cerrar (`→ won`, `→ lost`) nunca ocurre al soltar: abre la confirmación
 *   con los datos del cierre (DEC-034) y va por closeOpportunity().
 * - Sin saltos, sin vuelta atrás y sin salida de una etapa terminal: soltar
 *   ahí no pide nada y explica por qué.
 *
 * `moveCard()` es el reductor del estado optimista: mueve la tarjeta en
 * memoria mientras la Server Action guarda. La respuesta del servidor (la
 * página revalidada) lo reemplaza; si el pase falla, la tarjeta vuelve sola
 * a su columna.
 */

/** Etapas que cierran: su pase pide los datos del cierre (DEC-034 §1). */
export type ClosingStage = "won" | "lost";

/** Etapas a las que se avanza sin cerrar. */
export type AdvanceStage = "qualifying" | "negotiating";

/** Qué pasa al soltar una tarjeta de `from` en la columna `to`. */
export type BoardMove =
  /** La misma columna: nada que hacer. */
  | Readonly<{ kind: "none" }>
  /** Avance: se escribe al soltar (changeOpportunityStage()). */
  | Readonly<{ kind: "advance"; from: Stage; to: AdvanceStage }>
  /** Cierre: abre la confirmación con sus datos (closeOpportunity()). */
  | Readonly<{ kind: "close"; from: Stage; to: ClosingStage }>
  /** La máquina no tiene ese pase: no se pide nada y se explica. */
  | Readonly<{
      kind: "blocked";
      from: Stage;
      to: Stage;
      reason: "terminal" | "backward" | "skip";
      message: string;
    }>;

function position(stage: Stage): number {
  return OPPORTUNITY_STAGES.indexOf(stage);
}

function isClosing(stage: Stage): stage is ClosingStage {
  return stage === "won" || stage === "lost";
}

/** Texto de la acción que lleva a `to` ("Pasar a calificación"…). */
export function moveActionLabel(to: Stage): string {
  return to === "new" ? stageLabel(to) : STAGE_ACTION_LABELS[to];
}

/**
 * Decide, sin tocar nada, qué pide soltar una tarjeta de `from` en `to`.
 * Es la matriz de DEC-032 §2 con el porqué de cada pase que no existe.
 */
export function planBoardMove(from: Stage, to: Stage): BoardMove {
  if (from === to) return { kind: "none" };
  if (canTransition(from, to)) {
    return isClosing(to)
      ? { kind: "close", from, to }
      : { kind: "advance", from, to: to as AdvanceStage };
  }
  if (isTerminalStage(from)) {
    return {
      kind: "blocked",
      from,
      to,
      reason: "terminal",
      message: `${stageLabel(from)} es una etapa final: no admite cambios.`,
    };
  }
  if (position(to) < position(from)) {
    return {
      kind: "blocked",
      from,
      to,
      reason: "backward",
      message: "Una oportunidad no vuelve a una etapa anterior.",
    };
  }
  const next = nextStages(from).find((stage) => !isTerminalStage(stage));
  return {
    kind: "blocked",
    from,
    to,
    reason: "skip",
    message: next
      ? `Sin saltos: de ${stageLabel(from)} se pasa a ${stageLabel(next)}.`
      : `Desde ${stageLabel(from)} no se puede pasar a ${stageLabel(to)}.`,
  };
}

/** Un destino del menú "Mover a…" de una tarjeta. */
export type MoveTarget = Readonly<{
  to: Stage;
  label: string;
  /** Cierra la oportunidad: abre la confirmación con sus datos. */
  closes: boolean;
}>;

/**
 * Destinos que ofrece el menú "Mover a…": exactamente los pases de la
 * máquina desde `stage`, en el orden del flujo. Una etapa terminal no
 * ofrece ninguno.
 */
export function moveTargets(stage: Stage): readonly MoveTarget[] {
  return nextStages(stage).map((to) => ({
    to,
    label: moveActionLabel(to),
    closes: isClosing(to),
  }));
}

/** Cómo se ve una columna mientras se arrastra una tarjeta. */
export type DropZone = Readonly<{
  /**
   * `source`: la columna de la tarjeta; `advance`: avanza al soltar;
   * `close`: abre la confirmación del cierre; `blocked`: no hay pase.
   */
  state: "source" | "advance" | "close" | "blocked";
  /** Lo que pasa si se suelta acá, en es-PY. */
  hint: string;
}>;

export function dropZone(from: Stage, to: Stage): DropZone {
  const move = planBoardMove(from, to);
  switch (move.kind) {
    case "none":
      return { state: "source", hint: "Etapa actual" };
    case "advance":
      return {
        state: "advance",
        hint: `Soltá para pasar a ${stageLabel(move.to)}`,
      };
    case "close":
      return {
        state: "close",
        hint:
          move.to === "won"
            ? "Soltá para marcarla ganada: pide los datos de la venta"
            : "Soltá para marcarla perdida: pide el motivo",
      };
    case "blocked":
      return { state: "blocked", hint: move.message };
  }
}

/*
 * Orden de una columna abierta: Porandú Score descendente (DEC-035 §7, como
 * la cola). Sin score (sin dato) va después; a igual score, la de actividad
 * más reciente primero, y el id desempata para que el orden sea total.
 */
export function compareOpenCards(a: PipelineCard, b: PipelineCard): number {
  const left = a.score;
  const right = b.score;
  if (left !== null && right !== null && left !== right) return right - left;
  if (left !== null && right === null) return -1;
  if (left === null && right !== null) return 1;
  const recent =
    (a.recency?.minutes ?? Number.MAX_SAFE_INTEGER) -
    (b.recency?.minutes ?? Number.MAX_SAFE_INTEGER);
  if (recent !== 0) return recent;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/** Inactiva (DEC-035 §2): la alerta de inactividad más fuerte. */
export function isStaleCard(card: PipelineCard): boolean {
  return card.recency?.state === "stale";
}

/** Rótulo del cierre: "Ganada" o "Perdida", con el motivo si lo hay. */
export function closureOf(
  stage: ClosingStage,
  lossReason: LossReason | null,
  when: string,
  at: string | null,
): CardClosure {
  return {
    label: stageLabel(stage),
    reason:
      stage === "lost" && lossReason ? LOSS_REASON_LABELS[lossReason] : null,
    when,
    at,
  };
}

/** Destino de la tarjeta: el workspace de la oportunidad. */
export function opportunityTarget(opportunityId: string): PipelineTarget {
  return { kind: "opportunity", opportunityId };
}

/** Un pase pedido y todavía sin confirmar por el servidor. */
export type OptimisticMove = Readonly<{
  opportunityId: string;
  to: Stage;
  /** Motivo elegido al perderla: la tarjeta lo muestra mientras se guarda. */
  lossReason?: LossReason;
}>;

/**
 * La tarjeta como se ve en su columna nueva mientras se guarda. Cerrada,
 * deja de mostrar score, recencia y pendientes (una cerrada no tiene NBA ni
 * penalización, DEC-035) y muestra su cierre "hoy"; ganada, la unidad que
 * se vende pasa a ser su primera línea.
 */
function movedCard(card: PipelineCard, move: OptimisticMove): PipelineCard {
  const { to } = move;
  if (!isClosing(to)) return { ...card, stage: to };
  const sold = to === "won" ? card.saleVehicle : null;
  return {
    ...card,
    stage: to,
    ...(sold
      ? { headline: sold.name, headlineSource: "unit", detail: sold.detail }
      : {}),
    score: null,
    recency: null,
    pending: [],
    closure: closureOf(to, move.lossReason ?? null, "hoy", null),
  };
}

function insertCard(
  column: PipelineColumn,
  card: PipelineCard,
): readonly PipelineCard[] {
  // Una cerrada es la más reciente de su columna: va primera.
  if (isTerminalStage(column.stage)) return [card, ...column.cards];
  const index = column.cards.findIndex(
    (other) => compareOpenCards(card, other) < 0,
  );
  return index === -1
    ? [...column.cards, card]
    : [...column.cards.slice(0, index), card, ...column.cards.slice(index)];
}

/**
 * Reductor del estado optimista: la tarjeta sale de su columna y entra en la
 * de `move.to` en su lugar (por prioridad en una abierta, primera en una
 * cerrada), con los conteos ajustados. Puro: si la tarjeta no está o ya está
 * en esa etapa (p. ej. la página se refrescó mientras tanto), devuelve las
 * columnas tal cual.
 */
export function moveCard(
  columns: readonly PipelineColumn[],
  move: OptimisticMove,
): readonly PipelineColumn[] {
  const source = columns.find((column) =>
    column.cards.some((card) => card.id === move.opportunityId),
  );
  const card = source?.cards.find((item) => item.id === move.opportunityId);
  if (!source || !card || card.stage === move.to) return columns;
  if (!columns.some((column) => column.stage === move.to)) return columns;

  const moved = movedCard(card, move);
  return columns.map((column) => {
    if (column === source) {
      return {
        ...column,
        cards: column.cards.filter((item) => item.id !== card.id),
        total: Math.max(0, column.total - 1),
        stale: Math.max(0, column.stale - (isStaleCard(card) ? 1 : 0)),
      };
    }
    if (column.stage === move.to) {
      return {
        ...column,
        cards: insertCard(column, moved),
        total: column.total + 1,
        stale: column.stale + (isStaleCard(moved) ? 1 : 0),
      };
    }
    return column;
  });
}
