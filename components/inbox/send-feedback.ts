import { MESSAGE_MAX_LENGTH } from "@/domains/conversations/messages";
import type {
  SendMessageError,
  SendMessageErrors,
} from "@/domains/conversations/outbound";

/*
 * Lo que el composer le dice al miembro después de intentar enviar (Hito 8,
 * DEC-040 §8). Puro: traduce el contrato del endpoint al copy es-PY. Enviar
 * es irreversible, así que cada aviso dice si el cliente recibió el mensaje.
 */

export type SendNotice = Readonly<{ tone: "info" | "error"; text: string }>;

export const SENT_NOTICE: SendNotice = {
  tone: "info",
  text: "Mensaje enviado por WhatsApp.",
};

/** Sin respuesta del servidor: no sabemos si salió. */
export const NETWORK_NOTICE: SendNotice = {
  tone: "error",
  text: "No pudimos confirmar el envío. Actualizá la conversación antes de reintentar.",
};

const TEXT_ERRORS: Readonly<Record<string, string>> = {
  required: "Escribí el mensaje antes de enviarlo.",
  empty: "Escribí el mensaje antes de enviarlo.",
  too_long: `El mensaje puede tener hasta ${MESSAGE_MAX_LENGTH.toLocaleString("es-PY")} caracteres.`,
};

const ERRORS: Readonly<Record<SendMessageError, string>> = {
  forbidden: "No tenés acceso para responder en esta organización.",
  unsupported_media_type: "No pudimos enviar el mensaje. Intentá de nuevo.",
  unauthenticated: "Tu sesión venció. Volvé a iniciar sesión para responder.",
  not_configured:
    "El envío por WhatsApp todavía no está configurado. No se envió nada.",
  payload_too_large: TEXT_ERRORS.too_long!,
  invalid: "Revisá el mensaje antes de enviarlo.",
  not_found:
    "No encontramos la conversación: puede que ya no esté activa. No se envió nada.",
  no_line:
    "Tu concesionario no tiene una línea de WhatsApp activa para responder. No se envió nada.",
  no_recipient:
    "El contacto no tiene un teléfono válido para WhatsApp. No se envió nada.",
  provider_rejected:
    "WhatsApp rechazó el mensaje y no se envió. Intentá de nuevo más tarde.",
  provider_unavailable:
    "No pudimos confirmar el envío con WhatsApp. Si el cliente no lo recibió, intentá de nuevo en unos minutos.",
  failed: "No pudimos enviar el mensaje. No se envió nada: intentá de nuevo.",
  unrecorded:
    "El mensaje se envió, pero no pudimos registrarlo en la conversación. No lo reenvíes.",
};

function isSendError(value: unknown): value is SendMessageError {
  return typeof value === "string" && value in ERRORS;
}

/** El aviso de un error de validación del composer o del servidor. */
export function invalidNotice(errors: SendMessageErrors): SendNotice {
  if (errors.text) {
    return {
      tone: "error",
      text: TEXT_ERRORS[errors.text] ?? ERRORS.invalid,
    };
  }
  if (errors.conversationId) return { tone: "error", text: ERRORS.not_found };
  return { tone: "error", text: ERRORS.invalid };
}

/**
 * El aviso de una respuesta del endpoint, ya leída: `ok` y el cuerpo JSON
 * (o null si no lo era).
 */
export function sendFeedback(ok: boolean, body: unknown): SendNotice {
  if (ok) return SENT_NOTICE;
  const { error, errors } =
    typeof body === "object" && body !== null
      ? (body as { error?: unknown; errors?: unknown })
      : {};
  if (error === "invalid" && typeof errors === "object" && errors !== null) {
    return invalidNotice(errors as SendMessageErrors);
  }
  return isSendError(error)
    ? { tone: "error", text: ERRORS[error] }
    : NETWORK_NOTICE;
}
