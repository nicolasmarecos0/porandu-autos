import Link from "next/link";
import { cn } from "@/components/ui/cn";
import type { QuoteCardView } from "@/domains/quotes/presentation";
import { opportunityPath, quoteDocumentPath } from "@/lib/quotes/paths";

import { QuoteStatusChip } from "./quote-status";

/*
 * Maestro de la vista previa (Hito 14, DEC-046 §6): las cotizaciones de la
 * oportunidad, de la más reciente a la más vieja, cada una con su número,
 * estado, unidad y total. Desde `lg` queda a la izquierda del presupuesto,
 * como la lista de la bandeja (DEC-044 §5): pasar de una cotización a otra
 * es un enlace, sin JavaScript. Debajo de `lg` no se muestra: el maestro es
 * el panel "Cotizaciones" de /opportunities/[id], al que lleva "Volver".
 */

function countLabel(count: number): string {
  return count === 1 ? "1 cotización" : `${count} cotizaciones`;
}

export function QuoteDocumentNav({
  opportunityId,
  contactName,
  quotes,
  currentId,
  className,
}: {
  opportunityId: string;
  contactName: string;
  quotes: readonly QuoteCardView[];
  currentId: string;
  /** Visibilidad por breakpoint: la decide la vista. */
  className?: string;
}) {
  return (
    <nav
      aria-label={`Cotizaciones de ${contactName}`}
      className={cn(
        "min-h-0 flex-col overflow-hidden rounded-lg border border-border-subtle bg-surface-1 shadow-card",
        className,
      )}
    >
      <div className="flex h-11 shrink-0 items-center gap-3 border-b-2 border-brand px-4">
        <h2 className="text-heading text-text-primary">Cotizaciones</h2>
        <span className="ml-auto text-caption text-text-muted">
          {countLabel(quotes.length)}
        </span>
      </div>
      <ol className="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto p-2">
        {quotes.map((quote) => {
          const current = quote.id === currentId;
          return (
            <li key={quote.id}>
              <Link
                href={quoteDocumentPath(opportunityId, quote.id)}
                aria-current={current ? "page" : undefined}
                className={cn(
                  "flex flex-col gap-1 rounded-md border px-3 py-2.5 transition-colors duration-150 ease-out-strong focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-focus-ring",
                  current
                    ? "border-brand-border bg-brand-soft"
                    : "border-transparent hover:bg-surface-2",
                )}
              >
                <span className="flex items-center justify-between gap-2">
                  <span className="text-label font-semibold text-text-primary tabular-nums">
                    {quote.numberLabel}
                  </span>
                  <QuoteStatusChip status={quote.displayStatus} />
                </span>
                <span className="truncate [font-feature-settings:'calt'_0] text-caption text-text-muted">
                  {quote.vehicleLabel}
                </span>
                <span className="text-label text-text-primary tabular-nums">
                  {quote.totalLabel}
                </span>
              </Link>
            </li>
          );
        })}
      </ol>
      <div className="shrink-0 border-t border-border-subtle p-3">
        <Link
          href={opportunityPath(opportunityId)}
          className="text-label font-semibold text-brand hover:text-brand-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring"
        >
          Ver la oportunidad de {contactName}
        </Link>
      </div>
    </nav>
  );
}
