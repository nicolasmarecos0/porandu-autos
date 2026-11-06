"use client";

import { Button } from "@/components/ui/button";
import { cn } from "@/components/ui/cn";
import {
  ConfirmDialog,
  ConfirmDialogCancel,
  ConfirmDialogContent,
} from "@/components/ui/confirm-dialog";
import { ChevronRightIcon } from "@/components/ui/icons";
import {
  optimisticStatusOf,
  VEHICLE_TRANSITION_COPY,
  type StockTransitionId,
} from "@/domains/vehicles/lifecycle";
import {
  vehicleDetail,
  vehicleName,
  type StockVehicle,
} from "@/domains/vehicles/stock";

import { LITERAL, StatusChip } from "./stock-status";

/*
 * Confirmación de una transición de Stock (Hito 19, propuesta DEC-051):
 * poner en el salón, reservar o liberar la reserva. Las tres tienen
 * significado comercial (DEC-028 §8), así que nunca se ejecutan con un solo
 * click: el alertdialog de Radix dice qué unidad, de qué estado a cuál y la
 * consecuencia en una oración, y abre con el foco en "Cancelar".
 *
 * Breve a propósito: sin formularios ni datos de más, porque en el Catálogo
 * puede estar mirando el cliente. No guarda nada por su cuenta: al
 * confirmar, entrega el pedido a `onConfirm` y la vista lo guarda de forma
 * optimista (useVehicleLifecycle()).
 */

export type TransitionRequest = Readonly<{
  vehicle: Pick<
    StockVehicle,
    "id" | "brand" | "model" | "version" | "year" | "status"
  >;
  transition: StockTransitionId;
}>;

export function VehicleTransitionDialog({
  request,
  onCancel,
  onConfirm,
  onCloseAutoFocus,
}: {
  request: TransitionRequest | null;
  onCancel: () => void;
  onConfirm: (request: TransitionRequest) => void;
  onCloseAutoFocus?: (event: Event) => void;
}) {
  const copy = request ? VEHICLE_TRANSITION_COPY[request.transition] : null;
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
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-border-subtle bg-surface-2 px-3 py-2.5">
              <div className="min-w-0">
                <p className="truncate text-label text-text-primary">
                  {vehicleName(request.vehicle)}
                </p>
                <p
                  className={cn(
                    "truncate text-caption text-text-muted",
                    LITERAL,
                  )}
                >
                  {vehicleDetail(request.vehicle)}
                </p>
              </div>
              <p className="flex shrink-0 items-center gap-1">
                <span className="sr-only">Pasa de</span>
                <StatusChip status={request.vehicle.status} />
                <span className="sr-only">a</span>
                <ChevronRightIcon
                  aria-hidden="true"
                  className="size-3.5 text-text-muted"
                />
                <StatusChip status={optimisticStatusOf(request.transition)} />
              </p>
            </div>
          </div>
          <footer className="flex justify-end gap-2 rounded-b-lg border-t border-border-subtle bg-surface-2 px-5 py-3">
            <ConfirmDialogCancel asChild>
              <Button variant="secondary" className="h-10 sm:h-8">
                Cancelar
              </Button>
            </ConfirmDialogCancel>
            <Button
              variant="primary"
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
