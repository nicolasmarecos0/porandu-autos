import "server-only";

import { revalidatePath } from "next/cache";

import {
  recordOutboundMessage,
  selectSendTarget,
  type OutboundMessageOutcome,
  type SendTarget,
} from "@/db/queries/outbound-message";
import { messagePreview } from "@/domains/conversations/conversations";
import {
  parseSendMessage,
  type SendMessageError,
} from "@/domains/conversations/outbound";
import { getWhatsAppApiEnv } from "@/lib/env.server";
import { resolveRequestTenant } from "@/lib/tenant/session";
import { sendWhatsAppText, type WhatsAppSendResult } from "@/lib/whatsapp/api";

/*
 * POST /api/messages/send (Hito 8, DEC-040): la única puerta del envío de un
 * mensaje de WhatsApp desde la bandeja.
 *
 *   Origin del mismo host (si no, 403) → JSON (si no, 415) →
 *   resolveRequestTenant() (sin usuario 401, sin organización resuelta 403)
 *   → token configurado (si no, 503) → cuerpo de hasta 64 KiB (413) → Zod
 *   (400) → selectSendTarget(): la conversación abierta en la organización
 *   activa (404) y su línea (409) → Meta (502) → recordOutboundMessage()
 *   (500 unrecorded) → revalidar → 200
 *
 * 1. Lo dispara siempre un miembro (CLAUDE.md §2): nada se envía solo. Lo
 *    puede hacer cualquier membership activa (`admin` o `seller`, DEC-040
 *    §3), en cualquier conversación de su organización.
 * 2. El pedido solo trae la conversación y el texto. Organización, contacto,
 *    línea, autor y reloj no salen del pedido. Una conversación de otra
 *    organización, inexistente o cerrada es 404 y no se llama a Meta.
 * 3. Ninguna transacción queda abierta durante la llamada a Meta: se lee,
 *    se envía y se registra. Si Meta aceptó y el registro falla, responde
 *    500 `unrecorded`: el cliente ya lo recibió y no hay que reenviarlo.
 * 4. Los logs registran el status y el código de Meta y, ante un error de
 *    base, el tipo, el SQLSTATE y la constraint: nunca el token, teléfonos,
 *    textos ni ids.
 */

/** Cota del cuerpo, en bytes: un texto de 4096 caracteres entra holgado. */
export const MAX_SEND_BODY_BYTES = 64 * 1024;

const CONVERSATIONS_PATH = "/conversations";
const OPPORTUNITIES_PATH = "/opportunities";

function json(status: number, body: unknown): Response {
  return Response.json(body, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

function failure(status: number, error: SendMessageError): Response {
  return json(status, { error });
}

/*
 * Solo el tipo de error, el SQLSTATE y la constraint: el mensaje de Drizzle
 * incluye la query y sus parámetros (el texto del mensaje).
 */
function logFailure(stage: "read" | "send" | "record", error: unknown): void {
  const { name, cause } =
    error instanceof Error ? error : { name: undefined, cause: undefined };
  const detail = (key: "code" | "constraint_name") =>
    typeof cause === "object" && cause !== null && key in cause
      ? (cause as Record<typeof key, unknown>)[key]
      : undefined;
  console.error(`[conversations] send message ${stage} failed`, {
    name,
    code: detail("code"),
    constraint_name: detail("constraint_name"),
  });
}

/*
 * El navegador manda `Origin` en todo POST. Tiene que ser el host al que
 * llegó la request, como el chequeo de Next para las Server Actions.
 */
function isSameOrigin(request: Request): boolean {
  const origin = request.headers.get("origin");
  const host = (
    request.headers.get("x-forwarded-host") ?? request.headers.get("host")
  )
    ?.split(",")[0]
    ?.trim();
  if (!origin || !host) return false;
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

function isJson(request: Request): boolean {
  const type = request.headers.get("content-type") ?? "";
  return type.split(";")[0]?.trim().toLowerCase() === "application/json";
}

function readToken(): string | null {
  try {
    return getWhatsAppApiEnv().apiToken;
  } catch {
    return null;
  }
}

async function readBody(request: Request): Promise<Uint8Array | null> {
  const declared = Number(request.headers.get("content-length") ?? "0");
  if (declared > MAX_SEND_BODY_BYTES) return null;
  const body = new Uint8Array(await request.arrayBuffer());
  return body.byteLength > MAX_SEND_BODY_BYTES ? null : body;
}

function parseJson(body: Uint8Array): unknown {
  try {
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(body));
  } catch {
    return undefined;
  }
}

export async function handleSendMessage(request: Request): Promise<Response> {
  if (!isSameOrigin(request)) return failure(403, "forbidden");
  if (!isJson(request)) return failure(415, "unsupported_media_type");

  const tenant = await resolveRequestTenant();
  if (tenant.kind === "unauthenticated") {
    return failure(401, "unauthenticated");
  }
  if (tenant.kind !== "resolved") return failure(403, "forbidden");
  const ctx = tenant.context;

  const token = readToken();
  if (token === null) {
    console.error("[conversations] WhatsApp API token is not configured");
    return failure(503, "not_configured");
  }

  const body = await readBody(request);
  if (body === null) return failure(413, "payload_too_large");
  const parsed = parseSendMessage(parseJson(body));
  if (!parsed.ok) return json(400, { error: "invalid", errors: parsed.errors });
  const { conversationId, text } = parsed.request;

  let target: SendTarget;
  try {
    target = await selectSendTarget(ctx, conversationId);
  } catch (error) {
    logFailure("read", error);
    return failure(500, "failed");
  }
  if (target.outcome === "not_found") return failure(404, "not_found");
  if (target.outcome === "no_line") return failure(409, "no_line");
  if (target.outcome === "no_recipient") return failure(409, "no_recipient");

  let sent: WhatsAppSendResult;
  try {
    sent = await sendWhatsAppText(
      { phoneNumberId: target.phoneNumberId, to: target.to, body: text },
      { token },
    );
  } catch (error) {
    // Un destino mal formado lanza antes de llamar a Meta: nada se envió.
    logFailure("send", error);
    return failure(500, "failed");
  }
  if (!sent.ok) {
    console.error("[conversations] WhatsApp send failed", {
      failure: sent.failure,
      status: sent.status,
      code: sent.code,
    });
    return failure(
      502,
      sent.failure === "rejected"
        ? "provider_rejected"
        : "provider_unavailable",
    );
  }

  let outcome: OutboundMessageOutcome;
  try {
    outcome = await recordOutboundMessage(ctx, {
      conversationId,
      externalId: sent.messageId,
      content: text,
      preview: messagePreview(text),
    });
  } catch (error) {
    logFailure("record", error);
    return failure(500, "unrecorded");
  }
  if (outcome.outcome === "not_found") {
    console.error("[conversations] sent message not recorded", {
      outcome: outcome.outcome,
    });
    return failure(500, "unrecorded");
  }

  revalidatePath(CONVERSATIONS_PATH);
  if (outcome.opportunityId !== null) {
    revalidatePath(OPPORTUNITIES_PATH);
    revalidatePath(`${OPPORTUNITIES_PATH}/${outcome.opportunityId}`);
  }
  return json(200, { outcome: "sent", messageId: outcome.messageId });
}
