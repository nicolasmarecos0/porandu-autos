import { handleWhatsAppVerification } from "@/lib/whatsapp/verification";
import { handleWhatsAppWebhook } from "@/lib/whatsapp/webhook";

/*
 * /api/webhooks/whatsapp (Hito 7, DEC-039 §1), WhatsApp Cloud API. Solo
 * compone:
 * - GET: verificación de la suscripción (hub.challenge), en
 *   lib/whatsapp/verification.ts;
 * - POST: eventos; firma, validación e ingesta viven en
 *   lib/whatsapp/webhook.ts.
 * Servidor a servidor, sin sesión: proxy.ts no corre sobre esta ruta.
 */

// node:crypto (firma HMAC) y la conexión de runtime necesitan Node.
export const runtime = "nodejs";

export async function POST(request: Request): Promise<Response> {
  return handleWhatsAppWebhook(request);
}

export function GET(request: Request): Response {
  return handleWhatsAppVerification(request);
}
