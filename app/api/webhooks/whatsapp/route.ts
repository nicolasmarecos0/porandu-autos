import { handleWhatsAppWebhook } from "@/lib/whatsapp/webhook";

/*
 * POST /api/webhooks/whatsapp (Hito 7, DEC-039 §1): eventos de la WhatsApp
 * Cloud API. Solo compone: firma, validación e ingesta viven en
 * lib/whatsapp/webhook.ts. Servidor a servidor, sin sesión: proxy.ts no
 * corre sobre esta ruta.
 */

// node:crypto (firma HMAC) y la conexión de runtime necesitan Node.
export const runtime = "nodejs";

export async function POST(request: Request): Promise<Response> {
  return handleWhatsAppWebhook(request);
}
