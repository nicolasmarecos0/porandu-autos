import { cn } from "@/components/ui/cn";
import type { ThreadBubble } from "@/domains/conversations/thread-layout";

import { DeliveryMark } from "./delivery-mark";

/*
 * Un mensaje del historial como burbuja de chat (Hito 8, DEC-040 §1; Hito
 * 12, DEC-044 §1). Los entrantes (del cliente) van a la izquierda, en
 * superficie blanca con borde; los salientes (de un miembro), a la derecha,
 * en el tono suave de marca. La dirección también se dice en texto para
 * lectores de pantalla: el color nunca es la única señal (DEC-013).
 *
 * Las burbujas seguidas del mismo autor forman un grupo (threadSections()):
 * solo la primera muestra el autor y la cola, y van más juntas. Cada una
 * lleva su hora (el día lo dice la sección) y, si es saliente, su estado de
 * entrega.
 */

const DIRECTION_LABELS = {
  inbound: "Mensaje recibido",
  outbound: "Mensaje enviado",
} as const;

export function MessageBubble({ bubble }: { bubble: ThreadBubble }) {
  const outbound = bubble.direction === "outbound";
  const startsGroup =
    bubble.position === "single" || bubble.position === "first";
  return (
    <li
      data-direction={bubble.direction}
      data-position={bubble.position}
      className={cn(
        "flex",
        outbound ? "justify-end" : "justify-start",
        startsGroup ? "mt-2 first:mt-0" : "mt-0.5",
      )}
    >
      <div
        className={cn(
          "flex max-w-[85%] flex-col gap-0.5 rounded-lg border px-3 pt-1.5 pb-1 shadow-sm sm:max-w-[70%]",
          outbound
            ? "border-brand-border bg-brand-soft"
            : "border-border-default bg-surface-1",
          startsGroup && (outbound ? "rounded-tr-xs" : "rounded-tl-xs"),
        )}
      >
        <span className="sr-only">{DIRECTION_LABELS[bubble.direction]}</span>
        <p
          className={cn(
            "text-caption",
            outbound ? "text-brand-strong" : "text-text-secondary",
            startsGroup ? null : "sr-only",
          )}
        >
          {bubble.author}
        </p>
        <p className="text-body break-words whitespace-pre-line text-text-primary">
          {bubble.body}
        </p>
        <p
          className={cn(
            "flex items-center gap-1.5 self-end text-caption tabular-nums",
            outbound ? "text-brand-strong" : "text-text-muted",
          )}
        >
          <time dateTime={bubble.dateTime} title={bubble.at}>
            {bubble.time}
          </time>
          {bubble.delivery ? <DeliveryMark status={bubble.delivery} /> : null}
        </p>
      </div>
    </li>
  );
}
