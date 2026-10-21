import "server-only";

import {
  ingestInboundMessage,
  type InboundMessageOutcome,
} from "@/db/queries/ingest-whatsapp-message";
import { messagePreview } from "@/domains/conversations/conversations";
import { contactNameFor } from "@/domains/webhooks/inbound-message";
import { parseWhatsAppWebhook } from "@/domains/webhooks/whatsapp";
import { normalizePhone } from "@/lib/contacts/phone";
import { getWhatsAppEnv } from "@/lib/env.server";

import { isValidSignature, SIGNATURE_HEADER } from "./signature";

/*
 * Webhook de WhatsApp (Hito 7, DEC-039): la única puerta de la ingesta de
 * mensajes entrantes. Servidor a servidor, sin sesión ni usuario.
 *
 *   secreto configurado (si no, 503) → cuerpo de hasta 3 MiB (si no, 413)
 *   → firma HMAC del cuerpo crudo (si no, 401) → JSON y sobre válidos con
 *   Zod (si no, 400) → por cada mensaje de texto: teléfono E.164 → ingesta
 *   (withIngestion(), una transacción por mensaje) → 200 con los conteos
 *
 * 1. La organización nunca sale del payload: la resuelve la base a partir
 *    de la línea receptora. Una línea desconocida no escribe nada.
 * 2. Lo que no es un mensaje de texto entrante (estados, media, otros
 *    campos) y los mensajes con un campo inválido se cuentan y no se
 *    escriben, con 200: el proveedor no los reintenta.
 * 3. Si una escritura falla, responde 500 y no sigue: el proveedor reintenta
 *    el lote y los mensajes ya registrados son `duplicate` (idempotencia por
 *    el id del proveedor, en la base).
 * 4. Los logs registran solo conteos y, ante un error, el tipo, el SQLSTATE
 *    y la constraint: nunca teléfonos, nombres, textos, ids ni el secreto.
 */

/** Cota del cuerpo, en bytes. */
export const MAX_WEBHOOK_BODY_BYTES = 3 * 1024 * 1024;

/** Conteos de un webhook procesado. */
export type WebhookSummary = {
  /** Mensajes de texto válidos recibidos. */
  received: number;
  recorded: number;
  duplicate: number;
  unknown_line: number;
  /** El número de origen no es un teléfono válido (DEC-024 §2). */
  invalid_sender: number;
  /** Mensajes de texto descartados por un campo inválido. */
  invalid: number;
  /** Eventos que no se ingieren por diseño. */
  ignored: number;
};

function json(status: number, body: unknown): Response {
  return Response.json(body, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

/*
 * Solo el tipo de error, el SQLSTATE y la constraint: el mensaje de Drizzle
 * incluye la query y sus parámetros (teléfono y texto).
 */
function logFailure(error: unknown): void {
  const { name, cause } =
    error instanceof Error ? error : { name: undefined, cause: undefined };
  const detail = (key: "code" | "constraint_name") =>
    typeof cause === "object" && cause !== null && key in cause
      ? (cause as Record<typeof key, unknown>)[key]
      : undefined;
  console.error("[whatsapp] ingest failed", {
    name,
    code: detail("code"),
    constraint_name: detail("constraint_name"),
  });
}

function readSecret(): string | null {
  try {
    return getWhatsAppEnv().appSecret;
  } catch {
    return null;
  }
}

async function readBody(request: Request): Promise<Uint8Array | null> {
  const declared = Number(request.headers.get("content-length") ?? "0");
  if (declared > MAX_WEBHOOK_BODY_BYTES) return null;
  const body = new Uint8Array(await request.arrayBuffer());
  return body.byteLength > MAX_WEBHOOK_BODY_BYTES ? null : body;
}

function parseJson(body: Uint8Array): unknown {
  try {
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(body));
  } catch {
    return undefined;
  }
}

export async function handleWhatsAppWebhook(
  request: Request,
): Promise<Response> {
  const secret = readSecret();
  if (secret === null) {
    console.error("[whatsapp] webhook secret is not configured");
    return json(503, { error: "not_configured" });
  }

  const body = await readBody(request);
  if (body === null) return json(413, { error: "payload_too_large" });

  if (!isValidSignature(body, request.headers.get(SIGNATURE_HEADER), secret)) {
    return json(401, { error: "invalid_signature" });
  }

  const payload = parseJson(body);
  const webhook = payload === undefined ? null : parseWhatsAppWebhook(payload);
  if (webhook === null || !webhook.ok) {
    return json(400, { error: "invalid_payload" });
  }

  const summary: WebhookSummary = {
    received: webhook.messages.length,
    recorded: 0,
    duplicate: 0,
    unknown_line: 0,
    invalid_sender: 0,
    invalid: webhook.invalid,
    ignored: webhook.ignored,
  };

  for (const message of webhook.messages) {
    const phone = `+${message.from}`;
    const phoneNormalized = normalizePhone(phone);
    if (phoneNormalized === null) {
      summary.invalid_sender += 1;
      continue;
    }
    let result: InboundMessageOutcome;
    try {
      result = await ingestInboundMessage({
        lineId: message.lineId,
        externalId: message.externalId,
        phone,
        phoneNormalized,
        contactName: contactNameFor(message),
        content: message.content,
        preview: messagePreview(message.content),
        sentAt: message.sentAt,
      });
    } catch (error) {
      logFailure(error);
      return json(500, { error: "ingest_failed" });
    }
    summary[result.outcome] += 1;
  }

  console.info("[whatsapp] webhook processed", summary);
  return json(200, summary);
}
