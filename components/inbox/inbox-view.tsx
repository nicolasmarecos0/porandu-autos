import { PageHeader } from "@/components/shell/page-header";
import type { Inbox } from "@/domains/conversations/inbox";

import { ConversationList } from "./conversation-list";
import { ConversationThread } from "./conversation-thread";

/**
 * Bandeja de /conversations (Hito 8, DEC-040 §1): dos columnas.
 *
 *   ┌──────────────── Conversaciones ─────────────────────────────┐
 *   │ Conversaciones activas 12 │ (RB) Ramón Benítez  +595 ··· 214│
 *   │ ▌Ramón Benítez     12:32  │  ┌──────────────────┐           │
 *   │   ¿Sigue disponible…      │  │ ¿Sigue disponible│           │
 *   │  Ana Ríos          ayer   │  └──────────────────┘           │
 *   │   Gracias                 │           ┌─────────────────┐   │
 *   │                           │           │ Sí, te paso…    │   │
 *   │                           │           └─────────────────┘   │
 *   │                           │ [Escribí una respuesta…] Enviar │
 *   └───────────────────────────┴─────────────────────────────────┘
 *
 * En desktop cada columna tiene scroll propio; debajo de `lg` se apilan.
 */
export function InboxView({ title, inbox }: { title: string; inbox: Inbox }) {
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PageHeader title={title} />
      <div className="flex min-h-0 flex-1 flex-col gap-section overflow-y-auto p-gutter lg:flex-row lg:overflow-hidden">
        <ConversationList
          conversations={inbox.conversations}
          total={inbox.total}
          selectedId={inbox.selectedId}
          className="max-h-[50vh] lg:max-h-none lg:w-context-rail lg:shrink-0"
        />
        <ConversationThread thread={inbox.thread} />
      </div>
    </div>
  );
}
