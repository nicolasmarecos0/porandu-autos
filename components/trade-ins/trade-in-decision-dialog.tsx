"use client";

import { Button } from "@/components/ui/button";
import {
  ConfirmDialog,
  ConfirmDialogCancel,
  ConfirmDialogContent,
} from "@/components/ui/confirm-dialog";
import { ChevronRightIcon } from "@/components/ui/icons";
import {
  TRADE_IN_DECISION_COPY,
  type TradeInCardView,
} from "@/domains/opportunities/trade-in-presentation";
import {
  optimisticTradeInStatus,
  type TradeInDecisionId,
} from "@/domains/opportunities/trade-ins";

import { TradeInStatusChip } from "./trade-in-status";

/*
 * Confirmación de una decisión sobre la toma (Hito 20, DEC-052 §4): el
 * cliente aprobó o rechazó el valor de toma, se descarta o el cliente
 * desistió. Tienen significado comercial (aprobada, entra al stock con el
 * cierre Ganada) y no se deshacen, así que nunca se ejecutan con un solo
 * click (DEC-028 §8): el alertdialog de Radix dice qué usado, de qué estado
 * a cuál y la consecuencia, y abre con el foco en "Cancelar".
 *
 * No guarda nada por su cuenta: al confirmar entrega la decisión a
 * `onConfirm` y el panel la guarda de forma optimista.
 */

export type TradeInDecisionRequest = Readonly<{
  view: TradeInCardView;
  decision: TradeInDecisionId;
}>;

export function TradeInDecisionDialog({
  request,
  onCancel,
  onConfirm,
  onCloseAutoFocus,
}: {
  request: TradeInDecisionRequest | null;
  onCancel: () => void;
  onConfirm: (request: TradeInDecisionRequest) => void;
  onCloseAutoFocus?: (event: Event) => void;
}) {
  const copy = request ? TRADE_IN_DECISION_COPY[request.decision] : null;
  return (
    <ConfirmDialog
      open={request !== null}
      onOpenChange={(open) => {
        if (!open) onCancel();
      }}
    >
      {request && copy ? (
        <ConfirmDialogContent
          title={copy.title}
          description={copy.description}
          onCloseAutoFocus={onCloseAutoFocus}
        >
          <div className="px-5 pb-5">
            <div className="flex flex-col gap-2.5 rounded-md border border-border-subtle bg-surface-2 px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between sm:gap-3">
              <div className="min-w-0">
                <p className="truncate text-label text-text-primary">
                  {request.view.name}
                </p>
                <p className="truncate text-caption text-text-muted tabular-nums">
                  {request.view.detail}
                  {request.view.appraisal
                    ? ` · Valor de toma ${request.view.appraisal.offerPriceLabel}`
                    : ""}
                </p>
              </div>
              <p className="flex shrink-0 flex-wrap items-center gap-1">
                <span className="sr-only">Pasa de</span>
                <TradeInStatusChip status={request.view.status} />
                <span className="sr-only">a</span>
                <ChevronRightIcon
                  aria-hidden="true"
                  className="size-3.5 text-text-muted"
                />
                <TradeInStatusChip
                  status={optimisticTradeInStatus(request.decision)}
                />
              </p>
            </div>
          </div>
          <footer className="flex flex-col-reverse gap-2 rounded-b-lg border-t border-border-subtle bg-surface-2 px-5 py-3 sm:flex-row sm:justify-end">
            <ConfirmDialogCancel asChild>
              <Button variant="secondary" className="h-10 sm:h-8">
                Cancelar
              </Button>
            </ConfirmDialogCancel>
            <Button
              variant={copy.tone}
              className="h-10 sm:h-8"
              onClick={() => onConfirm(request)}
            >
              {copy.confirm}
            </Button>
          </footer>
        </ConfirmDialogContent>
      ) : null}
    </ConfirmDialog>
  );
}
