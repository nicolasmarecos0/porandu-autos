"use client";

import { Button } from "@/components/ui/button";
import {
  ConfirmDialog,
  ConfirmDialogCancel,
  ConfirmDialogContent,
} from "@/components/ui/confirm-dialog";
import { CANCEL_DELIVERY_LABEL } from "@/domains/opportunities/deliveries";

/*
 * Confirmación de "Anular entrega" (Hito 22, DEC-054 §4). Anular borra el
 * remito pendiente con su checklist: no se deshace, así que nunca se
 * ejecuta con un solo click (CLAUDE.md §2). El alertdialog de Radix dice la
 * consecuencia y abre con el foco en "Cancelar". Solo lo ve un admin; la
 * Server Action y la base lo vuelven a exigir.
 */
export function CancelDeliveryDialog({
  open,
  onCancel,
  onConfirm,
  onCloseAutoFocus,
}: {
  open: boolean;
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
          title="Anular la entrega"
          description="Se borra la entrega programada y su checklist. La venta sigue cerrada y la unidad sigue Vendida en el salón: podés programar otra entrega."
          onCloseAutoFocus={onCloseAutoFocus}
        >
          <footer className="flex flex-col-reverse gap-2 rounded-b-lg border-t border-border-subtle bg-surface-2 px-5 py-3 sm:flex-row sm:justify-end">
            <ConfirmDialogCancel asChild>
              <Button variant="secondary" className="h-10 sm:h-8">
                Cancelar
              </Button>
            </ConfirmDialogCancel>
            <Button
              variant="danger"
              className="h-10 sm:h-8"
              onClick={onConfirm}
            >
              {CANCEL_DELIVERY_LABEL}
            </Button>
          </footer>
        </ConfirmDialogContent>
      ) : null}
    </ConfirmDialog>
  );
}
