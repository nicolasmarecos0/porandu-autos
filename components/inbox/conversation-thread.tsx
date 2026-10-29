import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/components/ui/cn";
import { Panel, PanelHeader } from "@/components/ui/panel";
import type { InboxThread } from "@/domains/conversations/inbox";
import { formatCount } from "@/domains/dashboard/presentation";

import { MessageBubble } from "./message-bubble";
import { MessageComposer } from "./message-composer";

/*
 * Columna derecha de la bandeja (Hito 8, DEC-040 §1): el historial de la
 * conversación elegida, del mensaje más viejo al más nuevo, y el composer al
 * pie. El contenedor del historial usa `flex-col-reverse`: abre mostrando
 * los mensajes más recientes sin JavaScript. Server Component; solo el
 * composer es de cliente, con `key` por conversación para que no arrastre
 * lo escrito de otra.
 */

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
  className?: string;
}) {
  return (
    <section
      aria-labelledby="inbox-thread-heading"
      className={cn("flex min-h-0 min-w-0 flex-1 flex-col", className)}
    >
      <Panel className="flex min-h-[28rem] flex-1 flex-col lg:min-h-0">
        {thread.kind === "found" ? (
          <>
            <PanelHeader>
              <Avatar initials={thread.contact.initials} tone="brand" />
              <h2
                id="inbox-thread-heading"
                className="min-w-0 truncate text-heading text-text-primary"
              >
                {thread.contact.name}
              </h2>
              {thread.contact.maskedPhone ? (
                <span className="shrink-0 text-caption whitespace-nowrap text-text-muted tabular-nums">
                  {thread.contact.maskedPhone}
                </span>
              ) : null}
              <Badge tone="success" className="ml-auto">
                WhatsApp
              </Badge>
            </PanelHeader>
            <div className="flex min-h-0 flex-1 flex-col-reverse overflow-y-auto bg-surface-2 px-4 py-4">
              <div className="flex flex-col gap-3">
                {thread.total > thread.messages.length ? (
                  <p className="text-center text-caption text-text-muted">
                    Mostrando los últimos {formatCount(thread.messages.length)}{" "}
                    de {formatCount(thread.total)} mensajes.
                  </p>
                ) : null}
                {thread.messages.length === 0 ? (
                  <p className="text-center text-label font-normal text-text-muted">
                    Todavía no hay mensajes en esta conversación.
                  </p>
                ) : (
                  <ol
                    aria-label={`Historial con ${thread.contact.name}`}
                    className="flex flex-col gap-2"
                  >
                    {thread.messages.map((message) => (
                      <MessageBubble key={message.id} message={message} />
                    ))}
                  </ol>
                )}
              </div>
            </div>
            <MessageComposer
              key={thread.conversationId}
              conversationId={thread.conversationId}
            />
          </>
        ) : (
          <>
            <PanelHeader>
              <h2
                id="inbox-thread-heading"
                className="text-heading text-text-primary"
              >
                Historial
              </h2>
            </PanelHeader>
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
