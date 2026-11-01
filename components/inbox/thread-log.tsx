"use client";

import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";

import type { ThreadReadState } from "@/domains/conversations/read-state";
import { markConversationRead } from "@/lib/conversations/read";

/*
 * El historial de la conversación elegida como log accesible (Hito 12B,
 * DEC-044 §2.7 y §2.8). Dos responsabilidades de cliente, nada más:
 *
 * 1. Marcar visto cuando la conversación está a la vista: la pestaña
 *    visible (`visibilityState`) y el historial en pantalla
 *    (IntersectionObserver; debajo de `lg` la lista y el chat no se ven a la
 *    vez). Llama a la Server Action markConversationRead() con el mensaje
 *    más nuevo en pantalla (`upToMessageId`); el cursor lo fija la base con
 *    su `created_at`. Solo si hay entrantes sin leer, una vez por mensaje
 *    (si falla, lo reintenta la próxima vez que vuelva a estar a la vista).
 *    Nunca lo hace un GET: un prefetch o una pestaña en segundo plano no
 *    marcan.
 * 2. Recordar dónde empezaban los mensajes nuevos al abrir la conversación.
 *    Si el cursor avanza, la acción revalida /conversations (el contador
 *    de la lista se actualiza) y el servidor ya no ve nada sin leer: el
 *    separador "Mensajes nuevos" (NewMessagesDivider) sigue donde estaba
 *    mientras la conversación está abierta. El componente lleva `key` por
 *    conversación, así que otra conversación, o volver a esta, arranca de
 *    cero.
 *
 * Los hijos (los días y las burbujas) son Server Components.
 */

/** El primer mensaje sin leer al abrir la conversación, o null. */
const UnreadBoundary = createContext<string | null>(null);

export function ThreadLog({
  conversationId,
  read,
  label,
  className,
  children,
}: {
  conversationId: string;
  read: ThreadReadState;
  /** Nombre accesible del log: "Historial con …". */
  label: string;
  className?: string;
  children: ReactNode;
}) {
  const [boundary] = useState(read.firstUnreadId);
  const log = useRef<HTMLDivElement>(null);
  const { unread, upToMessageId } = read;

  useEffect(() => {
    const node = log.current;
    if (node === null || unread === 0 || upToMessageId === null) return;

    const observable = typeof IntersectionObserver !== "undefined";
    let inView = !observable;
    let sent = false;
    let disposed = false;

    function mark() {
      if (disposed || sent || !inView) return;
      if (document.visibilityState !== "visible") return;
      sent = true;
      markConversationRead({ conversationId, upToMessageId }).then(
        (state) => {
          if (state.status === "failed") sent = false;
        },
        () => {
          sent = false;
        },
      );
    }

    const observer = observable
      ? new IntersectionObserver((entries) => {
          inView = entries.some((entry) => entry.isIntersecting);
          mark();
        })
      : null;
    observer?.observe(node);
    document.addEventListener("visibilitychange", mark);
    mark();

    return () => {
      disposed = true;
      observer?.disconnect();
      document.removeEventListener("visibilitychange", mark);
    };
  }, [conversationId, unread, upToMessageId]);

  return (
    <div ref={log} role="log" aria-label={label} className={className}>
      <UnreadBoundary value={boundary}>{children}</UnreadBoundary>
    </div>
  );
}

/**
 * El separador "Mensajes nuevos" (DEC-044 §2.8): solo antes del primer
 * entrante que estaba sin leer al abrir la conversación. Cada entrante lo
 * lleva y solo se muestra el suyo.
 */
export function NewMessagesDivider({ messageId }: { messageId: string }) {
  const boundary = useContext(UnreadBoundary);
  if (boundary !== messageId) return null;
  return (
    <div
      role="separator"
      aria-label="Mensajes nuevos"
      data-new-messages=""
      className="my-3 flex items-center gap-3 text-caption font-semibold text-brand-strong"
    >
      <span aria-hidden="true" className="h-px flex-1 bg-brand-border" />
      <span
        aria-hidden="true"
        className="rounded-full border border-brand-border bg-brand-soft px-3 py-0.5 shadow-sm"
      >
        Mensajes nuevos
      </span>
      <span aria-hidden="true" className="h-px flex-1 bg-brand-border" />
    </div>
  );
}
