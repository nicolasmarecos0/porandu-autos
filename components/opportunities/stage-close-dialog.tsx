"use client";

import {
  startTransition,
  useActionState,
  useState,
  type FormEvent,
} from "react";
import { Button } from "@/components/ui/button";
import {
  ConfirmDialog,
  ConfirmDialogCancel,
  ConfirmDialogContent,
  ConfirmDialogTrigger,
} from "@/components/ui/confirm-dialog";
import { ChevronRightIcon } from "@/components/ui/icons";
import {
  CLOSURE_FIELDS,
  OUTCOME_FIELDS,
  parseClosure,
  todayInAsuncion,
  type ClosureErrors,
  type ClosureOutcome,
  type ClosureValues,
} from "@/domains/opportunities/closure";
import { STAGE_ACTION_LABELS } from "@/domains/opportunities/labels";
import type { Stage } from "@/domains/opportunities/stages";
import { closeOpportunity } from "@/lib/opportunities/actions";
import type { CloseOpportunityState } from "@/lib/opportunities/closure";

import { ClosureFields, type SaleVehicle } from "./closure-fields";
import { StageBadge } from "./stage-badge";

/*
 * Confirmación de un cierre (DEC-034): marcar una oportunidad ganada o
 * perdida, con sus metadatos. Son etapas terminales, de las que no se
 * vuelve, y sus datos no se pueden corregir después, así que nunca se
 * ejecutan con un solo click: el diálogo pide los datos y la confirmación.
 *
 * - Ganada: la unidad vendida (la vinculada), precio final y moneda, forma
 *   de pago y entrega. Sin unidad vinculada no se ofrece confirmar.
 * - Perdida: motivo y notas opcionales.
 *
 * Valida antes de enviar con la misma validación del dominio (Zod) y avisa
 * por campo; el servidor la repite y es el que decide. No conoce la base:
 * envía a la Server Action closeOpportunity() la oportunidad, el resultado y
 * sus campos; la etapa de origen, la unidad y la regla las resuelve el
 * servidor. Mientras guarda, la confirmación no se cierra ni se reenvía. Un
 * dato inválido o una falla dejan el diálogo abierto, con lo cargado, para
 * corregir o reintentar; cualquier otra respuesta lo cierra y la avisa el
 * panel (onSettled).
 */

type StageCloseDialogProps = Readonly<{
  to: ClosureOutcome;
  opportunityId: string;
  /** Etapa actual, para mostrar el pase. */
  stage: Stage;
  /** La unidad vinculada: la que se vende al ganar. */
  saleVehicle: SaleVehicle | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Respuesta que cierra el diálogo: el panel la avisa. */
  onSettled: (state: Exclude<CloseOpportunityState, null>) => void;
  onCloseAutoFocus: (event: Event) => void;
}>;

const COPY = {
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

/** Respuestas que se corrigen o reintentan con el diálogo abierto. */
function staysOpen(state: CloseOpportunityState): boolean {
  return (
    state?.status === "invalid" ||
    state?.status === "failed" ||
    state?.status === "vehicle_required"
  );
}

/** Lo cargado en el formulario: solo los campos del resultado. */
function valuesOf(form: HTMLFormElement, to: ClosureOutcome): ClosureValues {
  const data = new FormData(form);
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

export function StageCloseDialog({
  to,
  opportunityId,
  stage,
  saleVehicle,
  open,
  onOpenChange,
  onSettled,
  onCloseAutoFocus,
}: StageCloseDialogProps) {
  const copy = COPY[to];
  // "Hoy" en Asunción, fijado al abrir: acota la fecha de entrega.
  const [today, setToday] = useState(() => todayInAsuncion(new Date()));
  const [localErrors, setLocalErrors] = useState<ClosureErrors | null>(null);
  const [state, action, pending] = useActionState<
    CloseOpportunityState,
    FormData
  >(async (previous, formData) => {
    const result = await closeOpportunity(previous, formData);
    if (result !== null && !staysOpen(result)) onSettled(result);
    return result;
  }, null);

  const blocked = to === "won" && saleVehicle === null;
  const errors: ClosureErrors =
    localErrors ??
    (!pending && state?.status === "invalid" ? state.errors : {});
  const echo =
    state?.status === "invalid" || state?.status === "failed"
      ? state.values
      : undefined;

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending || blocked) return;
    const form = event.currentTarget;
    const checked = parseClosure(to, valuesOf(form, to), today);
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
    const formData = new FormData(form);
    startTransition(() => action(formData));
  }

  return (
    <ConfirmDialog
      open={open}
      onOpenChange={(next) => {
        if (!next && pending) return;
        if (next) {
          setToday(todayInAsuncion(new Date()));
          setLocalErrors(null);
        }
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
        <form onSubmit={submit} noValidate aria-busy={pending}>
          <input
            type="hidden"
            name={CLOSURE_FIELDS.opportunityId}
            value={opportunityId}
          />
          <input type="hidden" name={CLOSURE_FIELDS.outcome} value={to} />
          <div className="flex max-h-[60vh] flex-col gap-3 overflow-y-auto px-5 pb-5">
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
            <ClosureFields
              outcome={to}
              today={today}
              errors={errors}
              values={echo}
              saleVehicle={saleVehicle}
              disabled={pending}
            />
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
              {pending ? copy.pending : STAGE_ACTION_LABELS[to]}
            </Button>
          </footer>
        </form>
      </ConfirmDialogContent>
    </ConfirmDialog>
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
