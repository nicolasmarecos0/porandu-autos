import { calendarHref } from "@/components/calendar/links";
import { conversationHref } from "@/components/inbox/conversation-list";
import type { CockpitTarget } from "@/domains/cockpit/feed";
import { opportunityPath, quoteDocumentPath } from "@/lib/quotes/paths";

/*
 * Rutas de las acciones rápidas del feed (Hito 15, DEC-047 §5). El dominio
 * dice a qué apunta cada evento; acá se arma el enlace con los mismos
 * helpers que usa cada módulo, para que una ruta cambie en un solo lugar.
 */

export function cockpitTargetHref(target: CockpitTarget): string {
  switch (target.kind) {
    case "conversation":
      return conversationHref(target.conversationId);
    case "calendar_day":
      return calendarHref(target.day);
    case "quote":
      return quoteDocumentPath(target.opportunityId, target.quoteId);
    case "opportunity":
      return opportunityPath(target.opportunityId);
  }
}
