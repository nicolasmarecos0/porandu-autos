"use client";

import { useActionState, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/components/ui/cn";
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
import {
  ChevronRightIcon,
  LockIcon,
  MoreIcon,
  SteeringIcon,
} from "@/components/ui/icons";
import type { QuoteCardView } from "@/domains/quotes/presentation";
import { QUOTE_STATUS_CHANGE_FIELDS } from "@/domains/quotes/request";
import {
  QUOTE_ACTION_LABELS,
  QUOTE_STATUS_LABELS,
  type QuoteStatus,
} from "@/domains/quotes/statuses";
import { changeQuoteStatus } from "@/lib/quotes/actions";
import type { ChangeQuoteStatusState } from "@/lib/quotes/requests";

import { QUOTE_EDGE, QuoteStatusChip } from "./quote-status";

/*
 * Tarjeta de una cotización en /opportunities/[id] (Hito 10, DEC-042 §9):
 * número, estado, unidad, desglose de precio (lista, descuento y total),
 * validez, quién la creó y quién la aprobó, condiciones y las acciones que
 * la máquina de estados permite hoy al que mira.
 *
 *   ┃ N.º 0007  [● Borrador]                          [Aprobar] [⋯]
 *   ┃ 🚙 Toyota Hilux 2024
 *   ┃ Precio de lista       USD 49.900
 *   ┃ Descuento (7,5 %)     − USD 3.742,50
 *   ┃ Total                 USD 46.157,50
 *   ┃ Válida hasta 8 nov 2026 · Vos · 1 nov 2026 10:02
 *
 * Cada cambio de estado pasa por una confirmación: tiene significado
 * comercial y los estados terminales no se reabren. La acción principal
 * (el siguiente paso del ciclo) va como botón; rechazar y anular, en el
 * menú. No conoce la base: envía id, estado de partida y destino a la
 * Server Action changeQuoteStatus(), que vuelve a validar todo. Con una
 * respuesta definitiva la confirmación se cierra y la página ya está
 * revalidada; una falla la deja abierta, con lo que pasó, para reintentar.
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

function PriceRow({
  label,
  value,
  emphasis = false,
  tone = "default",
}: {
  label: string;
  value: string;
  emphasis?: boolean;
  tone?: "default" | "discount";
}) {
  return (
    <div
      className={cn(
        "flex items-baseline justify-between gap-4",
        emphasis && "border-t border-border-subtle pt-2",
      )}
    >
      <dt
        className={cn(
          "text-label",
          emphasis ? "font-semibold text-text-primary" : "text-text-secondary",
        )}
      >
        {label}
      </dt>
      <dd
        className={cn(
          "text-right tabular-nums",
          emphasis
            ? "text-title font-semibold text-text-primary"
            : "text-body text-text-primary",
          tone === "discount" && "text-success",
        )}
      >
        {value}
      </dd>
    </div>
  );
}

export function QuoteCard({ quote }: { quote: QuoteCardView }) {
  const [target, setTarget] = useState<Exclude<QuoteStatus, "draft"> | null>(
    null,
  );
  const [notice, setNotice] = useState<string | null>(null);
  // Falla del intento en curso: se limpia al abrir otra confirmación.
  const [failure, setFailure] = useState<string | null>(null);
  const returnFocusRef = useRef<HTMLButtonElement>(null);

  const [, action, pending] = useActionState<ChangeQuoteStatusState, FormData>(
    async (previous, formData) => {
      const result = await changeQuoteStatus(previous, formData);
      if (result?.status === "changed") {
        setTarget(null);
        setNotice(null);
      } else if (result?.status === "unchanged") {
        setTarget(null);
        setNotice(
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
    (to): to is Exclude<QuoteStatus, "draft"> => to !== "draft",
  );
  const primary = actionable.find((to) => !SECONDARY.includes(to));
  const secondary = actionable.filter((to) => to !== primary);
  const copy = target ? CONFIRM_COPY[target] : undefined;
  const errorMessage = pending ? null : failure;
  const closed = quote.status === "withdrawn" || quote.status === "rejected";

  const open = (to: Exclude<QuoteStatus, "draft">) => {
    setFailure(null);
    setTarget(to);
  };

  return (
    <article
      aria-label={`Cotización ${quote.numberLabel}, ${quote.displayLabel}, total ${quote.totalLabel}`}
      className="relative flex overflow-hidden rounded-md border border-border-subtle bg-surface-1 shadow-card transition-[border-color,box-shadow] duration-150 ease-out-strong hover:border-border-default hover:shadow-md"
    >
      <span
        aria-hidden="true"
        className={cn("w-1 shrink-0", QUOTE_EDGE[quote.displayStatus])}
      />
      <div className="flex min-w-0 flex-1 flex-col gap-3 p-3.5 sm:p-4">
        <header className="flex flex-wrap items-start justify-between gap-x-3 gap-y-2">
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <h3 className="text-heading text-text-primary tabular-nums">
              {quote.numberLabel}
            </h3>
            <QuoteStatusChip status={quote.displayStatus} />
          </div>
          {actionable.length > 0 ? (
            <div className="flex shrink-0 items-center gap-1.5">
              {primary ? (
                <Button
                  variant="primary"
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
                          CONFIRM_COPY[to].tone === "danger"
                            ? "danger"
                            : "neutral"
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
        </header>

        <p className="flex items-start gap-1.5 text-label text-text-secondary">
          <SteeringIcon
            aria-hidden="true"
            className="mt-px size-3.5 shrink-0 text-text-muted"
          />
          <span className="[font-feature-settings:'calt'_0] break-words">
            {quote.vehicleLabel}
          </span>
        </p>

        <dl
          className={cn(
            "flex flex-col gap-1.5 rounded-md border border-border-subtle bg-surface-2 px-3 py-2.5",
            closed && "opacity-70",
          )}
        >
          <PriceRow label="Precio de lista" value={quote.listPriceLabel} />
          {quote.discount ? (
            <PriceRow
              label={`Descuento (${quote.discount.effectiveLabel})`}
              value={quote.discount.amountLabel}
              tone="discount"
            />
          ) : (
            <PriceRow label="Descuento" value="Sin descuento" />
          )}
          <PriceRow label="Total" value={quote.totalLabel} emphasis />
        </dl>

        {quote.notes ? (
          <p className="text-label whitespace-pre-line text-text-secondary">
            {quote.notes}
          </p>
        ) : null}

        <div className="flex flex-col gap-0.5 text-caption text-text-muted sm:flex-row sm:flex-wrap sm:gap-x-3">
          <span>
            Válida hasta{" "}
            <time dateTime={quote.validUntil} className="tabular-nums">
              {quote.validUntilLabel}
            </time>
          </span>
          <span>Creó: {quote.createdLabel}</span>
          {quote.approvedLabel ? <span>{quote.approvedLabel}</span> : null}
        </div>

        {quote.approvalHint ? (
          <p className="flex items-start gap-1.5 rounded-sm border border-warning-border bg-warning-soft px-2 py-1.5 text-caption text-warning">
            <LockIcon aria-hidden="true" className="mt-px size-3.5 shrink-0" />
            {quote.approvalHint}
          </p>
        ) : null}

        {notice ? (
          <p
            role="status"
            className="rounded-sm border border-brand-border bg-brand-soft px-2 py-1.5 text-caption text-brand-strong"
          >
            {notice}
          </p>
        ) : null}
      </div>

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
              // Tras un cambio, la tarjeta se vuelve a renderizar con sus
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
    </article>
  );
}
