import { cn } from "@/components/ui/cn";
import { Tooltip } from "@/components/ui/tooltip";
import type { UnreadState } from "@/domains/conversations/read-state";

/*
 * Contador de no leídos de una conversación de la bandeja (Hito 12B, DEC-044
 * §2.8): los entrantes que quien mira todavía no vio, "99+" desde 100.
 *
 * - El número es decorativo para lectores de pantalla: el texto ("3
 *   mensajes sin leer") va junto, así que el enlace de la conversación lo
 *   anuncia entero. El color de marca es énfasis (DEC-013), nunca la única
 *   señal.
 * - El tooltip de Radix (components/ui/tooltip) dice lo mismo al pasar el
 *   puntero, también la cantidad exacta detrás de "99+". Necesita un
 *   TooltipProvider arriba (la lista lo pone). El disparador no es
 *   enfocable: vive dentro del enlace de la conversación y no agrega una
 *   parada de tabulación.
 * - Leída, no muestra nada.
 *
 * Server Component: el tooltip es la única parte de cliente.
 */
export function UnreadBadge({
  unread,
  className,
}: {
  unread: UnreadState;
  className?: string;
}) {
  if (unread.kind === "read") return null;
  return (
    <Tooltip content={unread.description} side="left">
      <span
        data-unread={unread.count}
        className={cn(
          "inline-flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full bg-brand px-1.5 text-caption font-semibold text-brand-contrast tabular-nums shadow-sm",
          className,
        )}
      >
        <span aria-hidden="true">{unread.label}</span>
        <span className="sr-only">{unread.description}</span>
      </span>
    </Tooltip>
  );
}
