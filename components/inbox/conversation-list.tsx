import Link from "next/link";
import { Avatar } from "@/components/ui/avatar";
import { cn } from "@/components/ui/cn";
import { Panel, PanelHeader } from "@/components/ui/panel";
import { formatCount } from "@/domains/dashboard/presentation";
import type { InboxItem } from "@/domains/conversations/inbox";

/*
 * Columna izquierda de la bandeja (Hito 8, DEC-040 §1): las conversaciones
 * activas de la organización, de la más reciente a la más vieja, tal como
 * llegan del loader. Cada una es un enlace que elige la conversación en la
 * URL (`?c=<id>`); la elegida lleva `aria-current`. Server Component.
 */

export function conversationHref(id: string): string {
  return `/conversations?c=${encodeURIComponent(id)}`;
}

export function ConversationList({
  conversations,
  total,
  selectedId,
  className,
}: {
  conversations: readonly InboxItem[];
  total: number;
  selectedId: string | null;
  className?: string;
}) {
  return (
    <section
      aria-labelledby="inbox-list-heading"
      className={cn("flex min-h-0 flex-col", className)}
    >
      <Panel className="flex min-h-0 flex-1 flex-col">
        <PanelHeader>
          <h2
            id="inbox-list-heading"
            className="text-heading text-text-primary"
          >
            Conversaciones activas
          </h2>
          <span className="ml-auto text-caption text-text-muted tabular-nums">
            {formatCount(total)}
          </span>
        </PanelHeader>
        {conversations.length === 0 ? (
          <p className="px-4 py-6 text-label font-normal text-text-muted">
            Todavía no hay conversaciones. Los mensajes de WhatsApp que lleguen
            a la línea del concesionario aparecen acá.
          </p>
        ) : (
          <ul className="min-h-0 flex-1 overflow-y-auto">
            {conversations.map((item) => {
              const selected = item.id === selectedId;
              return (
                <li
                  key={item.id}
                  className="border-b border-border-subtle last:border-b-0"
                >
                  <Link
                    href={conversationHref(item.id)}
                    aria-current={selected ? "page" : undefined}
                    className={cn(
                      "flex items-start gap-3 px-4 py-3 transition-colors duration-150 ease-out-strong focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-focus-ring",
                      selected
                        ? "bg-brand-soft shadow-[inset_3px_0_0_var(--color-brand)]"
                        : "hover:bg-surface-2",
                    )}
                  >
                    <Avatar
                      initials={item.initials}
                      tone={selected ? "brand" : "neutral"}
                    />
                    <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                      <span className="flex items-baseline gap-2">
                        <span
                          className={cn(
                            "min-w-0 flex-1 truncate text-label font-semibold",
                            selected
                              ? "text-brand-strong"
                              : "text-text-primary",
                          )}
                        >
                          {item.contactName}
                        </span>
                        {item.at ? (
                          <span className="shrink-0 text-caption text-text-muted tabular-nums">
                            {item.at}
                          </span>
                        ) : null}
                      </span>
                      <span className="line-clamp-2 text-caption break-words text-text-secondary">
                        {item.preview}
                      </span>
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
        {total > conversations.length ? (
          <p className="border-t border-border-subtle px-4 py-2.5 text-caption text-text-muted">
            Mostrando las {formatCount(conversations.length)} más recientes de{" "}
            {formatCount(total)}.
          </p>
        ) : null}
      </Panel>
    </section>
  );
}
