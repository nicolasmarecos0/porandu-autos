import { calendarHref } from "@/components/calendar/links";
import type { PipelineTarget } from "@/domains/opportunities/pipeline";
import { opportunityPath, quoteDocumentPath } from "@/lib/quotes/paths";

/*
 * Rutas de las acciones pendientes de una tarjeta del embudo (propuesta
 * DEC-048). El dominio dice a qué apunta cada una; acá se arma el enlace con
 * los mismos helpers de cada módulo, para que una ruta cambie en un solo
 * lugar (como el Cockpit, DEC-047 §7).
 */

export function pipelineTargetHref(target: PipelineTarget): string {
  switch (target.kind) {
    case "opportunity":
      return opportunityPath(target.opportunityId);
    case "quote":
      return quoteDocumentPath(target.opportunityId, target.quoteId);
    case "calendar_day":
      return calendarHref(target.day);
  }
}

/** Id del DOM de una columna: la tira de etapas la lleva a la vista. */
export function pipelineColumnId(stage: string): string {
  return `pipeline-column-${stage}`;
}
