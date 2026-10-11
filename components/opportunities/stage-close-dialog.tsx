"use client";

import { useId } from "react";
import { Button } from "@/components/ui/button";
import {
  ConfirmDialog,
  ConfirmDialogCancel,
  ConfirmDialogContent,
  ConfirmDialogTrigger,
} from "@/components/ui/confirm-dialog";
import { FormField, inputClassName } from "@/components/ui/form-field";
import { ChevronRightIcon } from "@/components/ui/icons";
import {
  LOSS_REASON_OPTIONS,
  STAGE_ACTION_LABELS,
} from "@/domains/opportunities/labels";
import {
  STAGE_CHANGE_FIELDS,
  type Stage,
} from "@/domains/opportunities/stages";
import type { ChangeStageState } from "@/lib/opportunities/stage-change";

import { StageBadge } from "./stage-badge";

/*
 * Confirmación de un cierre (H1.6, DEC-032 §5): marcar una oportunidad
 * ganada o perdida. Son etapas terminales, de las que no se vuelve, así que
 * nunca se ejecutan con un solo click. Perder además captura el motivo
 * estructurado, que es obligatorio.
 *
 * No conoce la base: envía a la Server Action changeOpportunityStage() solo
 * la oportunidad, la etapa de destino y el motivo; la etapa de origen y la
 * regla las resuelve el servidor. El panel es el dueño del pedido (la acción,
 * el estado y si está abierto): mientras guarda, la confirmación no se cierra
 * ni se reenvía. Una falla deja el diálogo abierto, con lo que pasó, para
 * reintentar.
 */

type StageCloseDialogProps = Readonly<{
  to: "won" | "lost";
  opportunityId: string;
  /** Etapa actual, para mostrar el pase. */
  stage: Stage;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  action: (formData: FormData) => void;
  pending: boolean;
  state: ChangeStageState;
  onCloseAutoFocus: (event: Event) => void;
}>;

const COPY = {
  won: {
    title: "Marcar como ganada",
    description:
      "Confirmás que la venta se concretó. La oportunidad se cierra y no se puede reabrir.",
    pending: "Marcando…",
  },
  lost: {
    title: "Marcar como perdida",
    description:
      "La oportunidad se cierra y no se puede reabrir. Indicá por qué se perdió.",
    pending: "Marcando…",
  },
} as const;

export function StageCloseDialog({
  to,
  opportunityId,
  stage,
  open,
  onOpenChange,
  action,
  pending,
  state,
  onCloseAutoFocus,
}: StageCloseDialogProps) {
  const copy = COPY[to];
  const reasonId = useId();
  const reasonErrorId = `${reasonId}-error`;
  const failed = !pending && state?.status === "failed";
  const reasonMissing =
    !pending && to === "lost" && state?.status === "loss_reason_required";

  return (
    <ConfirmDialog
      open={open}
      onOpenChange={(next) => {
        if (!next && pending) return;
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
        <form action={action} aria-busy={pending}>
          <input
            type="hidden"
            name={STAGE_CHANGE_FIELDS.opportunityId}
            value={opportunityId}
          />
          <input type="hidden" name={STAGE_CHANGE_FIELDS.stage} value={to} />
          <div className="flex flex-col gap-3 px-5 pb-5">
            <p className="flex items-center gap-1 rounded-md border border-border-subtle bg-surface-2 px-3 py-2.5">
              <span className="sr-only">Pasa de</span>
              <StageBadge stage={stage} />
              <span className="sr-only">a</span>
              <ChevronRightIcon
                aria-hidden="true"
                className="size-3.5 text-text-muted"
              />
              <StageBadge stage={to} />
            </p>
            {to === "lost" ? (
              <FormField
                label="Motivo de la pérdida"
                htmlFor={reasonId}
                error={
                  reasonMissing ? "Elegí un motivo para cerrarla." : undefined
                }
                errorId={reasonErrorId}
              >
                <select
                  id={reasonId}
                  name={STAGE_CHANGE_FIELDS.lossReason}
                  required
                  defaultValue=""
                  disabled={pending}
                  aria-invalid={reasonMissing || undefined}
                  aria-describedby={reasonMissing ? reasonErrorId : undefined}
                  className={inputClassName}
                >
                  <option value="" disabled>
                    Elegí un motivo
                  </option>
                  {LOSS_REASON_OPTIONS.map((option) => (
                    <option key={option.id} value={option.id}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </FormField>
            ) : null}
            {failed ? (
              <p
                role="alert"
                className="rounded-md border border-danger-border bg-danger-soft px-3 py-2 text-label text-danger"
              >
                No pudimos cambiar la etapa. No se hizo ningún cambio: intentá
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
              variant={to === "lost" ? "danger" : "primary"}
              disabled={pending}
              className="disabled:cursor-wait disabled:opacity-70"
            >
              {pending ? copy.pending : STAGE_ACTION_LABELS[to]}
            </Button>
          </footer>
        </form>
      </ConfirmDialogContent>
    </ConfirmDialog>
  );
}
