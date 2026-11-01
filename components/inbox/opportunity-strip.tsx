import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { OpportunitiesIcon } from "@/components/ui/icons";
import type { ConversationOpportunity } from "@/domains/conversations/opportunity-link";
import { formatCount } from "@/domains/dashboard/presentation";

import { OpportunityMenu } from "./opportunity-menu";

/*
 * Franja de la oportunidad bajo el encabezado del historial (Hito 12,
 * DEC-044 §4): a qué oportunidad se suma lo que el vendedor responda ahora.
 * Es la regla con la que la base asocia cada mensaje (DEC-039 §9): una sola
 * abierta del contacto, o ninguna asociación. Server Component; con varias
 * abiertas, el menú que las lista es de cliente.
 */

const stripClassName =
  "flex min-h-10 flex-wrap items-center gap-x-2 gap-y-1 border-b border-border-subtle bg-surface-2 px-4 py-2 text-caption";

export function OpportunityStrip({
  opportunity,
}: {
  opportunity: ConversationOpportunity;
}) {
  switch (opportunity.kind) {
    case "linked":
      return (
        <div data-opportunity="linked" className={stripClassName}>
          <OpportunitiesIcon
            width={16}
            height={16}
            className="shrink-0 text-text-muted"
          />
          <span className="text-text-secondary">Oportunidad abierta:</span>
          <Link
            href={opportunity.opportunity.href}
            className="rounded-xs font-semibold text-brand-strong underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring"
          >
            {opportunity.opportunity.stage}
          </Link>
          <span className="text-text-muted">
            · actividad {opportunity.opportunity.lastActivity}
          </span>
          <span className="basis-full text-text-muted sm:basis-auto">
            Los mensajes se suman a su actividad.
          </span>
        </div>
      );
    case "ambiguous":
      return (
        <div data-opportunity="ambiguous" className={stripClassName}>
          <Badge tone="warning">
            {formatCount(opportunity.total)} oportunidades abiertas
          </Badge>
          <span className="text-text-secondary">
            Los mensajes no se asocian a ninguna.
          </span>
          <OpportunityMenu
            opportunities={opportunity.opportunities}
            total={opportunity.total}
          />
        </div>
      );
    case "none":
      return (
        <div data-opportunity="none" className={stripClassName}>
          <OpportunitiesIcon
            width={16}
            height={16}
            className="shrink-0 text-text-muted"
          />
          <span className="text-text-secondary">
            Sin oportunidad abierta. Los mensajes quedan solo en la
            conversación.
          </span>
        </div>
      );
  }
}
