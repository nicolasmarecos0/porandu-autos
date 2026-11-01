import { cn } from "@/components/ui/cn";
import { AlertIcon, CheckIcon, DoubleCheckIcon } from "@/components/ui/icons";
import {
  DELIVERY_STATUS_LABELS,
  type DeliveryStatus,
} from "@/domains/conversations/delivery";

/*
 * Estado de entrega de un saliente (Hito 12, DEC-044 §3): una tilde
 * (Enviado), dos (Entregado o Leído) o una alerta (No entregado). El ícono
 * es decorativo y el estado va siempre en texto: el color nunca es la única
 * señal (DEC-013). Solo "No entregado" usa un tono de estado, junto a su
 * texto, porque pide atención.
 *
 * Desde el Hito 12C es el estado real que informó WhatsApp: el vigente de
 * los recibidos (currentDeliveryStatus(), en el dominio), así que un "No
 * entregado" que llega tarde nunca reemplaza a un "Entregado" o "Leído".
 */

const ICONS = {
  sent: CheckIcon,
  delivered: DoubleCheckIcon,
  read: DoubleCheckIcon,
  failed: AlertIcon,
} as const satisfies Record<DeliveryStatus, unknown>;

export function DeliveryMark({ status }: { status: DeliveryStatus }) {
  const Icon = ICONS[status];
  return (
    <span
      data-delivery={status}
      className={cn(
        "inline-flex items-center gap-0.5",
        status === "failed" ? "font-semibold text-danger" : null,
      )}
    >
      <Icon width={14} height={14} strokeWidth={2} />
      {DELIVERY_STATUS_LABELS[status]}
    </span>
  );
}
