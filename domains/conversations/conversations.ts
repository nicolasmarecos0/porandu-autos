/*
 * Conversaciones con un contacto (Hito 7, DEC-039 §6): agrupan los mensajes
 * de un canal y guardan el último para ordenar la bandeja. Módulo puro y apto
 * para el navegador. No conoce proveedores: la ingesta (domains/webhooks)
 * traduce el payload de WhatsApp antes de llegar acá.
 */

/**
 * Canales con conversación. Espeja `conversationChannels` de
 * db/schema/conversations.ts (un test vigila que coincidan).
 */
export const CONVERSATION_CHANNELS = ["whatsapp"] as const;

export type ConversationChannel = (typeof CONVERSATION_CHANNELS)[number];

/**
 * `open` es la conversación activa: una sola por contacto y canal. Espeja
 * `conversationStatuses` de db/schema/conversations.ts.
 */
export const CONVERSATION_STATUSES = ["open", "closed"] as const;

export type ConversationStatus = (typeof CONVERSATION_STATUSES)[number];

/**
 * Largo máximo del preview del último mensaje, en caracteres (como
 * `char_length`). Espeja `conversationPreviewMaxLength` de
 * db/schema/conversations.ts.
 */
export const MESSAGE_PREVIEW_MAX_LENGTH = 160;

const ELLIPSIS = "…";

/**
 * El texto de un mensaje en una sola línea, para el preview de su
 * conversación: los saltos de línea y los espacios repetidos como un
 * espacio, recortado y, si excede MESSAGE_PREVIEW_MAX_LENGTH, cortado con
 * "…" (sin dejar un espacio antes). Recibe un texto ya normalizado
 * (normalizeMessageContent()), que no tiene otros caracteres de control.
 * Determinista y por code points, como `char_length`.
 */
export function messagePreview(content: string): string {
  const line = content.replace(/\s+/gu, " ").trim();
  const characters = Array.from(line);
  if (characters.length <= MESSAGE_PREVIEW_MAX_LENGTH) return line;
  const cut = characters
    .slice(0, MESSAGE_PREVIEW_MAX_LENGTH - ELLIPSIS.length)
    .join("")
    .trimEnd();
  return `${cut}${ELLIPSIS}`;
}
