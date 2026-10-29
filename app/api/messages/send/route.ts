import { handleSendMessage } from "@/lib/conversations/send";

/*
 * POST /api/messages/send (Hito 8, DEC-040 §2): un miembro responde una
 * conversación por WhatsApp desde la bandeja. Solo compone: la sesión, el
 * tenant, la validación, el envío a Meta y el registro viven en
 * lib/conversations/send.ts.
 */

// La conexión de runtime (postgres) necesita Node.
export const runtime = "nodejs";

export async function POST(request: Request): Promise<Response> {
  return handleSendMessage(request);
}
