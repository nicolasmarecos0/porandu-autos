"use client";

import { useActionState, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  ConfirmDialog,
  ConfirmDialogCancel,
  ConfirmDialogContent,
} from "@/components/ui/confirm-dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ChevronRightIcon, MoreIcon } from "@/components/ui/icons";
import type { QuoteCardView } from "@/domains/quotes/presentation";
import { QUOTE_STATUS_CHANGE_FIELDS } from "@/domains/quotes/request";
import {
  QUOTE_ACTION_LABELS,
  QUOTE_STATUS_LABELS,
  type QuoteStatus,
} from "@/domains/quotes/statuses";
import { changeQuoteStatus } from "@/lib/quotes/actions";
import type { ChangeQuoteStatusState } from "@/lib/quotes/requests";

import { QuoteStatusChip } from "./quote-status";

/*
 * Acciones de estado de una cotización (Hito 10, DEC-042 §9): el siguiente
 * paso del ciclo como botón, rechazar y anular en un menú, y la
 * confirmación de cada cambio (alertdialog de Radix, DEC-028 §8). Las usan
 * la tarjeta del panel "Cotizaciones" y la vista previa del presupuesto
 * (Hito 14, DEC-046 §6), para aprobar o marcar enviada sin volver a la
 * lista.
 *
 * Solo ofrece los destinos que la máquina de estados permite hoy al que
 * mira (QuoteCardView.transitions). No conoce la base: envía id, estado de
 * partida y destino a la Server Action changeQuoteStatus(), que vuelve a
 * validar todo. Con una respuesta definitiva la confirmación se cierra y la
 * página ya está revalidada; una falla la deja abierta, con lo que pasó,
 * para reintentar. Si otra persona ya la había movido, avisa con
 * `onNotice()` (el que la usa decide dónde mostrarlo).
 */

type ConfirmCopy = Readonly<{
  title: string;
  description: string;
  cta: string;
  tone: "primary" | "danger";
}>;

const CONFIRM_COPY: Readonly<
  Record<Exclude<QuoteStatus, "draft">, ConfirmCopy>
> = {
  approved: {
    title: "Aprobar cotización",
    description:
      "Revisá precio, descuento y validez. Aprobada, queda lista para entregar al cliente y sus condiciones no cambian.",
    cta: "Aprobar",
    tone: "primary",
  },
  sent: {
    title: "Marcar como enviada",
    description:
      "Registrá que le entregaste la cotización al cliente. Porandú no le envía nada: esto solo deja constancia.",
    cta: "Marcar enviada",
    tone: "primary",
  },
  accepted: {
    title: "Registrar que el cliente aceptó",
    description:
      "La cotización queda aceptada y no se puede deshacer. La oportunidad no se cierra sola: marcala como ganada cuando se concrete la venta.",
    cta: "Cliente aceptó",
    tone: "primary",
  },
  rejected: {
    title: "Registrar que el cliente rechazó",
    description:
      "La cotización queda rechazada y no se puede deshacer. Podés crear otra con nuevas condiciones.",
    cta: "Cliente rechazó",
    tone: "danger",
  },
  withdrawn: {
    title: "Anular cotización",
    description:
      "La cotización deja de valer y no se puede deshacer. Para corregirla, creá una nueva.",
    cta: "Anular",
    tone: "danger",
  },
};

/** Acciones que van al menú y no como botón principal. */
const SECONDARY: readonly QuoteStatus[] = ["rejected", "withdrawn"];

const RESULT_MESSAGES: Partial<
  Record<NonNullable<ChangeQuoteStatusState>["status"], string>
> = {
  not_found: "No encontramos la cotización. Puede que ya no exista.",
  invalid_transition: "Ese cambio ya no está disponible para esta cotización.",
  expired:
    "La cotización venció: ya no se puede aprobar, enviar ni aceptar. Creá una nueva.",
  opportunity_closed:
    "La oportunidad ya no está abierta para cotizar: solo se puede rechazar o anular.",
  vehicle_unavailable:
    "La unidad ya no está en stock: no se puede aceptar esta cotización.",
  requires_admin: "El descuento supera el 10 %: solo un admin puede aprobarla.",
  already_accepted:
    "La oportunidad ya tiene otra cotización aceptada. No se hizo ningún cambio.",
  failed:
    "No pudimos guardar el cambio. No se modificó nada: intentá de nuevo en unos minutos.",
};

type ActionableStatus = Exclude<QuoteStatus, "draft">;

export function QuoteStatusActions({
  quote,
  onNotice,
  primaryVariant = "primary",
}: {
  quote: QuoteCardView;
  /** Aviso para mostrar junto a la cotización; null lo limpia. */
  onNotice?: (notice: string | null) => void;
  /**
   * Variante del siguiente paso. `secondary` cuando otra acción de la misma
   * barra es la principal (p. ej. "Descargar PDF" en la vista previa).
   */
  primaryVariant?: "primary" | "secondary";
}) {
  const [target, setTarget] = useState<ActionableStatus | null>(null);
  // Falla del intento en curso: se limpia al abrir otra confirmación.
  const [failure, setFailure] = useState<string | null>(null);
  const returnFocusRef = useRef<HTMLButtonElement>(null);

  const [, action, pending] = useActionState<ChangeQuoteStatusState, FormData>(
    async (previous, formData) => {
      const result = await changeQuoteStatus(previous, formData);
      if (result?.status === "changed") {
        setTarget(null);
        onNotice?.(null);
      } else if (result?.status === "unchanged") {
        setTarget(null);
        onNotice?.(
          `Otra persona ya la había movido: está ${QUOTE_STATUS_LABELS[
            result.current
          ].toLowerCase()}.`,
        );
      } else if (result !== null) {
        setFailure(RESULT_MESSAGES[result.status] ?? null);
      }
      return result;
    },
    null,
  );

  const actionable = quote.transitions.filter(
    (to): to is ActionableStatus => to !== "draft",
  );
  const primary = actionable.find((to) => !SECONDARY.includes(to));
  const secondary = actionable.filter((to) => to !== primary);
  const copy = target ? CONFIRM_COPY[target] : undefined;
  const errorMessage = pending ? null : failure;

  const open = (to: ActionableStatus) => {
    setFailure(null);
    setTarget(to);
  };

  return (
    <>
      {actionable.length > 0 ? (
        <div className="flex shrink-0 items-center gap-1.5">
          {primary ? (
            <Button
              variant={primaryVariant}
              ref={returnFocusRef}
              onClick={() => open(primary)}
            >
              {QUOTE_ACTION_LABELS[primary]}
            </Button>
          ) : null}
          {secondary.length > 0 ? (
            // No modal: la confirmación que abre un ítem es su propio
            // modal. Con dos modales encadenados, Radix deja el body sin
            // pointer-events al cerrar la confirmación.
            <DropdownMenu modal={false}>
              <DropdownMenuTrigger asChild>
                <button
                  ref={primary ? undefined : returnFocusRef}
                  type="button"
                  aria-label={`Más acciones de la cotización ${quote.numberLabel}`}
                  className="flex size-8 shrink-0 items-center justify-center rounded-md border border-border-default bg-surface-1 text-text-secondary transition-colors hover:border-border-strong hover:bg-surface-2 hover:text-text-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring data-[state=open]:bg-surface-2 data-[state=open]:text-text-primary"
                >
                  <MoreIcon className="size-4" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent>
                <DropdownMenuLabel>Cambiar estado</DropdownMenuLabel>
                {secondary.map((to) => (
                  <DropdownMenuItem
                    key={to}
                    tone={
                      CONFIRM_COPY[to].tone === "danger" ? "danger" : "neutral"
                    }
                    onSelect={() => open(to)}
                  >
                    {QUOTE_ACTION_LABELS[to]}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          ) : null}
        </div>
      ) : null}

      <ConfirmDialog
        open={target !== null}
        onOpenChange={(next) => {
          if (!next && pending) return;
          if (!next) setTarget(null);
        }}
      >
        {copy && target ? (
          <ConfirmDialogContent
            title={copy.title}
            description={copy.description}
            onEscapeKeyDown={(event) => {
              if (pending) event.preventDefault();
            }}
            onCloseAutoFocus={(event) => {
              // Tras un cambio, la cotización se vuelve a renderizar con sus
              // acciones nuevas: el foco vuelve a la acción si sigue.
              event.preventDefault();
              returnFocusRef.current?.focus();
            }}
          >
            <form action={action} aria-busy={pending}>
              <input
                type="hidden"
                name={QUOTE_STATUS_CHANGE_FIELDS.quoteId}
                value={quote.id}
              />
              <input
                type="hidden"
                name={QUOTE_STATUS_CHANGE_FIELDS.from}
                value={quote.status}
              />
              <input
                type="hidden"
                name={QUOTE_STATUS_CHANGE_FIELDS.to}
                value={target}
              />
              <div className="flex flex-col gap-3 px-5 pb-5">
                <div className="flex flex-col gap-2.5 rounded-md border border-border-subtle bg-surface-2 px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between sm:gap-3">
                  <div className="min-w-0">
                    <p className="text-label text-text-primary tabular-nums">
                      {quote.numberLabel} · {quote.totalLabel}
                    </p>
                    <p className="truncate text-caption text-text-muted">
                      {quote.vehicleLabel} · válida hasta{" "}
                      {quote.validUntilLabel}
                    </p>
                  </div>
                  <p className="flex shrink-0 items-center gap-1">
                    <span className="sr-only">Pasa de</span>
                    <QuoteStatusChip status={quote.status} />
                    <span className="sr-only">a</span>
                    <ChevronRightIcon
                      aria-hidden="true"
                      className="size-3.5 text-text-muted"
                    />
                    <QuoteStatusChip status={target} />
                  </p>
                </div>
                {errorMessage ? (
                  <p
                    role="alert"
                    className="rounded-md border border-danger-border bg-danger-soft px-3 py-2 text-label text-danger"
                  >
                    {errorMessage}
                  </p>
                ) : null}
              </div>
              <footer className="flex flex-col-reverse gap-2 rounded-b-lg border-t border-border-subtle bg-surface-2 px-5 py-3 sm:flex-row sm:justify-end">
                <ConfirmDialogCancel asChild>
                  <Button variant="secondary" disabled={pending}>
                    Volver
                  </Button>
                </ConfirmDialogCancel>
                <Button
                  type="submit"
                  variant={copy.tone}
                  disabled={pending}
                  className="disabled:cursor-wait disabled:opacity-70"
                >
                  {pending ? "Guardando…" : copy.cta}
                </Button>
              </footer>
            </form>
          </ConfirmDialogContent>
        ) : null}
      </ConfirmDialog>
    </>
  );
}
