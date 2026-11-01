import { formatDemandDate } from "@/domains/demand/presentation";
import { initialsOf, maskPhone } from "@/domains/opportunities/prospect";

import { chatListTime } from "./chat-time";
import type { MessageDirection } from "./messages";
import type { ConversationOpportunity } from "./opportunity-link";
import {
  threadReadState,
  unreadState,
  type ReadCursor,
  type ThreadReadState,
  type UnreadState,
} from "./read-state";
import type { ThreadSection } from "./thread-layout";

/*
 * Bandeja de conversaciones (Hito 8, DEC-040 §1; Hito 12, DEC-044): la lista
 * de conversaciones activas y el historial de la elegida, listos para
 * mostrar. Puro y determinista: la presentación (autor "Cliente", "Vos" u
 * "Otro miembro", fecha de Asunción, teléfono enmascarado, mensajes sin leer
 * de quien mira) se arma contra el usuario que mira y el instante de la
 * request, y no expone ids de usuario ni teléfonos completos.
 */

/** Cuántas conversaciones muestra la lista, las más recientes. */
export const INBOX_CONVERSATION_LIMIT = 100;

/** Cuántos mensajes muestra el historial, los más recientes. */
export const THREAD_MESSAGE_LIMIT = 200;

/** Autor de un mensaje recibido. */
export const CUSTOMER_AUTHOR = "Cliente";

/** Preview de una conversación que todavía no tiene mensajes. */
export const EMPTY_PREVIEW = "Sin mensajes todavía";

/** Una conversación activa tal como la lee la capa de datos. */
export type InboxConversationRow = Readonly<{
  id: string;
  contactName: string;
  lastMessageAt: Date | null;
  lastMessagePreview: string | null;
  /**
   * Entrantes sin leer para quien mira (DEC-044 §2): los registrados después
   * de su cursor o de su última respuesta. Los cuenta la base.
   */
  unread: number;
}>;

/** Una conversación de la lista, lista para mostrar. */
export type InboxItem = Readonly<{
  id: string;
  contactName: string;
  initials: string;
  preview: string;
  /** Fecha y hora de Asunción del último mensaje, o null sin mensajes. */
  at: string | null;
  /** La hora de chat del último mensaje: "14:32", "Ayer", "Lunes", "26 oct". */
  time: string | null;
  /** El instante del último mensaje en ISO 8601, para `<time dateTime>`. */
  dateTime: string | null;
  /** El contador de no leídos de quien mira ("3", "99+"), o leída. */
  unread: UnreadState;
}>;

/** Un mensaje de una conversación tal como lo lee la capa de datos. */
export type ThreadMessageRow = Readonly<{
  id: string;
  direction: MessageDirection;
  content: string;
  /** El miembro que lo envió, o null si lo recibió el webhook. */
  recordedBy: string | null;
  /** Cuándo se envió (el proveedor o, al enviar, la base). */
  sentAt: Date | null;
  createdAt: Date;
}>;

/** Un mensaje del historial, listo para mostrar. */
export type ThreadMessage = Readonly<{
  id: string;
  /** `inbound`: del cliente. `outbound`: de un miembro. */
  direction: MessageDirection;
  body: string;
  /** "Cliente", "Vos" u "Otro miembro". */
  author: string;
  /** Fecha y hora de Asunción: "29 oct 2026 14:32". */
  at: string;
}>;

/** Encabezado del historial: el contacto, sin su teléfono completo. */
export type ThreadContact = Readonly<{
  name: string;
  initials: string;
  /** "+595 ··· 214", o null sin teléfono. */
  maskedPhone: string | null;
}>;

/** El historial de la conversación elegida, si la hay. */
export type InboxThread =
  /** No se eligió ninguna conversación. */
  | Readonly<{ kind: "none" }>
  /** Inválida, inexistente, de otra organización o cerrada, sin distinguir. */
  | Readonly<{ kind: "not_found" }>
  | Readonly<{
      kind: "found";
      conversationId: string;
      contact: ThreadContact;
      /** A qué oportunidad se suma lo que se responda ahora (DEC-044 §4). */
      opportunity: ConversationOpportunity;
      /** Por día de Asunción, del más viejo al más nuevo. */
      sections: readonly ThreadSection[];
      /**
       * El leído de quien mira (DEC-044 §2): el separador "Mensajes nuevos"
       * y hasta dónde marca visto el historial cuando está a la vista.
       */
      read: ThreadReadState;
      /** Mensajes que se muestran: a lo sumo THREAD_MESSAGE_LIMIT. */
      shown: number;
      /** Mensajes de la conversación, también los que no se muestran. */
      total: number;
    }>;

/** Lo que recibe la página /conversations. */
export type Inbox = Readonly<{
  /** De la más reciente a la más vieja, a lo sumo INBOX_CONVERSATION_LIMIT. */
  conversations: readonly InboxItem[];
  /** Conversaciones activas, también las que no se muestran. */
  total: number;
  /** La conversación elegida (UUID normalizado), o null. */
  selectedId: string | null;
  thread: InboxThread;
}>;

/**
 * Las conversaciones de la lista, en el orden en que llegan (la capa de
 * datos las ordena por `last_message_at` descendente). `now` es el instante
 * de la request: rotula la hora de chat ("14:32" hoy, "Ayer"…).
 */
export function inboxItems(
  rows: readonly InboxConversationRow[],
  now: Date,
): readonly InboxItem[] {
  return rows.map((row) => ({
    id: row.id,
    contactName: row.contactName,
    initials: initialsOf(row.contactName),
    preview: row.lastMessagePreview ?? EMPTY_PREVIEW,
    at: row.lastMessageAt ? formatDemandDate(row.lastMessageAt) : null,
    time: row.lastMessageAt ? chatListTime(row.lastMessageAt, now) : null,
    dateTime: row.lastMessageAt ? row.lastMessageAt.toISOString() : null,
    unread: unreadState(row.unread),
  }));
}

/** El contacto del encabezado del historial. */
export function threadContact(
  name: string,
  phone: string | null,
): ThreadContact {
  return {
    name,
    initials: initialsOf(name),
    maskedPhone: phone ? (maskPhone(phone) ?? null) : null,
  };
}

function authorOf(row: ThreadMessageRow, viewerUserId: string): string {
  if (row.direction === "inbound") return CUSTOMER_AUTHOR;
  return row.recordedBy === viewerUserId ? "Vos" : "Otro miembro";
}

/**
 * El instante de un mensaje en el chat: cuándo se envió (`sent_at`, DEC-039
 * §10) o, si faltara, cuándo se registró.
 */
export function threadInstant(row: ThreadMessageRow): Date {
  return row.sentAt ?? row.createdAt;
}

/**
 * El orden del chat, del más viejo al más nuevo: por el momento en que se
 * envió y, a igual instante, de forma determinista por registro y por id.
 */
export function compareThreadRows(
  a: ThreadMessageRow,
  b: ThreadMessageRow,
): number {
  return (
    threadInstant(a).getTime() - threadInstant(b).getTime() ||
    a.createdAt.getTime() - b.createdAt.getTime() ||
    a.id.localeCompare(b.id)
  );
}

/** Un mensaje del historial contra el usuario que mira. */
export function threadMessage(
  row: ThreadMessageRow,
  viewerUserId: string,
): ThreadMessage {
  return {
    id: row.id,
    direction: row.direction,
    body: row.content,
    author: authorOf(row, viewerUserId),
    at: formatDemandDate(threadInstant(row)),
  };
}

/**
 * El leído del historial que se muestra (DEC-044 §2), contra el cursor de
 * quien mira: los mensajes en el orden del chat (compareThreadRows()), así
 * que el separador "Mensajes nuevos" va antes del primero sin leer tal como
 * se ve.
 */
export function threadRead(
  rows: readonly ThreadMessageRow[],
  cursor: ReadCursor,
): ThreadReadState {
  return threadReadState(rows.toSorted(compareThreadRows), cursor);
}

/**
 * El historial de una conversación como en un chat, en una sola lista: del
 * mensaje más viejo al más nuevo (compareThreadRows()). La bandeja lo
 * muestra por día con threadSections() (./thread-layout.ts).
 */
export function conversationThread(
  rows: readonly ThreadMessageRow[],
  viewerUserId: string,
): readonly ThreadMessage[] {
  return rows
    .toSorted(compareThreadRows)
    .map((row) => threadMessage(row, viewerUserId));
}
