import type { RetryableClosure } from "@/components/opportunities/closure-form";
import { stageLabel } from "@/domains/opportunities/labels";
import type { AdvanceStage } from "@/domains/opportunities/pipeline-moves";
import type { CloseOpportunityState } from "@/lib/opportunities/closure";
import type { ChangeStageState } from "@/lib/opportunities/stage-change";

/*
 * Avisos del embudo (propuesta DEC-048): qué dice el tablero después de
 * cada pase, a partir de la respuesta de la Server Action. Puros y en
 * es-PY. `refresh` pide volver a leer el tablero cuando la respuesta no
 * revalidó la página pero la etapa real puede ser otra (otra persona la
 * movió o la oportunidad ya no existe): sin eso, al terminar el estado
 * optimista la tarjeta volvería a una columna vieja.
 */

export type PipelineNoticeTone = "info" | "error";

export type PipelineNoticeContent = Readonly<{
  tone: PipelineNoticeTone;
  text: string;
}>;

export type MoveOutcome = Readonly<{
  notice: PipelineNoticeContent;
  refresh: boolean;
}>;

const NOT_FOUND: MoveOutcome = {
  notice: {
    tone: "error",
    text: "No encontramos la oportunidad. Actualizamos el tablero.",
  },
  refresh: true,
};

const UNREADABLE: MoveOutcome = {
  notice: { tone: "error", text: "No pudimos interpretar el pedido." },
  refresh: false,
};

/** Respuesta de un avance (changeOpportunityStage(), DEC-032 §5). */
export function advanceOutcome(
  name: string,
  to: AdvanceStage,
  state: ChangeStageState,
): MoveOutcome {
  switch (state?.status) {
    case "changed":
      return {
        notice: { tone: "info", text: `${name} pasó a ${stageLabel(to)}.` },
        refresh: false,
      };
    case "unchanged":
      return {
        notice: {
          tone: "info",
          text: `${name} ya estaba en ${stageLabel(state.stage)}.`,
        },
        refresh: true,
      };
    case "invalid_transition":
      return {
        notice: {
          tone: "error",
          text: `No se movió: ${name} está en ${stageLabel(state.current)} y desde ahí no se puede hacer ese pase.`,
        },
        refresh: false,
      };
    case "closure_required":
      return {
        notice: {
          tone: "error",
          text: "Para cerrarla, soltala en Ganada o Perdida: pide los datos del cierre.",
        },
        refresh: false,
      };
    case "invalid":
      return UNREADABLE;
    case "not_found":
      return NOT_FOUND;
    case "failed":
    case undefined:
      return {
        notice: {
          tone: "error",
          text: `No pudimos mover a ${name}. No se hizo ningún cambio: intentá de nuevo.`,
        },
        refresh: false,
      };
  }
}

/**
 * Respuesta de un cierre (closeOpportunity(), DEC-034 §6) que no reabre la
 * confirmación. Los que se corrigen o reintentan con el formulario
 * (`invalid`, `failed`, `vehicle_required`, `vehicle_conflict`) los muestra
 * la confirmación.
 */
export function closeOutcome(
  name: string,
  state: Exclude<CloseOpportunityState, null | RetryableClosure>,
): MoveOutcome {
  switch (state.status) {
    case "closed":
      return {
        notice: {
          tone: "info",
          text: `Oportunidad de ${name} cerrada: ${stageLabel(state.to)}.`,
        },
        refresh: false,
      };
    case "unchanged":
      return {
        notice: {
          tone: "info",
          text: `La oportunidad de ${name} ya estaba ${stageLabel(state.stage)}.`,
        },
        refresh: true,
      };
    case "invalid_transition":
      return {
        notice: {
          tone: "error",
          text: `No se cerró: la oportunidad de ${name} está en ${stageLabel(state.current)}.`,
        },
        refresh: false,
      };
    case "invalid_outcome":
      return UNREADABLE;
    case "not_found":
      return NOT_FOUND;
  }
}
