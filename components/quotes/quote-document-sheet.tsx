import { Fragment } from "react";
import { cn } from "@/components/ui/cn";
import { LockIcon } from "@/components/ui/icons";
import {
  QUOTE_DOCUMENT_HEADING,
  QUOTE_DOCUMENT_LABELS,
  type QuoteDocument,
  type QuoteDocumentField,
} from "@/domains/quotes/document";
import {
  QUOTE_PREVIEW_STAMPS,
  type QuoteExportability,
} from "@/domains/quotes/exportability";

/*
 * Vista previa del presupuesto (Hito 14, DEC-046 §6): la misma hoja que el
 * PDF (lib/quotes/pdf.ts), dibujada en HTML con los tokens de DEC-013. Los
 * dos leen el mismo QuoteDocument (domains/quotes/document.ts), ya
 * formateado en es-PY: muestran los mismos textos en el mismo orden, y
 * ninguno calcula montos ni fechas.
 *
 * - Desde `md` tiene la proporción de una hoja A4 y el pie va al final de
 *   la hoja; en teléfono es una hoja a lo ancho que crece con su contenido.
 * - Una cotización que no se puede entregar (borrador, vencida, anulada,
 *   rechazada o de una oportunidad cerrada) lleva el sello "Vista previa"
 *   arriba: el PDF de esas no se genera.
 * - Server Component, sin JavaScript de cliente.
 */

function PartyCard({
  id,
  title,
  name,
  fields,
}: {
  id: string;
  title: string;
  name: string;
  fields: readonly QuoteDocumentField[];
}) {
  return (
    <section
      aria-labelledby={id}
      className="flex min-w-0 flex-col gap-1.5 rounded-md border border-border-subtle bg-surface-2 p-4 [font-feature-settings:'calt'_0]"
    >
      <h3 id={id} className="text-overline text-text-muted uppercase">
        {title}
      </h3>
      <p className="text-heading break-words text-text-primary">{name}</p>
      {fields.length > 0 ? (
        <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 text-label">
          {fields.map((field) => (
            <Fragment key={field.label}>
              <dt className="font-normal text-text-muted">{field.label}</dt>
              <dd className="break-words text-text-secondary">{field.value}</dd>
            </Fragment>
          ))}
        </dl>
      ) : null}
    </section>
  );
}

export function QuoteDocumentSheet({
  document,
  exportability,
  className,
}: {
  document: QuoteDocument;
  exportability: QuoteExportability;
  className?: string;
}) {
  const labels = QUOTE_DOCUMENT_LABELS;
  return (
    <article
      aria-label={`Vista previa del ${document.title.toLowerCase()}`}
      className={cn(
        "mx-auto flex w-full max-w-208 flex-col overflow-hidden rounded-md border border-border-subtle bg-surface-1 shadow-md md:aspect-[210/297]",
        className,
      )}
    >
      <div aria-hidden="true" className="h-1.5 shrink-0 bg-brand" />
      {exportability.exportable ? null : (
        <p className="flex items-center gap-2 border-b border-warning-border bg-warning-soft px-5 py-2 text-label text-warning sm:px-8 md:px-12">
          <LockIcon aria-hidden="true" className="size-3.5 shrink-0" />
          <span>
            Vista previa · {QUOTE_PREVIEW_STAMPS[exportability.reason]}: no se
            entrega al cliente.
          </span>
        </p>
      )}

      <div className="flex flex-1 flex-col gap-6 p-5 sm:p-8 md:p-12">
        <header className="flex flex-col gap-5 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex min-w-0 items-center gap-3">
            {/* Espacio del logo: el monograma del concesionario (DEC-038 §10). */}
            <span
              aria-hidden="true"
              className="flex size-12 shrink-0 items-center justify-center rounded-lg bg-brand text-heading text-brand-contrast"
            >
              {document.issuer.monogram}
            </span>
            <p className="min-w-0 text-heading break-words text-text-primary">
              {document.issuer.name}
            </p>
          </div>
          <div className="flex shrink-0 flex-col gap-1 sm:items-end sm:text-right">
            <p className="text-overline text-brand uppercase">
              {QUOTE_DOCUMENT_HEADING}
            </p>
            <h2 className="text-metric text-text-primary tabular-nums">
              {document.numberLabel}
            </h2>
            <dl className="mt-1 grid grid-cols-[auto_auto] justify-start gap-x-2 gap-y-0.5 text-label sm:justify-end">
              <dt className="font-normal text-text-muted">{labels.issued}</dt>
              <dd className="font-semibold text-text-primary">
                <time dateTime={document.issuedOn}>{document.issuedLabel}</time>
              </dd>
              <dt className="font-normal text-text-muted">
                {labels.validUntil}
              </dt>
              <dd className="font-semibold text-text-primary">
                <time dateTime={document.validUntil}>
                  {document.validUntilLabel}
                </time>
              </dd>
            </dl>
          </div>
        </header>

        <hr className="border-border-default" />

        <div className="grid gap-4 sm:grid-cols-2">
          <PartyCard
            id="quote-document-customer"
            title={labels.customer}
            name={document.customer.name}
            fields={document.customer.fields}
          />
          <PartyCard
            id="quote-document-vehicle"
            title={labels.vehicle}
            name={document.vehicle.name}
            fields={document.vehicle.fields}
          />
        </div>

        <section
          aria-labelledby="quote-document-pricing"
          className="flex flex-col gap-2"
        >
          <h3
            id="quote-document-pricing"
            className="text-overline text-text-muted uppercase"
          >
            {labels.pricing}
          </h3>
          <div className="overflow-hidden rounded-md border border-border-default">
            <table className="w-full border-collapse text-left">
              <thead className="bg-surface-inverse text-text-inverse">
                <tr>
                  <th
                    scope="col"
                    className="px-3 py-2 text-overline uppercase sm:px-4"
                  >
                    {labels.concept}
                  </th>
                  <th
                    scope="col"
                    className="px-3 py-2 text-right text-overline uppercase sm:px-4"
                  >
                    {labels.amount}
                  </th>
                </tr>
              </thead>
              <tbody>
                {document.pricing.lines.map((line) => (
                  <tr
                    key={line.label}
                    className="border-b border-border-subtle"
                  >
                    <th
                      scope="row"
                      className="px-3 py-2.5 text-body font-normal text-text-secondary sm:px-4"
                    >
                      {line.label}
                    </th>
                    <td
                      className={cn(
                        "px-3 py-2.5 text-right text-body whitespace-nowrap tabular-nums sm:px-4",
                        line.tone === "discount"
                          ? "text-success"
                          : "text-text-primary",
                      )}
                    >
                      {line.value}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot className="bg-brand-soft">
                <tr>
                  <th
                    scope="row"
                    className="px-3 py-3 text-body font-semibold text-text-primary sm:px-4"
                  >
                    {labels.total}
                  </th>
                  <td className="px-3 py-3 text-right text-title whitespace-nowrap text-brand-strong tabular-nums sm:px-4">
                    {document.pricing.total}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        </section>

        {document.conditions.length > 0 ? (
          <section
            aria-labelledby="quote-document-conditions"
            className="flex flex-col gap-1.5"
          >
            <h3
              id="quote-document-conditions"
              className="text-overline text-text-muted uppercase"
            >
              {labels.conditions}
            </h3>
            {document.conditions.map((condition, index) => (
              <p
                key={index}
                className="text-body break-words text-text-secondary"
              >
                {condition}
              </p>
            ))}
          </section>
        ) : null}

        <section
          aria-labelledby="quote-document-terms"
          className="flex flex-col gap-1.5"
        >
          <h3
            id="quote-document-terms"
            className="text-overline text-text-muted uppercase"
          >
            {labels.terms}
          </h3>
          <ol className="flex list-decimal flex-col gap-1 pl-4 text-label font-normal text-text-secondary marker:text-text-muted">
            {document.terms.map((term) => (
              <li key={term} className="pl-1">
                {term}
              </li>
            ))}
          </ol>
        </section>

        <footer className="mt-auto border-t border-border-subtle pt-3">
          <p className="text-caption text-text-muted">{document.footer}</p>
        </footer>
      </div>
    </article>
  );
}
