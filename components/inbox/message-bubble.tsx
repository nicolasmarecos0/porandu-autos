import { cn } from "@/components/ui/cn";
import type { ThreadMessage } from "@/domains/conversations/inbox";

/*
 * Un mensaje del historial como burbuja de chat (Hito 8, DEC-040 §1). Los
 * entrantes (del cliente) van a la izquierda, en superficie blanca con
 * borde; los salientes (de un miembro), a la derecha, en el tono suave de
 * marca. La dirección también se dice en texto para lectores de pantalla:
 * el color nunca es la única señal (DEC-013).
 */

const DIRECTION_LABELS = {
  inbound: "Mensaje recibido",
  outbound: "Mensaje enviado",
} as const;

export function MessageBubble({ message }: { message: ThreadMessage }) {
  const outbound = message.direction === "outbound";
  return (
    <li
      data-direction={message.direction}
      className={cn("flex", outbound ? "justify-end" : "justify-start")}
    >
      <div
        className={cn(
          "flex max-w-[85%] flex-col gap-1 rounded-lg border px-3 py-2 shadow-sm sm:max-w-[70%]",
          outbound
            ? "rounded-br-xs border-brand-border bg-brand-soft"
            : "rounded-bl-xs border-border-default bg-surface-1",
        )}
      >
        <span className="sr-only">{DIRECTION_LABELS[message.direction]}</span>
        <p className="text-body break-words whitespace-pre-line text-text-primary">
          {message.body}
        </p>
        <p
          className={cn(
            "text-caption",
            outbound ? "self-end text-brand-strong" : "text-text-muted",
          )}
        >
          {message.author} · {message.at}
        </p>
      </div>
    </li>
  );
}
