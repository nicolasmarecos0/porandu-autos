import { cn } from "@/components/ui/cn";
import { CheckIcon } from "@/components/ui/icons";
import {
  DELIVERY_RECORD_STATUS_LABELS,
  type DeliveryRecordStatus,
} from "@/domains/opportunities/deliveries";

/*
 * Lenguaje de estado de la entrega (Hito 21, DEC-053), con los tokens de
 * DEC-013. El color nunca es la única señal: cada chip lleva su etiqueta.
 * - Entrega programada: marca, en preparación frente al cliente.
 * - Entregada: verde, con check: la unidad salió del salón.
 */

const CHIP: Readonly<Record<DeliveryRecordStatus, string>> = {
  pending: "border-brand-border bg-brand-soft text-brand-strong",
  completed: "border-success-border bg-success-soft text-success",
};

export function DeliveryStatusChip({
  status,
}: {
  status: DeliveryRecordStatus;
}) {
  return (
    <span
      className={cn(
        "inline-flex h-6 shrink-0 items-center gap-1.5 rounded-sm border px-2 text-caption font-semibold whitespace-nowrap",
        CHIP[status],
      )}
    >
      {status === "completed" ? (
        <CheckIcon className="size-3" strokeWidth={2.25} />
      ) : (
        <span aria-hidden="true" className="size-1.5 rounded-full bg-brand" />
      )}
      {DELIVERY_RECORD_STATUS_LABELS[status]}
    </span>
  );
}
