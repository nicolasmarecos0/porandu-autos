import { cn } from "@/components/ui/cn";
import { CheckIcon, CloseIcon } from "@/components/ui/icons";
import {
  TRADE_IN_STATUS_LABELS,
  type TradeInStatus,
} from "@/domains/opportunities/trade-ins";

/*
 * Lenguaje de estado de la toma de usados (Hito 20, DEC-052), con los
 * tokens de DEC-013. El color nunca es la única señal: cada chip lleva su
 * etiqueta.
 * - Pendiente de tasación: ámbar, espera al tasador.
 * - Tasado: marca, en manos del cliente.
 * - Aprobado por el cliente: verde, con check: entra al stock al ganar.
 * - Rechazado: rojo, con cruz.
 */

const CHIP: Readonly<Record<TradeInStatus, string>> = {
  pending: "border-warning-border bg-warning-soft text-warning",
  appraised: "border-brand-border bg-brand-soft text-brand-strong",
  accepted: "border-success-border bg-success-soft text-success",
  rejected: "border-danger-border bg-danger-soft text-danger",
};

const DOT: Readonly<Record<TradeInStatus, string>> = {
  pending: "bg-warning",
  appraised: "bg-brand",
  accepted: "bg-success",
  rejected: "bg-danger",
};

/** Canto izquierdo de la tarjeta. */
export const TRADE_IN_EDGE: Readonly<Record<TradeInStatus, string>> = {
  pending: "bg-warning",
  appraised: "bg-brand",
  accepted: "bg-success",
  rejected: "bg-danger",
};

export function TradeInStatusChip({ status }: { status: TradeInStatus }) {
  return (
    <span
      className={cn(
        "inline-flex h-6 shrink-0 items-center gap-1.5 rounded-sm border px-2 text-caption font-semibold whitespace-nowrap",
        CHIP[status],
      )}
    >
      {status === "accepted" ? (
        <CheckIcon className="size-3" strokeWidth={2.25} />
      ) : status === "rejected" ? (
        <CloseIcon className="size-3" strokeWidth={2.25} />
      ) : (
        <span
          aria-hidden="true"
          className={cn("size-1.5 rounded-full", DOT[status])}
        />
      )}
      {TRADE_IN_STATUS_LABELS[status]}
    </span>
  );
}
