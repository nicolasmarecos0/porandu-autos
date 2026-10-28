import "server-only";

import { createHash, timingSafeEqual } from "node:crypto";

import { parseWebhookVerification } from "@/domains/webhooks/verification";
import { getWhatsAppVerifyEnv } from "@/lib/env.server";

/*
 * GET /api/webhooks/whatsapp (DEC-039 §1): verificación de la suscripción.
 *
 *   token configurado (si no, 503) → query params válidos con Zod y
 *   hub.mode = subscribe (si no, 403) → hub.verify_token igual al
 *   configurado, en tiempo constante (si no, 403) → 200 con hub.challenge
 *   como texto plano
 *
 * No toca la base ni lee datos. Las respuestas de rechazo no dicen qué falló
 * (modo, token o forma), y nunca se registra el token. El challenge se
 * devuelve como text/plain con nosniff: no se interpreta como HTML.
 */

function readToken(): string | null {
  try {
    return getWhatsAppVerifyEnv().verifyToken;
  } catch {
    return null;
  }
}

/** Compara en tiempo constante, sin filtrar el largo del token configurado. */
function sameToken(received: string, expected: string): boolean {
  const a = createHash("sha256").update(received).digest();
  const b = createHash("sha256").update(expected).digest();
  return timingSafeEqual(a, b);
}

function text(status: number, body: string): Response {
  return new Response(body, {
    status,
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

export function handleWhatsAppVerification(request: Request): Response {
  const expected = readToken();
  if (expected === null) {
    console.error("[whatsapp] verify token is not configured");
    return text(503, "not configured");
  }

  const verification = parseWebhookVerification(
    new URL(request.url).searchParams,
  );
  if (verification === null || !sameToken(verification.verifyToken, expected)) {
    return text(403, "forbidden");
  }
  return text(200, verification.challenge);
}
