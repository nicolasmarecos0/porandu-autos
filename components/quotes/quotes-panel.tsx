import { DocumentIcon } from "@/components/ui/icons";
import { Panel, PanelHeader } from "@/components/ui/panel";
import type { QuotesPanelData } from "@/domains/quotes/presentation";

import { NewQuoteDrawer } from "./new-quote-drawer";
import { QuoteCard } from "./quote-card";

/*
 * Panel "Cotizaciones" en /opportunities/[id] (Hito 10, DEC-042 §9).
 *
 *   ┌ Cotizaciones ─────────────────────── 2 cotizaciones [+ Nueva] ┐
 *   │ ┃ N.º 0008 [● Borrador]                  [Aprobar cotización]⋯ │
 *   │ ┃ Toyota Hilux 2024 · lista, descuento y total · validez        │
 *   │ ┃ N.º 0005 [✕ Anulada]                                          │
 *   └────────────────────────────────────────────────────────────────┘
 *
 * Server Component: la lista llega armada del servidor
 * (quotesPanelData()), con los autores como "Vos" u "Otro miembro" y las
 * acciones que el que mira puede pedir hoy. Solo las tarjetas (acciones y
 * confirmaciones) y el drawer de alta son de cliente. Fuera de
 * `qualifying` y `negotiating` no se crean cotizaciones: el panel dice
 * por qué.
 */

function countLabel(count: number): string {
  return count === 1 ? "1 cotización" : `${count} cotizaciones`;
}

export function QuotesPanel({
  opportunityId,
  data,
}: {
  opportunityId: string;
  data: QuotesPanelData;
}) {
  const { quotes, canCreate, createHint } = data;
  return (
    <section aria-labelledby="quotes-heading" className="max-w-3xl">
      <Panel>
        <PanelHeader>
          <h2 id="quotes-heading" className="text-heading text-text-primary">
            Cotizaciones
          </h2>
          <span className="ml-auto hidden text-caption text-text-muted sm:inline">
            {countLabel(quotes.length)}
          </span>
          {canCreate ? (
            <span className="ml-auto sm:ml-0">
              <NewQuoteDrawer
                opportunityId={opportunityId}
                vehicleOptions={data.vehicleOptions}
                suggestedVehicleId={data.suggestedVehicleId}
                today={data.today}
              />
            </span>
          ) : null}
        </PanelHeader>
        <div className="flex flex-col gap-3 px-3 py-3.5 sm:px-4">
          {createHint ? (
            <p className="rounded-md border border-border-subtle bg-surface-2 px-3 py-2 text-label text-text-secondary">
              {createHint}
            </p>
          ) : null}
          {quotes.length === 0 ? (
            <div className="flex flex-col items-center gap-2 rounded-md border border-dashed border-border-default px-4 py-8 text-center">
              <DocumentIcon
                aria-hidden="true"
                className="size-6 text-text-muted"
              />
              <p className="text-body font-semibold text-text-primary">
                Todavía no hay cotizaciones
              </p>
              <p className="max-w-sm text-label text-text-secondary">
                {canCreate
                  ? "Después del test drive, armá un presupuesto formal con la unidad, el descuento y la validez."
                  : "Cuando la oportunidad admita cotizar, las vas a ver acá."}
              </p>
            </div>
          ) : (
            <ol
              aria-label="Cotizaciones de la oportunidad"
              className="flex flex-col gap-3"
            >
              {quotes.map((quote) => (
                <li key={quote.id}>
                  <QuoteCard quote={quote} opportunityId={opportunityId} />
                </li>
              ))}
            </ol>
          )}
        </div>
      </Panel>
    </section>
  );
}
