"use client";

import { LITERAL, StatusChip } from "@/components/stock/stock-status";
import { Button } from "@/components/ui/button";
import { cn } from "@/components/ui/cn";
import {
  ConfirmDialog,
  ConfirmDialogCancel,
  ConfirmDialogContent,
} from "@/components/ui/confirm-dialog";
import { ChevronRightIcon } from "@/components/ui/icons";
import {
  COMPLETE_DELIVERY_LABEL,
  DELIVERY_COMPLETION_NOTICE,
} from "@/domains/opportunities/deliveries";
import type { DeliveryUnit } from "@/domains/opportunities/delivery-presentation";

/*
 * Confirmación de "Completar Entrega y Dar Salida al Vehículo" (Hito 21,
 * DEC-053 §5). Completar no se deshace: la unidad pasa a Entregada y sale
 * del salón, así que nunca se ejecuta con un solo click (CLAUDE.md §2,
 * DEC-028 §8). El alertdialog de Radix dice qué unidad, de qué estado a
 * cuál y la consecuencia, y abre con el foco en "Cancelar".
 *
 * No guarda nada por su cuenta: al confirmar avisa a `onConfirm` y el panel
 * guarda de forma optimista.
 */
export function CompleteDeliveryDialog({
  open,
  unit,
  onCancel,
  onConfirm,
  onCloseAutoFocus,
}: {
  open: boolean;
  unit: DeliveryUnit | null;
  onCancel: () => void;
  onConfirm: () => void;
  onCloseAutoFocus?: (event: Event) => void;
}) {
  return (
    <ConfirmDialog
      open={open}
      onOpenChange={(next) => {
        if (!next) onCancel();
      }}
    >
      {open ? (
        <ConfirmDialogContent
          title="Completar la entrega"
          description={DELIVERY_COMPLETION_NOTICE}
          onCloseAutoFocus={onCloseAutoFocus}
        >
          {unit ? (
            <div className="px-5 pb-5">
              <div className="flex flex-col gap-2.5 rounded-md border border-border-subtle bg-surface-2 px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between sm:gap-3">
                <div className="min-w-0">
                  <p className="truncate text-label text-text-primary">
                    {unit.name}
                  </p>
                  <p
                    className={cn(
                      "truncate text-caption text-text-muted",
                      LITERAL,
                    )}
                  >
                    {unit.detail}
                  </p>
                </div>
                <p className="flex shrink-0 flex-wrap items-center gap-1">
                  <span className="sr-only">Pasa de</span>
                  <StatusChip status={unit.status} />
                  <span className="sr-only">a</span>
                  <ChevronRightIcon
                    aria-hidden="true"
                    className="size-3.5 text-text-muted"
                  />
                  <StatusChip status="delivered" />
                </p>
              </div>
            </div>
          ) : null}
          <footer className="flex flex-col-reverse gap-2 rounded-b-lg border-t border-border-subtle bg-surface-2 px-5 py-3 sm:flex-row sm:justify-end">
            <ConfirmDialogCancel asChild>
              <Button variant="secondary" className="h-10 sm:h-8">
                Cancelar
              </Button>
            </ConfirmDialogCancel>
            <Button
              variant="primary"
              className="h-auto min-h-10 py-1.5 sm:min-h-8"
              onClick={onConfirm}
            >
              {COMPLETE_DELIVERY_LABEL}
            </Button>
          </footer>
        </ConfirmDialogContent>
      ) : null}
    </ConfirmDialog>
  );
}
