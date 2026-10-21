import "server-only";

import { createHmac, timingSafeEqual } from "node:crypto";

/*
 * Autenticación del webhook de WhatsApp (Hito 7, DEC-039 §2): el proveedor
 * firma cada POST con el secreto compartido y manda la firma en
 * `X-Hub-Signature-256: sha256=<hex>`, el HMAC-SHA256 del cuerpo crudo. El
 * secreto nunca viaja y un cuerpo alterado no pasa. La comparación es en
 * tiempo constante, y la firma se verifica sobre los bytes recibidos, antes
 * de parsear nada.
 */

/** Header de la firma (los headers de Fetch no distinguen mayúsculas). */
export const SIGNATURE_HEADER = "x-hub-signature-256";

const SIGNATURE = /^sha256=([0-9a-f]{64})$/i;

/** Si `header` es la firma de `body` con `secret`. */
export function isValidSignature(
  body: Uint8Array,
  header: string | null,
  secret: string,
): boolean {
  const match = header === null ? null : SIGNATURE.exec(header.trim());
  if (!match) return false;
  const received = Buffer.from(match[1]!, "hex");
  const expected = createHmac("sha256", secret).update(body).digest();
  return timingSafeEqual(received, expected);
}
