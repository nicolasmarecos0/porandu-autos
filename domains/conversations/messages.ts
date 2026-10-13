import { z } from "zod";

import { normalizeNoteBody, noteLength } from "@/domains/opportunities/notes";

/*
 * Mensajes de una conversación con el cliente (Hito 4, DEC-036 §4): lo que
 * se recibió del cliente o se le envió, por WhatsApp, email u otro medio, tal
 * como lo registra un miembro. Registrar no envía ni recibe nada: no hay
 * integración con proveedores, y el dominio no los conoce.
 *
 * Módulo puro y apto para el navegador: el formulario usa las listas, el
 * largo máximo y la validación para avisar antes de enviar, pero la regla la
 * imponen el servidor (parseMessage() antes de escribir) y la base (CHECKs
 * de `messages`, que espejan estas listas y lo esencial del texto).
 */

/**
 * Canal por el que ocurrió el mensaje. `manual` es cualquier otro medio
 * (llamada, visita, mensaje de otra app). Espeja `messageChannels` de
 * db/schema/messages.ts (un test vigila que coincidan).
 */
export const MESSAGE_CHANNELS = ["whatsapp", "email", "manual"] as const;

export type MessageChannel = (typeof MESSAGE_CHANNELS)[number];

/** Recibido del cliente (`inbound`) o enviado al cliente (`outbound`). */
export const MESSAGE_DIRECTIONS = ["inbound", "outbound"] as const;

export type MessageDirection = (typeof MESSAGE_DIRECTIONS)[number];

/**
 * Largo máximo del texto, en caracteres (como `char_length` de la base): el
 * de un mensaje de texto de WhatsApp.
 */
export const MESSAGE_MAX_LENGTH = 4096;

export const MESSAGE_CHANNEL_LABELS: Readonly<Record<MessageChannel, string>> =
  {
    whatsapp: "WhatsApp",
    email: "Email",
    manual: "Otro medio",
  };

export const MESSAGE_DIRECTION_LABELS: Readonly<
  Record<MessageDirection, string>
> = {
  inbound: "Recibido del cliente",
  outbound: "Enviado al cliente",
};

/**
 * Campos que el servidor lee del pedido. Organización, contacto, autor y
 * fecha nunca salen del cliente: el contacto es el de la oportunidad.
 */
export const MESSAGE_FIELDS = {
  opportunityId: "opportunityId",
  channel: "channel",
  direction: "direction",
  content: "content",
} as const;

/**
 * Texto de un mensaje tal como se guarda: las mismas reglas que una nota de
 * la bitácora (DEC-033 §1): NFC, saltos de línea `\n`, sin otros caracteres
 * de control, espacios colapsados, a lo sumo una línea en blanco seguida y
 * recortado.
 */
export const normalizeMessageContent = normalizeNoteBody;

/** Largo en caracteres (code points), igual que `char_length`. */
export const messageLength = noteLength;

/** Lo que llega del formulario, tal como se tipeó. */
export type MessageValues = Readonly<{
  channel: string;
  direction: string;
  content: string;
}>;

export type MessageField = keyof MessageValues;

export const MESSAGE_FIELD_ERRORS = [
  "required",
  "invalid_option",
  "empty",
  "too_long",
] as const;

export type MessageFieldError = (typeof MESSAGE_FIELD_ERRORS)[number];

/** El primer error de cada campo inválido. */
export type MessageErrors = Readonly<
  Partial<Record<MessageField, MessageFieldError>>
>;

/** Un mensaje válido, listo para escribir. */
export type NewMessage = Readonly<{
  channel: MessageChannel;
  direction: MessageDirection;
  /** Ya normalizado: de 1 a MESSAGE_MAX_LENGTH caracteres. */
  content: string;
}>;

export type ParsedMessage =
  | Readonly<{ ok: true; message: NewMessage }>
  | Readonly<{ ok: false; errors: MessageErrors }>;

/* ── Validación (Zod, DEC-036 §7) ───────────────────────────────────────── */

function choice<const T extends readonly [string, ...string[]]>(values: T) {
  return z
    .string()
    .trim()
    .min(1, "required")
    .pipe(z.enum(values, { error: "invalid_option" }));
}

const messageSchema = z.object({
  channel: choice(MESSAGE_CHANNELS),
  direction: choice(MESSAGE_DIRECTIONS),
  content: z
    .string()
    .transform(normalizeMessageContent)
    .refine((content) => content !== "", "empty")
    .refine(
      (content) => messageLength(content) <= MESSAGE_MAX_LENGTH,
      "too_long",
    ),
});

function isMessageFieldError(value: string): value is MessageFieldError {
  return (MESSAGE_FIELD_ERRORS as readonly string[]).includes(value);
}

/**
 * Valida un mensaje, que es input no confiable: canal y dirección de las
 * listas cerradas y el texto normalizado, ni vacío ni demasiado largo.
 */
export function parseMessage(values: MessageValues): ParsedMessage {
  const parsed = messageSchema.safeParse(values);
  if (parsed.success) return { ok: true, message: parsed.data };
  const errors: Partial<Record<MessageField, MessageFieldError>> = {};
  for (const issue of parsed.error.issues) {
    const field = issue.path[0] as MessageField;
    if (errors[field] !== undefined) continue;
    errors[field] = isMessageFieldError(issue.message)
      ? issue.message
      : "invalid_option";
  }
  return { ok: false, errors };
}

/** Un mensaje tal como lo lee la capa de datos. */
export type MessageRow = Readonly<{
  id: string;
  channel: MessageChannel;
  direction: MessageDirection;
  content: string;
  recordedBy: string;
  createdAt: Date;
}>;
