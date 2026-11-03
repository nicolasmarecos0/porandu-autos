"use client";

import { useState, type FormEvent, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { ConfirmDialogCancel } from "@/components/ui/confirm-dialog";
import { ChevronRightIcon } from "@/components/ui/icons";
import { formatAmount, type Money } from "@/domains/money";
import {
  CLOSURE_FIELDS,
  OUTCOME_FIELDS,
  parseClosure,
  type ClosureErrors,
  type ClosureOutcome,
  type ClosureValues,
} from "@/domains/opportunities/closure";
import { STAGE_ACTION_LABELS } from "@/domains/opportunities/labels";
import type { Stage } from "@/domains/opportunities/stages";
import type { CloseOpportunityState } from "@/lib/opportunities/closure";

import { ClosureFields, type SaleVehicle } from "./closure-fields";
import { StageBadge } from "./stage-badge";

/*
 * Formulario de un cierre (DEC-034) dentro de su confirmación (alertdialog
 * de Radix): el pase, los campos del resultado, el aviso de la última
 * respuesta y los botones. Lo comparten el panel "Etapa" de
 * /opportunities/[id] (StageCloseDialog) y el tablero del embudo
 * (PipelineCloseDialog): mismos campos, misma validación y mismo copy.
 *
 * Valida antes de enviar con la validación del dominio (Zod) y avisa por
 * campo, con el foco en el primer error; el servidor la repite y es el que
 * decide. No envía nada por su cuenta: entrega el pedido ya validado a
 * `onSubmit`, y quien lo usa decide cómo guardarlo (esperando la respuesta
 * o de forma optimista).
 */

/** Copy de cada confirmación de cierre. */
export const CLOSURE_DIALOG_COPY = {
  won: {
    title: "Marcar como ganada",
    description:
      "Registrá cómo se cerró la venta. La oportunidad se cierra y ni la etapa ni estos datos se pueden cambiar después.",
    pending: "Marcando…",
  },
  lost: {
    title: "Marcar como perdida",
    description:
      "Indicá por qué se perdió. La oportunidad se cierra y ni la etapa ni estos datos se pueden cambiar después.",
    pending: "Marcando…",
  },
} as const;

/** Respuestas que se corrigen o reintentan con el formulario abierto. */
export type RetryableClosure = Extract<
  CloseOpportunityState,
  { status: "invalid" | "failed" | "vehicle_required" }
>;

export function closureStaysOpen(
  state: CloseOpportunityState,
): state is RetryableClosure {
  return (
    state?.status === "invalid" ||
    state?.status === "failed" ||
    state?.status === "vehicle_required"
  );
}

/** Lo cargado en el formulario: solo los campos del resultado. */
export function closureValuesOf(
  data: FormData,
  to: ClosureOutcome,
): ClosureValues {
  const values: Record<string, string> = {
    salePrice: "",
    saleCurrency: "",
    paymentMethod: "",
    deliveryStatus: "",
    deliveryDate: "",
    lossReason: "",
    lossNotes: "",
  };
  for (const field of OUTCOME_FIELDS[to]) {
    const raw = data.get(CLOSURE_FIELDS[field]);
    values[field] = typeof raw === "string" ? raw : "";
  }
  return values as ClosureValues;
}

type ClosureFormProps = Readonly<{
  to: ClosureOutcome;
  opportunityId: string;
  /** Etapa actual, para mostrar el pase. */
  stage: Stage;
  /** La unidad vinculada: la que se vende al ganar. */
  saleVehicle: SaleVehicle | null;
  /** Total de la cotización aceptada: precarga el precio al ganar. */
  acceptedQuoteTotal?: Money | null;
  /** Día de Asunción con que se abrió: acota la fecha de entrega. */
  today: string;
  /** Mientras guarda: nada se edita ni se reenvía. */
  pending: boolean;
  /** Última respuesta del servidor: errores por campo, lo cargado y aviso. */
  state: CloseOpportunityState;
  /** El pedido, ya validado en el navegador. */
  onSubmit: (formData: FormData) => void;
  /** A quién se cierra (p. ej. el cliente de la tarjeta del tablero). */
  subject?: string;
  /** Qué hacer si ganarla está bloqueado (sin unidad vinculada). */
  blockedHint?: ReactNode;
}>;

export function ClosureForm({
  to,
  opportunityId,
  stage,
  saleVehicle,
  acceptedQuoteTotal = null,
  today,
  pending,
  state,
  onSubmit,
  subject,
  blockedHint,
}: ClosureFormProps) {
  const [localErrors, setLocalErrors] = useState<ClosureErrors | null>(null);

  const blocked = to === "won" && saleVehicle === null;
  const errors: ClosureErrors =
    localErrors ??
    (!pending && state?.status === "invalid" ? state.errors : {});
  const echo =
    state?.status === "invalid" || state?.status === "failed"
      ? state.values
      : to === "won" && acceptedQuoteTotal
        ? {
            salePrice: formatAmount(acceptedQuoteTotal.amount),
            saleCurrency: acceptedQuoteTotal.currency,
          }
        : undefined;

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending || blocked) return;
    const form = event.currentTarget;
    const data = new FormData(form);
    const checked = parseClosure(to, closureValuesOf(data, to), today);
    if (!checked.ok) {
      setLocalErrors(checked.errors);
      // El foco va al primer campo con error, que lo anuncia.
      const first = OUTCOME_FIELDS[to].find((field) => checked.errors[field]);
      if (first) {
        form
          .querySelector<HTMLElement>(`[name="${CLOSURE_FIELDS[first]}"]`)
          ?.focus();
      }
      return;
    }
    setLocalErrors(null);
    onSubmit(data);
  }

  return (
    <form onSubmit={submit} noValidate aria-busy={pending}>
      <input
        type="hidden"
        name={CLOSURE_FIELDS.opportunityId}
        value={opportunityId}
      />
      <input type="hidden" name={CLOSURE_FIELDS.outcome} value={to} />
      <div className="flex max-h-[60vh] flex-col gap-3 overflow-y-auto px-5 pb-5">
        <p className="flex flex-wrap items-center gap-1 rounded-md border border-border-subtle bg-surface-2 px-3 py-2.5">
          {subject ? (
            <span className="mr-1 truncate text-label font-semibold text-text-primary">
              {subject}
            </span>
          ) : null}
          <span className="sr-only">Pasa de</span>
          <StageBadge stage={stage} />
          <span className="sr-only">a</span>
          <ChevronRightIcon
            aria-hidden="true"
            className="size-3.5 text-text-muted"
          />
          <StageBadge stage={to} />
        </p>
        <ClosureFields
          outcome={to}
          today={today}
          errors={errors}
          values={echo}
          saleVehicle={saleVehicle}
          disabled={pending}
        />
        {blocked && blockedHint ? blockedHint : null}
        <ClosureAlert state={pending ? null : state} />
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
          disabled={pending || blocked}
          className="disabled:cursor-wait disabled:opacity-70"
        >
          {pending ? CLOSURE_DIALOG_COPY[to].pending : STAGE_ACTION_LABELS[to]}
        </Button>
      </footer>
    </form>
  );
}

/** Aviso de una respuesta que deja el diálogo abierto. */
export function ClosureAlert({ state }: { state: CloseOpportunityState }) {
  const text =
    state?.status === "failed"
      ? "No pudimos cerrar la oportunidad. No se hizo ningún cambio: intentá de nuevo en unos minutos."
      : state?.status === "vehicle_required"
        ? "No se hizo ningún cambio: la oportunidad ya no tiene una unidad vinculada. Vinculá la unidad que se vende y volvé a intentar."
        : state?.status === "invalid"
          ? "Revisá los datos marcados. No se hizo ningún cambio."
          : null;
  if (!text) return null;
  return (
    <p
      role="alert"
      className="rounded-md border border-danger-border bg-danger-soft px-3 py-2 text-label text-danger"
    >
      {text}
    </p>
  );
}
