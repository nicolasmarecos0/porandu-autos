import Link from "next/link";
import { PageHeader } from "@/components/shell/page-header";
import { ChevronLeftIcon } from "@/components/ui/icons";
import type { QuoteDocument } from "@/domains/quotes/document";
import type { QuoteCardView } from "@/domains/quotes/presentation";
import { opportunityPath } from "@/lib/quotes/paths";

import { QuoteDocumentNav } from "./quote-document-nav";
import { QuoteDocumentSheet } from "./quote-document-sheet";
import { QuoteDocumentToolbar } from "./quote-document-toolbar";

/*
 * Presupuesto de una cotización: /opportunities/[id]/quotes/[quoteId]
 * (Hito 14, DEC-046 §6). Maestro/detalle por URL, como la bandeja
 * (DEC-044 §5):
 *
 *   desde lg ┌ Cotizaciones ───┐ ┌ N.º 0007 · USD 46.157,50 [Aprobada] ──┐
 *            │▌N.º 0007 Aprob. │ │ [⤓ Descargar PDF] [Marcar enviada] [⋯]│
 *            │ N.º 0005 Anul.  │ ├───────────────────────────────────────┤
 *            │                 │ │ ▀▀▀▀▀▀▀▀ hoja A4 del presupuesto ▀▀▀▀ │
 *            └─────────────────┘ └───────────────────────────────────────┘
 *
 *   debajo   ┌ ‹ Presupuesto N.º 0007 ───────────────┐
 *   de lg    │ barra fija: estado y [⤓ Descargar PDF] │
 *            │ hoja a lo ancho                        │
 *            └────────────────────────────────────────┘
 *
 * Debajo de `lg` se ve solo el detalle: el maestro es el panel
 * "Cotizaciones" de /opportunities/[id], al que vuelve "‹" (y el botón
 * atrás del teléfono, porque es otra URL). Lo decide el servidor, sin
 * JavaScript. La hoja es un Server Component; solo la barra (acciones y
 * descarga) es de cliente.
 */

const backLinkClassName =
  "inline-flex h-8 shrink-0 items-center justify-center gap-1 rounded-md border border-border-default bg-surface-1 px-2 text-label font-semibold text-text-primary transition-[background-color,border-color] duration-150 ease-out-strong hover:border-border-strong hover:bg-surface-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring sm:px-3";

/** Lo que arma el loader de la página (getQuoteDocumentPage()). */
type QuoteDocumentViewProps = Readonly<{
  opportunityId: string;
  contactName: string;
  /** La cotización, con su estado y las acciones que el que mira puede pedir. */
  quote: QuoteCardView;
  /** Las cotizaciones de la oportunidad: el maestro. */
  quotes: readonly QuoteCardView[];
  /** El presupuesto, armado igual que el PDF. */
  document: QuoteDocument;
}>;

export function QuoteDocumentView({
  opportunityId,
  contactName,
  quote,
  quotes,
  document,
}: QuoteDocumentViewProps) {
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PageHeader
        title={document.title}
        actions={
          <Link
            href={opportunityPath(opportunityId)}
            className={backLinkClassName}
          >
            <ChevronLeftIcon aria-hidden="true" className="size-4 sm:hidden" />
            <span className="sr-only sm:not-sr-only">
              Volver a la oportunidad
            </span>
          </Link>
        }
      />
      <div className="flex min-h-0 flex-1 gap-section overflow-hidden p-2 sm:p-gutter">
        <QuoteDocumentNav
          opportunityId={opportunityId}
          contactName={contactName}
          quotes={quotes}
          currentId={quote.id}
          className="hidden lg:flex lg:w-context-rail lg:shrink-0"
        />
        <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-section overflow-y-auto">
          <QuoteDocumentToolbar quote={quote} contactName={contactName} />
          <QuoteDocumentSheet
            document={document}
            exportability={quote.exportability}
            className="mb-2"
          />
        </div>
      </div>
    </div>
  );
}
