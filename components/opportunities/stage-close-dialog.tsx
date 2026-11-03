"use client";

import { startTransition, useActionState, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  ConfirmDialog,
  ConfirmDialogContent,
  ConfirmDialogTrigger,
} from "@/components/ui/confirm-dialog";
import type { Money } from "@/domains/money";
import {
  todayInAsuncion,
  type ClosureOutcome,
} from "@/domains/opportunities/closure";
import { STAGE_ACTION_LABELS } from "@/domains/opportunities/labels";
import type { Stage } from "@/domains/opportunities/stages";
import { closeOpportunity } from "@/lib/opportunities/actions";
import type { CloseOpportunityState } from "@/lib/opportunities/closure";

import type { SaleVehicle } from "./closure-fields";
import {
  CLOSURE_DIALOG_COPY,
  ClosureForm,
  closureStaysOpen,
} from "./closure-form";

export { ClosureAlert } from "./closure-form";

/*
 * Confirmación de un cierre (DEC-034) en el panel "Etapa" de
 * /opportunities/[id]: marcar una oportunidad ganada o perdida, con sus
 * metadatos. Son etapas terminales, de las que no se vuelve, y sus datos no
 * se pueden corregir después, así que nunca se ejecutan con un solo click:
 * el diálogo pide los datos y la confirmación.
 *
 * - Ganada: la unidad vendida (la vinculada), precio final y moneda, forma
 *   de pago y entrega. Sin unidad vinculada no se ofrece confirmar.
 * - Perdida: motivo y notas opcionales.
 *
 * Los campos y la validación son los de ClosureForm (el mismo formulario del
 * tablero del embudo). Acá se espera la respuesta: envía a la Server Action
 * closeOpportunity() la oportunidad, el resultado y sus campos; la etapa de
 * origen, la unidad y la regla las resuelve el servidor. Mientras guarda, la
 * confirmación no se cierra ni se reenvía. Un dato inválido o una falla
 * dejan el diálogo abierto, con lo cargado, para corregir o reintentar;
 * cualquier otra respuesta lo cierra y la avisa el panel (onSettled).
 */

type StageCloseDialogProps = Readonly<{
  to: ClosureOutcome;
  opportunityId: string;
  /** Etapa actual, para mostrar el pase. */
  stage: Stage;
  /** La unidad vinculada: la que se vende al ganar. */
  saleVehicle: SaleVehicle | null;
  /**
   * Total de la cotización aceptada (Hito 10, DEC-042 §7): precarga el
   * precio final y la moneda al ganar. Se puede cambiar.
   */
  acceptedQuoteTotal?: Money | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Respuesta que cierra el diálogo: el panel la avisa. */
  onSettled: (state: Exclude<CloseOpportunityState, null>) => void;
  onCloseAutoFocus: (event: Event) => void;
}>;

export function StageCloseDialog({
  to,
  opportunityId,
  stage,
  saleVehicle,
  acceptedQuoteTotal = null,
  open,
  onOpenChange,
  onSettled,
  onCloseAutoFocus,
}: StageCloseDialogProps) {
  const copy = CLOSURE_DIALOG_COPY[to];
  // "Hoy" en Asunción, fijado al abrir: acota la fecha de entrega.
  const [today, setToday] = useState(() => todayInAsuncion(new Date()));
  const [state, action, pending] = useActionState<
    CloseOpportunityState,
    FormData
  >(async (previous, formData) => {
    const result = await closeOpportunity(previous, formData);
    if (result !== null && !closureStaysOpen(result)) onSettled(result);
    return result;
  }, null);

  return (
    <ConfirmDialog
      open={open}
      onOpenChange={(next) => {
        if (!next && pending) return;
        if (next) setToday(todayInAsuncion(new Date()));
        onOpenChange(next);
      }}
    >
      <ConfirmDialogTrigger asChild>
        <Button
          variant={to === "lost" ? "secondary" : "primary"}
          disabled={pending}
        >
          {STAGE_ACTION_LABELS[to]}
        </Button>
      </ConfirmDialogTrigger>
      <ConfirmDialogContent
        title={copy.title}
        description={copy.description}
        onEscapeKeyDown={(event) => {
          if (pending) event.preventDefault();
        }}
        onCloseAutoFocus={onCloseAutoFocus}
      >
        <ClosureForm
          to={to}
          opportunityId={opportunityId}
          stage={stage}
          saleVehicle={saleVehicle}
          acceptedQuoteTotal={acceptedQuoteTotal}
          today={today}
          pending={pending}
          state={state}
          onSubmit={(formData) => startTransition(() => action(formData))}
        />
      </ConfirmDialogContent>
    </ConfirmDialog>
  );
}
