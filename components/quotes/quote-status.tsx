import { cn } from "@/components/ui/cn";
import { CheckIcon, CloseIcon } from "@/components/ui/icons";
import {
  quoteDisplayLabel,
  type QuoteDisplayStatus,
} from "@/domains/quotes/statuses";

/*
 * Lenguaje de estado de las cotizaciones (Hito 10, DEC-042 §2), con los
 * tokens de DEC-013. El color nunca es la única señal: cada chip lleva su
 * etiqueta.
 * - Borrador: neutro, todavía sin aprobar.
 * - Aprobada: marca suave, lista para entregar.
 * - Enviada: marca, en manos del cliente.
 * - Aceptada: verde, con check.
 * - Rechazada: rojo, con cruz.
 * - Anulada: gris, contorno punteado y cruz: nunca se lee como activa.
 * - Vencida (derivada): ámbar, una alerta comercial.
 */

const CHIP: Readonly<Record<QuoteDisplayStatus, string>> = {
  draft: "border-border-default bg-surface-2 text-text-secondary",
  approved: "border-brand-border bg-surface-1 text-brand-strong",
  sent: "border-brand-border bg-brand-soft text-brand-strong",
  accepted: "border-success-border bg-success-soft text-success",
  rejected: "border-danger-border bg-danger-soft text-danger",
  withdrawn:
    "border-dashed border-border-strong bg-transparent text-text-muted",
  expired: "border-warning-border bg-warning-soft text-warning",
};

const DOT: Readonly<Record<QuoteDisplayStatus, string>> = {
  draft: "bg-text-muted",
  approved: "bg-brand",
  sent: "bg-brand",
  accepted: "bg-success",
  rejected: "bg-danger",
  withdrawn: "bg-border-strong",
  expired: "bg-warning",
};

/** Canto izquierdo de la tarjeta. */
export const QUOTE_EDGE: Readonly<Record<QuoteDisplayStatus, string>> = {
  draft: "bg-border-strong",
  approved: "bg-brand/60",
  sent: "bg-brand",
  accepted: "bg-success",
  rejected: "bg-danger",
  withdrawn: "bg-border-default",
  expired: "bg-warning",
};

export function QuoteStatusChip({ status }: { status: QuoteDisplayStatus }) {
  return (
    <span
      className={cn(
        "inline-flex h-6 shrink-0 items-center gap-1.5 rounded-sm border px-2 text-caption font-semibold whitespace-nowrap",
        CHIP[status],
      )}
    >
      {status === "accepted" ? (
        <CheckIcon className="size-3" strokeWidth={2.25} />
      ) : status === "rejected" || status === "withdrawn" ? (
        <CloseIcon className="size-3" strokeWidth={2.25} />
      ) : (
        <span
          aria-hidden="true"
          className={cn("size-1.5 rounded-full", DOT[status])}
        />
      )}
      {quoteDisplayLabel(status)}
    </span>
  );
}
