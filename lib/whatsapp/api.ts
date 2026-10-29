import "server-only";

import { z } from "zod";

/*
 * Cliente de envío de la WhatsApp Cloud API de Meta (Hito 8, DEC-040 §5). Es
 * el servicio interno que conoce la API: el dominio no la conoce (CLAUDE.md
 * §3). Solo lo usa la puerta del envío (lib/conversations/send.ts), que
 * dispara siempre un miembro; ESLint lo impide en cualquier otro módulo.
 *
 *   POST https://graph.facebook.com/v20.0/{PHONE_NUMBER_ID}/messages
 *   Authorization: Bearer <WHATSAPP_API_TOKEN>
 *   { messaging_product: "whatsapp", recipient_type: "individual", to,
 *     type: "text", text: { preview_url: false, body } }
 *
 * - Éxito es solo un 200 con `messages[0].id` válido (Zod, tolerante a los
 *   campos que Meta agregue). Ese id (el wamid) identifica el mensaje.
 * - Un 4xx es `rejected` (Meta no lo va a aceptar así: token, destinatario,
 *   ventana de atención). Un 5xx, otro status, un error de red, el timeout o
 *   una respuesta inválida son `unavailable`.
 * - Devuelve el status y el código de error de Meta para los logs. Nunca
 *   devuelve ni registra el token, el destinatario ni el texto.
 */

/** Versión de la Graph API del pedido del fundador (DEC-040 §5). */
export const GRAPH_API_VERSION = "v20.0";

export const GRAPH_API_ORIGIN = "https://graph.facebook.com";

/** Cuánto se espera a Meta antes de darlo por no disponible. */
export const SEND_TIMEOUT_MS = 10_000;

export type WhatsAppTextMessage = Readonly<{
  /** `phone_number_id` de la línea emisora: solo dígitos. */
  phoneNumberId: string;
  /** Destinatario en E.164 sin el "+": solo dígitos. */
  to: string;
  /** Texto ya normalizado (1 a 4096 caracteres). */
  body: string;
}>;

export type WhatsAppSendResult =
  | Readonly<{ ok: true; messageId: string }>
  | Readonly<{
      ok: false;
      failure: "rejected" | "unavailable";
      /** Status HTTP de Meta, o null si no hubo respuesta. */
      status: number | null;
      /** `error.code` de Meta, si lo mandó. */
      code: number | null;
    }>;

export type WhatsAppApiOptions = Readonly<{
  token: string;
  /** Inyectable para los tests; por defecto, el fetch global. */
  fetch?: typeof fetch;
  timeoutMs?: number;
}>;

const PHONE_NUMBER_ID = /^[0-9]{1,32}$/;
// E.164 sin "+": código de país sin 0 inicial y hasta 15 dígitos.
const RECIPIENT = /^[1-9][0-9]{1,14}$/;

const sendResponseSchema = z.object({
  messages: z
    .array(
      z.object({
        id: z
          .string()
          .min(1)
          .max(256)
          .regex(/^[^\s\p{Cc}]+$/u),
      }),
    )
    .min(1),
});

const errorResponseSchema = z.object({
  error: z.object({ code: z.number().int() }),
});

/** Endpoint de envío de una línea. */
export function messagesEndpoint(phoneNumberId: string): string {
  return `${GRAPH_API_ORIGIN}/${GRAPH_API_VERSION}/${encodeURIComponent(phoneNumberId)}/messages`;
}

async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return undefined;
  }
}

/**
 * Envía un mensaje de texto. Un mensaje mal formado es un error de
 * programación (la puerta ya validó todo) y lanza antes de llamar a Meta.
 */
export async function sendWhatsAppText(
  message: WhatsAppTextMessage,
  options: WhatsAppApiOptions,
): Promise<WhatsAppSendResult> {
  const { phoneNumberId, to, body } = message;
  if (
    !PHONE_NUMBER_ID.test(phoneNumberId) ||
    !RECIPIENT.test(to) ||
    body.trim() === "" ||
    options.token === ""
  ) {
    throw new TypeError("invalid WhatsApp text message");
  }

  const send = options.fetch ?? fetch;
  let response: Response;
  let payload: unknown;
  try {
    response = await send(messagesEndpoint(phoneNumberId), {
      method: "POST",
      headers: {
        Authorization: `Bearer ${options.token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        recipient_type: "individual",
        to,
        type: "text",
        text: { preview_url: false, body },
      }),
      signal: AbortSignal.timeout(options.timeoutMs ?? SEND_TIMEOUT_MS),
    });
    payload = await readJson(response);
  } catch {
    return { ok: false, failure: "unavailable", status: null, code: null };
  }

  if (response.status === 200) {
    const parsed = sendResponseSchema.safeParse(payload);
    if (parsed.success) {
      return { ok: true, messageId: parsed.data.messages[0]!.id };
    }
    return { ok: false, failure: "unavailable", status: 200, code: null };
  }

  const error = errorResponseSchema.safeParse(payload);
  return {
    ok: false,
    failure:
      response.status >= 400 && response.status < 500
        ? "rejected"
        : "unavailable",
    status: response.status,
    code: error.success ? error.data.error.code : null,
  };
}
