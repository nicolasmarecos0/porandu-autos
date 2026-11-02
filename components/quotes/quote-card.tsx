"use client";

import Link from "next/link";
import { useState } from "react";
import { cn } from "@/components/ui/cn";
import { DocumentIcon, LockIcon, SteeringIcon } from "@/components/ui/icons";
import { QUOTE_EXPORT_BLOCK_LABELS } from "@/domains/quotes/exportability";
import type { QuoteCardView } from "@/domains/quotes/presentation";
import { quoteDocumentPath } from "@/lib/quotes/paths";

import { DownloadQuotePdf } from "./download-quote-pdf";
import { QUOTE_EDGE, QuoteStatusChip } from "./quote-status";
import { QuoteStatusActions } from "./quote-status-actions";

/*
 * Tarjeta de una cotización en /opportunities/[id] (Hito 10, DEC-042 §9):
 * número, estado, unidad, desglose de precio (lista, descuento y total),
 * validez, quién la creó y quién la aprobó, condiciones y las acciones que
 * la máquina de estados permite hoy al que mira (QuoteStatusActions, con
 * su confirmación).
 *
 *   ┃ N.º 0007  [● Aprobada]                     [Marcar como enviada] [⋯]
 *   ┃ 🚙 Toyota Hilux 2024
 *   ┃ Precio de lista       USD 49.900
 *   ┃ Descuento (7,5 %)     − USD 3.742,50
 *   ┃ Total                 USD 46.157,50
 *   ┃ Válida hasta 8 nov 2026 · Vos · 1 nov 2026 10:02
 *   ┃ ───────────────────────────────────────────────────────────────
 *   ┃ [📄 Ver presupuesto]  [⤓ Descargar PDF]
 *
 * Presupuesto (Hito 14, DEC-046 §6): toda cotización abre su vista previa
 * ("Ver presupuesto", la página de detalle). Una que se puede entregar
 * (aprobada, enviada o aceptada, vigente y con la oportunidad abierta)
 * ofrece además "Descargar PDF"; un borrador explica que falta aprobarla.
 * El servidor vuelve a decidir todo al descargar.
 */

function PriceRow({
  label,
  value,
  emphasis = false,
  tone = "default",
}: {
  label: string;
  value: string;
  emphasis?: boolean;
  tone?: "default" | "discount";
}) {
  return (
    <div
      className={cn(
        "flex items-baseline justify-between gap-4",
        emphasis && "border-t border-border-subtle pt-2",
      )}
    >
      <dt
        className={cn(
          "text-label",
          emphasis ? "font-semibold text-text-primary" : "text-text-secondary",
        )}
      >
        {label}
      </dt>
      <dd
        className={cn(
          "text-right tabular-nums",
          emphasis
            ? "text-title font-semibold text-text-primary"
            : "text-body text-text-primary",
          tone === "discount" && "text-success",
        )}
      >
        {value}
      </dd>
    </div>
  );
}

/** Enlace secundario con la forma de un botón (tokens de DEC-013). */
const documentLinkClassName =
  "inline-flex h-8 shrink-0 items-center justify-center gap-1.5 rounded-md border border-border-default bg-surface-1 px-3 text-label font-semibold text-text-primary transition-[transform,background-color,border-color,color] duration-150 ease-out-strong hover:border-border-strong hover:bg-surface-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring active:scale-[0.97] motion-reduce:active:scale-100";

export function QuoteCard({
  quote,
  opportunityId,
}: {
  quote: QuoteCardView;
  opportunityId: string;
}) {
  const [notice, setNotice] = useState<string | null>(null);
  const closed = quote.status === "withdrawn" || quote.status === "rejected";
  const { exportability } = quote;

  return (
    <article
      aria-label={`Cotización ${quote.numberLabel}, ${quote.displayLabel}, total ${quote.totalLabel}`}
      className="relative flex overflow-hidden rounded-md border border-border-subtle bg-surface-1 shadow-card transition-[border-color,box-shadow] duration-150 ease-out-strong hover:border-border-default hover:shadow-md"
    >
      <span
        aria-hidden="true"
        className={cn("w-1 shrink-0", QUOTE_EDGE[quote.displayStatus])}
      />
      <div className="flex min-w-0 flex-1 flex-col gap-3 p-3.5 sm:p-4">
        <header className="flex flex-wrap items-start justify-between gap-x-3 gap-y-2">
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <h3 className="text-heading text-text-primary tabular-nums">
              {quote.numberLabel}
            </h3>
            <QuoteStatusChip status={quote.displayStatus} />
          </div>
          <QuoteStatusActions quote={quote} onNotice={setNotice} />
        </header>

        <p className="flex items-start gap-1.5 text-label text-text-secondary">
          <SteeringIcon
            aria-hidden="true"
            className="mt-px size-3.5 shrink-0 text-text-muted"
          />
          <span className="[font-feature-settings:'calt'_0] break-words">
            {quote.vehicleLabel}
          </span>
        </p>

        <dl
          className={cn(
            "flex flex-col gap-1.5 rounded-md border border-border-subtle bg-surface-2 px-3 py-2.5",
            closed && "opacity-70",
          )}
        >
          <PriceRow label="Precio de lista" value={quote.listPriceLabel} />
          {quote.discount ? (
            <PriceRow
              label={`Descuento (${quote.discount.effectiveLabel})`}
              value={quote.discount.amountLabel}
              tone="discount"
            />
          ) : (
            <PriceRow label="Descuento" value="Sin descuento" />
          )}
          <PriceRow label="Total" value={quote.totalLabel} emphasis />
        </dl>

        {quote.notes ? (
          <p className="text-label whitespace-pre-line text-text-secondary">
            {quote.notes}
          </p>
        ) : null}

        <div className="flex flex-col gap-0.5 text-caption text-text-muted sm:flex-row sm:flex-wrap sm:gap-x-3">
          <span>
            Válida hasta{" "}
            <time dateTime={quote.validUntil} className="tabular-nums">
              {quote.validUntilLabel}
            </time>
          </span>
          <span>Creó: {quote.createdLabel}</span>
          {quote.approvedLabel ? <span>{quote.approvedLabel}</span> : null}
        </div>

        {quote.approvalHint ? (
          <p className="flex items-start gap-1.5 rounded-sm border border-warning-border bg-warning-soft px-2 py-1.5 text-caption text-warning">
            <LockIcon aria-hidden="true" className="mt-px size-3.5 shrink-0" />
            {quote.approvalHint}
          </p>
        ) : null}

        {notice ? (
          <p
            role="status"
            className="rounded-sm border border-brand-border bg-brand-soft px-2 py-1.5 text-caption text-brand-strong"
          >
            {notice}
          </p>
        ) : null}

        <footer className="flex flex-wrap items-start gap-2 border-t border-border-subtle pt-3">
          <Link
            href={quoteDocumentPath(opportunityId, quote.id)}
            className={documentLinkClassName}
          >
            <DocumentIcon aria-hidden="true" className="size-4" />
            Ver presupuesto
          </Link>
          {exportability.exportable ? (
            <DownloadQuotePdf
              quoteId={quote.id}
              numberLabel={quote.numberLabel}
              variant="secondary"
            />
          ) : exportability.reason === "draft" ? (
            <p className="flex min-h-8 items-center gap-1.5 text-caption text-text-muted">
              <LockIcon aria-hidden="true" className="size-3.5 shrink-0" />
              {QUOTE_EXPORT_BLOCK_LABELS.draft}
            </p>
          ) : null}
        </footer>
      </div>
    </article>
  );
}
