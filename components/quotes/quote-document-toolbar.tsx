"use client";

import { useState } from "react";
import { LockIcon } from "@/components/ui/icons";
import { QUOTE_EXPORT_BLOCK_LABELS } from "@/domains/quotes/exportability";
import type { QuoteCardView } from "@/domains/quotes/presentation";

import { DownloadQuotePdf } from "./download-quote-pdf";
import { QuoteStatusChip } from "./quote-status";
import { QuoteStatusActions } from "./quote-status-actions";

/*
 * Barra de la vista previa del presupuesto (Hito 14, DEC-046 §6), fija
 * arriba mientras se recorre la hoja: qué se está viendo (número, total,
 * unidad, validez y estado), qué falta para entregarlo y las acciones.
 *
 *   Borrador:   [Aprobar cotización] [⋯]   "Aprobala para descargar el PDF…"
 *   Aprobada:   [⤓ Descargar PDF] [Marcar como enviada] [⋯]
 *   Enviada:    [⤓ Descargar PDF] [Cliente aceptó] [⋯]
 *   Aceptada:   [⤓ Descargar PDF]
 *   Vencida, anulada, rechazada o con la oportunidad cerrada: el motivo.
 *
 * El flujo comercial queda en una sola pantalla: revisar → aprobar →
 * descargar → entregar por su cuenta → marcar enviada. Cuando el PDF se
 * puede descargar, esa es la acción principal y el siguiente estado pasa a
 * secundario. Las acciones de estado son las del panel (QuoteStatusActions,
 * con su confirmación) y el PDF lo decide el servidor al descargar.
 */

export function QuoteDocumentToolbar({
  quote,
  contactName,
}: {
  quote: QuoteCardView;
  contactName: string;
}) {
  const [notice, setNotice] = useState<string | null>(null);
  const { exportability } = quote;

  return (
    <div className="sticky top-0 z-10 flex flex-col gap-3 rounded-lg border border-border-subtle bg-surface-1 p-3 shadow-card sm:flex-row sm:items-start sm:justify-between sm:p-4">
      <div className="flex min-w-0 flex-col gap-1">
        <p className="flex flex-wrap items-center gap-2">
          <span className="text-heading text-text-primary tabular-nums">
            {quote.numberLabel} · {quote.totalLabel}
          </span>
          <QuoteStatusChip status={quote.displayStatus} />
        </p>
        <p className="text-caption break-words text-text-muted">
          {contactName} · {quote.vehicleLabel} · válida hasta{" "}
          <time dateTime={quote.validUntil}>{quote.validUntilLabel}</time>
        </p>
        {exportability.exportable ? (
          <p className="text-caption text-text-secondary">
            {quote.status === "approved"
              ? "Descargá el PDF para entregarlo y después marcala como enviada. Descargar no le envía nada al cliente."
              : "Descargar el PDF no cambia la cotización ni le envía nada al cliente."}
          </p>
        ) : (
          <p className="flex items-start gap-1.5 text-caption text-warning">
            <LockIcon aria-hidden="true" className="mt-px size-3.5 shrink-0" />
            {QUOTE_EXPORT_BLOCK_LABELS[exportability.reason]}
          </p>
        )}
        {quote.approvalHint ? (
          <p className="flex items-start gap-1.5 text-caption text-warning">
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
      </div>
      <div className="flex shrink-0 flex-wrap items-start gap-2">
        {exportability.exportable ? (
          <DownloadQuotePdf
            quoteId={quote.id}
            numberLabel={quote.numberLabel}
            className="max-w-72"
          />
        ) : null}
        <QuoteStatusActions
          quote={quote}
          onNotice={setNotice}
          primaryVariant={exportability.exportable ? "secondary" : "primary"}
        />
      </div>
    </div>
  );
}
