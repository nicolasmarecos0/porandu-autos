import { formatDemandDate } from "@/domains/demand/presentation";
import { initialsOf, maskPhone } from "@/domains/opportunities/prospect";

import type { MessageDirection } from "./messages";

/*
 * Bandeja de conversaciones (Hito 8, DEC-040 §1): la lista de conversaciones
 * activas y el historial de la elegida, listos para mostrar. Puro y
 * determinista: la presentación (autor "Cliente", "Vos" u "Otro miembro",
 * fecha de Asunción, teléfono enmascarado) se arma contra el usuario que
 * mira y no expone ids de usuario ni teléfonos completos.
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
}>;

/** Una conversación de la lista, lista para mostrar. */
export type InboxItem = Readonly<{
  id: string;
  contactName: string;
  initials: string;
  preview: string;
  /** Fecha y hora de Asunción del último mensaje, o null sin mensajes. */
  at: string | null;
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

/** Un mensaje del historial, listo para mostrar como burbuja. */
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
      /** Del más viejo al más nuevo, a lo sumo THREAD_MESSAGE_LIMIT. */
      messages: readonly ThreadMessage[];
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
 * datos las ordena por `last_message_at` descendente).
 */
export function inboxItems(
  rows: readonly InboxConversationRow[],
): readonly InboxItem[] {
  return rows.map((row) => ({
    id: row.id,
    contactName: row.contactName,
    initials: initialsOf(row.contactName),
    preview: row.lastMessagePreview ?? EMPTY_PREVIEW,
    at: row.lastMessageAt ? formatDemandDate(row.lastMessageAt) : null,
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
 * El historial de una conversación como en un chat: del mensaje más viejo
 * al más nuevo, por el momento en que se envió (`sent_at`, DEC-039 §10). A
 * igual instante el orden es determinista: por registro y después por id.
 */
export function conversationThread(
  rows: readonly ThreadMessageRow[],
  viewerUserId: string,
): readonly ThreadMessage[] {
  const sentAt = (row: ThreadMessageRow) =>
    (row.sentAt ?? row.createdAt).getTime();
  return rows
    .toSorted(
      (a, b) =>
        sentAt(a) - sentAt(b) ||
        a.createdAt.getTime() - b.createdAt.getTime() ||
        a.id.localeCompare(b.id),
    )
    .map((row) => ({
      id: row.id,
      direction: row.direction,
      body: row.content,
      author: authorOf(row, viewerUserId),
      at: formatDemandDate(row.sentAt ?? row.createdAt),
    }));
}
