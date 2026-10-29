import { z } from "zod";

import {
  MESSAGE_MAX_LENGTH,
  messageLength,
  normalizeMessageContent,
} from "./messages";

/*
 * Pedido de envío de un mensaje en una conversación (Hito 8, DEC-040 §2): lo
 * que un miembro le escribe al cliente desde la bandeja. Módulo puro y apto
 * para el navegador: el composer valida con el mismo esquema para avisar
 * antes de enviar, pero la regla la imponen el servidor (POST
 * /api/messages/send) y la base (CHECKs de `messages`).
 *
 * No conoce proveedores: enviar por WhatsApp es de lib/whatsapp/api.ts. El
 * pedido solo identifica la conversación y trae el texto. Organización,
 * contacto, línea, autor y reloj nunca salen del cliente.
 */

/** Campos que el servidor lee del cuerpo JSON. */
export const SEND_MESSAGE_FIELDS = {
  conversationId: "conversationId",
  text: "text",
} as const;

export type SendMessageField = keyof typeof SEND_MESSAGE_FIELDS;

export const SEND_MESSAGE_FIELD_ERRORS = [
  "required",
  "invalid",
  "empty",
  "too_long",
] as const;

export type SendMessageFieldError = (typeof SEND_MESSAGE_FIELD_ERRORS)[number];

/** El primer error de cada campo inválido. */
export type SendMessageErrors = Readonly<
  Partial<Record<SendMessageField, SendMessageFieldError>>
>;

/** Un pedido válido, listo para enviar. */
export type SendMessageRequest = Readonly<{
  /** UUID en minúsculas. Que sea un UUID no dice de quién es. */
  conversationId: string;
  /** Normalizado como un mensaje registrado: de 1 a 4096 caracteres. */
  text: string;
}>;

export type ParsedSendMessage =
  | Readonly<{ ok: true; request: SendMessageRequest }>
  | Readonly<{ ok: false; errors: SendMessageErrors }>;

/**
 * Errores de POST /api/messages/send (DEC-040 §8): el contrato con el
 * composer. Ninguno expone la base ni datos de otra organización.
 */
export const SEND_MESSAGE_ERRORS = [
  /** Origin de otro host, o sin organización activa resuelta. */
  "forbidden",
  "unsupported_media_type",
  /** Sin usuario verificado. */
  "unauthenticated",
  /** Sin WHATSAPP_API_TOKEN: nada se leyó ni se envió. */
  "not_configured",
  "payload_too_large",
  /** Algún campo no es válido (con el error de cada uno). */
  "invalid",
  /** Inexistente, de otra organización o cerrada, sin distinguir. */
  "not_found",
  /** La organización no tiene exactamente una línea activa. */
  "no_line",
  /** El contacto no tiene teléfono E.164. */
  "no_recipient",
  /** Meta rechazó el mensaje (4xx): no se envió. */
  "provider_rejected",
  /** Meta no respondió o no confirmó el envío. */
  "provider_unavailable",
  /** Falla inesperada antes de enviar: no se envió. */
  "failed",
  /** Meta lo aceptó pero no se pudo registrar: no hay que reenviarlo. */
  "unrecorded",
] as const;

export type SendMessageError = (typeof SEND_MESSAGE_ERRORS)[number];

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/* ── Validación (Zod, DEC-040 §2) ───────────────────────────────────────── */

const sendMessageSchema = z.object({
  conversationId: z
    .string({ error: "required" })
    .trim()
    .min(1, "required")
    .regex(UUID, "invalid")
    .transform((id) => id.toLowerCase()),
  text: z
    .string({ error: "required" })
    .transform(normalizeMessageContent)
    .refine((text) => text !== "", "empty")
    .refine((text) => messageLength(text) <= MESSAGE_MAX_LENGTH, "too_long"),
});

function isFieldError(value: string): value is SendMessageFieldError {
  return (SEND_MESSAGE_FIELD_ERRORS as readonly string[]).includes(value);
}

function isField(value: unknown): value is SendMessageField {
  return value === "conversationId" || value === "text";
}

/**
 * Valida un pedido de envío, que es input no confiable (el cuerpo JSON ya
 * parseado, o lo que arma el composer). Cualquier otro campo se ignora.
 */
export function parseSendMessage(input: unknown): ParsedSendMessage {
  const parsed = sendMessageSchema.safeParse(
    typeof input === "object" && input !== null ? input : {},
  );
  if (parsed.success) return { ok: true, request: parsed.data };
  const errors: Partial<Record<SendMessageField, SendMessageFieldError>> = {};
  for (const issue of parsed.error.issues) {
    const field = issue.path[0];
    if (!isField(field) || errors[field] !== undefined) continue;
    errors[field] = isFieldError(issue.message) ? issue.message : "invalid";
  }
  return { ok: false, errors };
}
