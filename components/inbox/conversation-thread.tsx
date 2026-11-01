import Link from "next/link";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/components/ui/cn";
import { ChevronLeftIcon } from "@/components/ui/icons";
import { Panel } from "@/components/ui/panel";
import type { InboxThread } from "@/domains/conversations/inbox";
import { formatCount } from "@/domains/dashboard/presentation";

import { MessageBubble } from "./message-bubble";
import { MessageComposer } from "./message-composer";
import { OpportunityStrip } from "./opportunity-strip";
import { ThreadLog } from "./thread-log";

/*
 * Columna derecha de la bandeja (Hito 8, DEC-040 §1; Hito 12, DEC-044): el
 * encabezado del contacto con la oportunidad a la que se suman los
 * mensajes, el historial por día, del mensaje más viejo al más nuevo, y el
 * composer al pie.
 *
 * - El historial usa `flex-col-reverse`: abre mostrando los mensajes más
 *   recientes sin JavaScript. El separador de cada día queda fijo arriba
 *   mientras se recorre ese día.
 * - No leídos (Hito 12B, DEC-044 §2): el separador "Mensajes nuevos" va
 *   antes del primer entrante sin leer, y el historial marca visto cuando
 *   está a la vista (ThreadLog).
 * - Debajo de `lg` es una pantalla propia (maestro/detalle, InboxView): el
 *   encabezado lleva "Volver" a la lista.
 * - Server Component; solo el log (que marca visto), el composer (los dos
 *   con `key` por conversación, para que no arrastren el estado de otra) y
 *   el menú de oportunidades son de cliente.
 */

export const INBOX_HREF = "/conversations";

/** Vuelve a la lista. Solo debajo de `lg`, donde la lista no está a la vista. */
function BackLink() {
  return (
    <Link
      href={INBOX_HREF}
      className="-ml-1.5 inline-flex size-9 shrink-0 items-center justify-center rounded-md text-text-secondary transition-colors hover:bg-surface-2 hover:text-text-primary focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-focus-ring lg:hidden"
    >
      <ChevronLeftIcon />
      <span className="sr-only">Volver a las conversaciones</span>
    </Link>
  );
}

function EmptyState({ title, body }: { title: string; body: string }) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-1 px-6 py-12 text-center">
      <p className="text-label font-semibold text-text-primary">{title}</p>
      <p className="max-w-sm text-label font-normal text-text-muted">{body}</p>
    </div>
  );
}

export function ConversationThread({
  thread,
  className,
}: {
  thread: InboxThread;
  /** Visibilidad por breakpoint: la decide InboxView. */
  className?: string;
}) {
  return (
    <section
      aria-labelledby="inbox-thread-heading"
      className={cn("min-h-0 min-w-0 flex-1 flex-col", className)}
    >
      <Panel className="flex min-h-0 flex-1 flex-col">
        {thread.kind === "found" ? (
          <>
            <header className="flex flex-col">
              <div className="flex h-14 items-center gap-3 border-b-2 border-brand px-3 sm:px-4">
                <BackLink />
                <Avatar
                  initials={thread.contact.initials}
                  size="md"
                  tone="brand"
                />
                <div className="flex min-w-0 flex-1 flex-col">
                  <h2
                    id="inbox-thread-heading"
                    className="truncate text-heading text-text-primary"
                  >
                    {thread.contact.name}
                  </h2>
                  {thread.contact.maskedPhone ? (
                    <p className="text-caption whitespace-nowrap text-text-muted tabular-nums">
                      {thread.contact.maskedPhone}
                    </p>
                  ) : null}
                </div>
                <Badge tone="success">WhatsApp</Badge>
              </div>
              <OpportunityStrip opportunity={thread.opportunity} />
            </header>
            <div className="flex min-h-0 flex-1 flex-col-reverse overflow-y-auto overscroll-contain bg-surface-2 px-3 py-4 sm:px-4">
              <ThreadLog
                key={thread.conversationId}
                conversationId={thread.conversationId}
                read={thread.read}
                label={`Historial con ${thread.contact.name}`}
                className="flex flex-col gap-4"
              >
                {thread.total > thread.shown ? (
                  <p className="text-center text-caption text-text-muted">
                    Mostrando los últimos {formatCount(thread.shown)} de{" "}
                    {formatCount(thread.total)} mensajes.
                  </p>
                ) : null}
                {thread.sections.length === 0 ? (
                  <p className="text-center text-label font-normal text-text-muted">
                    Todavía no hay mensajes en esta conversación.
                  </p>
                ) : (
                  thread.sections.map((section) => (
                    <div
                      key={section.key}
                      role="group"
                      aria-labelledby={`inbox-day-${section.key}`}
                      className="flex flex-col gap-2"
                    >
                      <h3
                        id={`inbox-day-${section.key}`}
                        className="sticky top-0 z-10 self-center rounded-full border border-border-subtle bg-surface-1 px-3 py-0.5 text-caption text-text-secondary shadow-sm"
                      >
                        {section.label}
                      </h3>
                      <ol className="flex flex-col">
                        {section.bubbles.map((bubble) => (
                          <MessageBubble key={bubble.id} bubble={bubble} />
                        ))}
                      </ol>
                    </div>
                  ))
                )}
              </ThreadLog>
            </div>
            <MessageComposer
              key={thread.conversationId}
              conversationId={thread.conversationId}
            />
          </>
        ) : (
          <>
            <header className="flex h-14 items-center gap-3 border-b-2 border-brand px-3 sm:px-4">
              <BackLink />
              <h2
                id="inbox-thread-heading"
                className="text-heading text-text-primary"
              >
                Historial
              </h2>
            </header>
            {thread.kind === "none" ? (
              <EmptyState
                title="Elegí una conversación"
                body="Elegí una conversación de la lista para ver el historial y responder por WhatsApp."
              />
            ) : (
              <EmptyState
                title="No encontramos la conversación"
                body="Puede que ya no esté activa o que no sea de esta organización. Elegí otra de la lista."
              />
            )}
          </>
        )}
      </Panel>
    </section>
  );
}
