import { z } from "zod";

/*
 * Verificación de la suscripción del webhook de WhatsApp (DEC-039 §1): Meta
 * hace un GET con `hub.mode=subscribe`, `hub.verify_token` (el token que el
 * administrador configuró en Meta) y `hub.challenge`, y espera recibir el
 * challenge de vuelta. Módulo puro: valida la forma de los query params; la
 * comparación del token contra el secreto la hace lib/whatsapp/verification.ts.
 *
 * El challenge se devuelve tal cual, así que se acota: letras, dígitos y
 * `. _ ~ -`, hasta CHALLENGE_MAX_LENGTH caracteres (Meta manda un entero).
 * Nada que parezca markup llega a la respuesta.
 */

/** Largo máximo del challenge que se acepta devolver. */
export const CHALLENGE_MAX_LENGTH = 256;

/** Largo máximo del token recibido; el configurado es más corto. */
export const VERIFY_TOKEN_MAX_LENGTH = 512;

const verificationSchema = z.object({
  "hub.mode": z.literal("subscribe"),
  "hub.verify_token": z.string().min(1).max(VERIFY_TOKEN_MAX_LENGTH),
  "hub.challenge": z
    .string()
    .min(1)
    .max(CHALLENGE_MAX_LENGTH)
    .regex(/^[A-Za-z0-9._~-]+$/),
});

export type WebhookVerification = Readonly<{
  verifyToken: string;
  challenge: string;
}>;

/**
 * Lee los query params de la verificación, que son input no confiable:
 * `null` si falta alguno, si `hub.mode` no es `subscribe` o si el token o el
 * challenge no tienen la forma esperada.
 */
export function parseWebhookVerification(
  params: URLSearchParams,
): WebhookVerification | null {
  const parsed = verificationSchema.safeParse({
    "hub.mode": params.get("hub.mode"),
    "hub.verify_token": params.get("hub.verify_token"),
    "hub.challenge": params.get("hub.challenge"),
  });
  if (!parsed.success) return null;
  return {
    verifyToken: parsed.data["hub.verify_token"],
    challenge: parsed.data["hub.challenge"],
  };
}
