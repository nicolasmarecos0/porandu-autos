import { z } from "zod";

import type { MessageDirection } from "./messages";

/*
 * Leído y no leído de la bandeja (Hito 12, DEC-044 §2). Es interno del
 * equipo: dice qué mensajes del cliente todavía no vio cada miembro. No es
 * el "visto" de WhatsApp (./delivery.ts) y no se le informa al cliente.
 *
 * - Cada miembro tiene su propio cursor por conversación: no hay responsable
 *   asignado (DEC-023), y que un vendedor lea no marca leído para otro.
 * - Solo cuentan los entrantes: lo que envía el equipo nunca está sin leer.
 * - El cursor es el `created_at` (reloj de la base) del mensaje más nuevo
 *   que el miembro tenía en pantalla al marcar, no `now()` ni `sent_at`. Un
 *   mensaje que llegó mientras tanto, o uno viejo que el proveedor entregó
 *   tarde, sigue sin leer.
 * - Responder es leer: la última respuesta del propio miembro en la
 *   conversación también es cursor.
 * - Solo avanza: marcar un mensaje más viejo no vuelve a mostrar nada como
 *   no leído.
 * - Sin cursor ni respuesta propia, todo entrante está sin leer.
 *
 * Puro y apto para el navegador. La base cuenta los no leídos de la lista
 * con esta misma regla (Hito 12B: db/queries/conversation-reads.ts); estas
 * funciones la fijan y las usa el historial.
 */

/** Hasta dónde vio un miembro una conversación. */
export type ReadCursor = Readonly<{
  /** `created_at` del último mensaje que marcó como visto, o null. */
  readUpTo: Date | null;
  /** `created_at` de su última respuesta en la conversación, o null. */
  lastOwnReplyAt: Date | null;
}>;

/** Un miembro que nunca abrió ni respondió la conversación. */
export const NO_READ_CURSOR: ReadCursor = {
  readUpTo: null,
  lastOwnReplyAt: null,
};

/** Un mensaje, con lo que importa para saber si está leído. */
export type ReadableMessage = Readonly<{
  id: string;
  direction: MessageDirection;
  /** El reloj de la base: cuándo lo registró Porandú. */
  createdAt: Date;
}>;

function laterOf(a: Date | null, b: Date | null): Date | null {
  if (a === null) return b;
  if (b === null) return a;
  return a.getTime() >= b.getTime() ? a : b;
}

/** Hasta dónde leyó: el cursor o la última respuesta propia, el más nuevo. */
export function effectiveReadUpTo(cursor: ReadCursor): Date | null {
  return laterOf(cursor.readUpTo, cursor.lastOwnReplyAt);
}

/**
 * El cursor después de marcar visto hasta `candidate` (el `created_at` del
 * mensaje marcado). Solo avanza, como `GREATEST` en la base.
 */
export function advanceReadCursor(current: Date | null, candidate: Date): Date {
  return current !== null && current.getTime() >= candidate.getTime()
    ? current
    : candidate;
}

/** Un entrante registrado después de hasta dónde leyó el miembro. */
export function isUnread(
  message: ReadableMessage,
  cursor: ReadCursor,
): boolean {
  if (message.direction !== "inbound") return false;
  const upTo = effectiveReadUpTo(cursor);
  return upTo === null || message.createdAt.getTime() > upTo.getTime();
}

export function countUnread(
  messages: readonly ReadableMessage[],
  cursor: ReadCursor,
): number {
  return messages.filter((message) => isUnread(message, cursor)).length;
}

/**
 * El primer mensaje sin leer en el orden en que se muestran (el del chat):
 * donde va el separador "Mensajes nuevos". Null si no hay.
 */
export function firstUnreadId(
  messages: readonly ReadableMessage[],
  cursor: ReadCursor,
): string | null {
  return messages.find((message) => isUnread(message, cursor))?.id ?? null;
}

/**
 * El mensaje registrado más tarde (`created_at`; a igual instante, el id
 * mayor, para que sea determinista). Es hasta dónde marca visto el
 * historial: el cursor se mide con el reloj de la base, así que un mensaje
 * viejo que el proveedor entregó tarde (al medio del chat por `sent_at`)
 * puede ser el más nuevo. Null sin mensajes.
 */
export function newestRegisteredId(
  messages: readonly ReadableMessage[],
): string | null {
  let newest: ReadableMessage | null = null;
  for (const message of messages) {
    const time = message.createdAt.getTime();
    if (
      newest === null ||
      time > newest.createdAt.getTime() ||
      (time === newest.createdAt.getTime() && message.id > newest.id)
    ) {
      newest = message;
    }
  }
  return newest?.id ?? null;
}

/* ── El historial de quien mira ─────────────────────────────────────────── */

/** El leído del historial que se muestra, contra el cursor de quien mira. */
export type ThreadReadState = Readonly<{
  /** Entrantes sin leer al cargar el historial. */
  unread: number;
  /** Antes de cuál va el separador "Mensajes nuevos", o null. */
  firstUnreadId: string | null;
  /**
   * El mensaje en pantalla registrado más tarde: el que se envía al marcar
   * visto (la base fija el cursor con su `created_at`). Null sin mensajes.
   */
  upToMessageId: string | null;
}>;

/**
 * El leído del historial, con los mensajes en el orden del chat (el del
 * separador). Marcar visto solo hace falta si hay entrantes sin leer.
 */
export function threadReadState(
  messages: readonly ReadableMessage[],
  cursor: ReadCursor,
): ThreadReadState {
  return {
    unread: countUnread(messages, cursor),
    firstUnreadId: firstUnreadId(messages, cursor),
    upToMessageId: newestRegisteredId(messages),
  };
}

/* ── Contador de la lista ───────────────────────────────────────────────── */

/** Desde cuántos el contador se abrevia: "99+". */
export const UNREAD_BADGE_MAX = 99;

export type UnreadState =
  | Readonly<{ kind: "read" }>
  | Readonly<{
      kind: "unread";
      count: number;
      /** Lo que muestra el contador: "3" o "99+". */
      label: string;
      /** Para lectores de pantalla: "3 mensajes sin leer". */
      description: string;
    }>;

/** El contador de una conversación a partir de sus entrantes sin leer. */
export function unreadState(count: number): UnreadState {
  if (!Number.isSafeInteger(count) || count <= 0) return { kind: "read" };
  return {
    kind: "unread",
    count,
    label: count > UNREAD_BADGE_MAX ? `${UNREAD_BADGE_MAX}+` : String(count),
    description:
      count === 1
        ? "1 mensaje sin leer"
        : `${count.toLocaleString("es-PY")} mensajes sin leer`,
  };
}

/* ── Pedido de marcar visto (Zod, DEC-009) ──────────────────────────────── */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const uuid = z
  .string()
  .trim()
  .regex(UUID)
  .transform((id) => id.toLowerCase());

const markReadSchema = z.object({
  conversationId: uuid,
  upToMessageId: uuid,
});

/**
 * Marcar visto: la conversación y el mensaje más nuevo que el miembro tiene
 * en pantalla. El cursor lo fija la base con el `created_at` de ese mensaje,
 * nunca un reloj del cliente.
 */
export type MarkReadRequest = Readonly<{
  conversationId: string;
  upToMessageId: string;
}>;

/**
 * Valida el pedido, que es input no confiable. Cualquier otro campo se
 * ignora. Null si no es válido: marcar visto no es crítico y no tiene
 * errores por campo que mostrar.
 */
export function parseMarkRead(input: unknown): MarkReadRequest | null {
  const parsed = markReadSchema.safeParse(
    typeof input === "object" && input !== null ? input : {},
  );
  return parsed.success ? parsed.data : null;
}
