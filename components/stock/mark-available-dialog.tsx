"use client";

import { useActionState, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/components/ui/cn";
import {
  ConfirmDialog,
  ConfirmDialogCancel,
  ConfirmDialogContent,
  ConfirmDialogTrigger,
} from "@/components/ui/confirm-dialog";
import { CheckIcon, ChevronRightIcon } from "@/components/ui/icons";
import {
  AVAILABILITY_TRANSITION,
  MARK_AVAILABLE_FIELD,
} from "@/domains/vehicles/availability";
import {
  vehicleDetail,
  vehicleName,
  type StockVehicle,
} from "@/domains/vehicles/stock";
import { markVehicleAvailable } from "@/lib/vehicles/actions";
import type { MarkVehicleAvailableState } from "@/lib/vehicles/availability";

import { LITERAL, StatusChip } from "./stock-status";

/*
 * "Marcar disponible" (H1.3C): la acción de una unidad en preparación, en el
 * rail de Stock, con una confirmación breve antes de ejecutarla porque la
 * transición tiene significado comercial. No conoce la base: envía solo el
 * id de la unidad a la Server Action markVehicleAvailable(), que fija el
 * destino y valida todo en el servidor.
 *
 * Mientras marca, la confirmación no se cierra ni se reenvía. Con una
 * respuesta (disponible, ya no estaba en preparación, no existe) se cierra
 * y la vista avisa el resultado: la página ya se revalidó y la unidad
 * aparece en su grupo real, así que este botón deja de existir y el foco lo
 * ubica la vista. Una falla inesperada deja la confirmación abierta, con lo
 * que pasó, para reintentar.
 */

export type AvailabilitySettled = Exclude<
  MarkVehicleAvailableState,
  null | { status: "failed" }
>;

type MarkAvailableDialogProps = {
  vehicle: StockVehicle;
  onSettled: (vehicleId: string, result: AvailabilitySettled) => void;
};

export function MarkAvailableDialog({
  vehicle,
  onSettled,
}: MarkAvailableDialogProps) {
  const [open, setOpen] = useState(false);
  const settled = useRef(false);
  const [state, action, pending] = useActionState<
    MarkVehicleAvailableState,
    FormData
  >(async (previous, formData) => {
    const result = await markVehicleAvailable(previous, formData);
    if (result !== null && result.status !== "failed") {
      settled.current = true;
      setOpen(false);
      onSettled(vehicle.id, result);
    }
    return result;
  }, null);
  const failed = !pending && state?.status === "failed";

  return (
    <ConfirmDialog
      open={open}
      onOpenChange={(next) => {
        if (!next && pending) return;
        setOpen(next);
      }}
    >
      <ConfirmDialogTrigger asChild>
        <Button variant="primary" disabled={pending} className="mt-3 w-full">
          <CheckIcon className="size-4" strokeWidth={2.25} />
          Marcar disponible
        </Button>
      </ConfirmDialogTrigger>
      <ConfirmDialogContent
        title="Marcar unidad como disponible"
        description="La unidad quedará lista para vender."
        onEscapeKeyDown={(event) => {
          if (pending) event.preventDefault();
        }}
        onCloseAutoFocus={(event) => {
          if (settled.current) event.preventDefault();
        }}
      >
        <form action={action} aria-busy={pending}>
          <input type="hidden" name={MARK_AVAILABLE_FIELD} value={vehicle.id} />
          <div className="flex flex-col gap-3 px-5 pb-5">
            <div className="flex items-center justify-between gap-3 rounded-md border border-border-subtle bg-surface-2 px-3 py-2.5">
              <div className="min-w-0">
                <p className="truncate text-label text-text-primary">
                  {vehicleName(vehicle)}
                </p>
                <p
                  className={cn(
                    "truncate text-caption text-text-muted",
                    LITERAL,
                  )}
                >
                  {vehicleDetail(vehicle)}
                </p>
              </div>
              <p className="flex shrink-0 items-center gap-1">
                <span className="sr-only">Pasa de</span>
                <StatusChip status={AVAILABILITY_TRANSITION.from} />
                <span className="sr-only">a</span>
                <ChevronRightIcon
                  aria-hidden="true"
                  className="size-3.5 text-text-muted"
                />
                <StatusChip status={AVAILABILITY_TRANSITION.to} />
              </p>
            </div>
            {failed ? (
              <p
                role="alert"
                className="rounded-md border border-danger-border bg-danger-soft px-3 py-2 text-label text-danger"
              >
                No pudimos marcar la unidad. No se hizo ningún cambio: intentá
                de nuevo en unos minutos.
              </p>
            ) : null}
          </div>
          <footer className="flex justify-end gap-2 rounded-b-lg border-t border-border-subtle bg-surface-2 px-5 py-3">
            <ConfirmDialogCancel asChild>
              <Button variant="secondary" disabled={pending}>
                Cancelar
              </Button>
            </ConfirmDialogCancel>
            <Button
              type="submit"
              variant="primary"
              disabled={pending}
              className="disabled:cursor-wait disabled:opacity-70"
            >
              {pending ? "Marcando…" : "Marcar disponible"}
            </Button>
          </footer>
        </form>
      </ConfirmDialogContent>
    </ConfirmDialog>
  );
}
