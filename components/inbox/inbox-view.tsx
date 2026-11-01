import { cn } from "@/components/ui/cn";
import { PageHeader } from "@/components/shell/page-header";
import type { Inbox } from "@/domains/conversations/inbox";

import { ConversationList } from "./conversation-list";
import { ConversationThread } from "./conversation-thread";

/**
 * Bandeja de /conversations (Hito 8, DEC-040 §1; Hito 12, DEC-044 §5).
 *
 * Desde `lg`, dos columnas con scroll propio:
 *
 *   ┌──────────────── Conversaciones ─────────────────────────────┐
 *   │ Conversaciones activas 12 │ (RB) Ramón Benítez     WhatsApp │
 *   │ ▌Ramón Benítez     12:32  │      +595 ··· 214               │
 *   │   ¿Sigue disponible…      │ Oportunidad abierta: En negoc…  │
 *   │  Ana Ríos           Ayer  │             ( Hoy )             │
 *   │   Gracias                 │  ┌──────────────────┐           │
 *   │                           │  │ ¿Sigue disponible│           │
 *   │                           │  └──────────────────┘           │
 *   │                           │           ┌─────────────────┐   │
 *   │                           │           │ Sí, te paso…  ✓ │   │
 *   │                           │           └─────────────────┘   │
 *   │                           │ [Escribí una respuesta…] Enviar │
 *   └───────────────────────────┴─────────────────────────────────┘
 *
 * Debajo de `lg`, maestro/detalle: una pantalla por vez, según la URL. Sin
 * `?c=` se ve la lista; al tocar una conversación (`?c=<id>`) se ve el chat,
 * con "Volver" a la lista. Sin JavaScript: lo decide el servidor con la
 * misma URL que comparten las dos vistas, así que el botón atrás del
 * teléfono también vuelve a la lista.
 */
export function InboxView({ title, inbox }: { title: string; inbox: Inbox }) {
  const showingThread = inbox.thread.kind !== "none";
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PageHeader title={title} />
      <div
        data-pane={showingThread ? "thread" : "list"}
        className="flex min-h-0 flex-1 gap-section overflow-hidden p-2 sm:p-gutter"
      >
        <ConversationList
          conversations={inbox.conversations}
          total={inbox.total}
          selectedId={inbox.selectedId}
          className={cn(
            "w-full lg:flex lg:w-context-rail lg:shrink-0",
            showingThread ? "hidden" : "flex",
          )}
        />
        <ConversationThread
          thread={inbox.thread}
          className={showingThread ? "flex" : "hidden lg:flex"}
        />
      </div>
    </div>
  );
}
