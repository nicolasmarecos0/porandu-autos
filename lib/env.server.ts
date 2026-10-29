import "server-only";

import {
  parseServerEnv,
  parseWhatsAppApiEnv,
  parseWhatsAppEnv,
  parseWhatsAppVerifyEnv,
  type ServerEnv,
  type WhatsAppApiEnv,
  type WhatsAppEnv,
  type WhatsAppVerifyEnv,
} from "@/lib/env";

/*
 * Variables server-only del runtime. Next resuelve `server-only` sin
 * dependencia instalada y falla el build si un Client Component importa
 * este módulo.
 */
export function getServerEnv(): ServerEnv {
  return parseServerEnv(process.env);
}

/** Secreto del webhook de WhatsApp (DEC-039 §2). Falla si no está. */
export function getWhatsAppEnv(): WhatsAppEnv {
  return parseWhatsAppEnv(process.env);
}

/** Token de verificación de la suscripción de WhatsApp. Falla si no está. */
export function getWhatsAppVerifyEnv(): WhatsAppVerifyEnv {
  return parseWhatsAppVerifyEnv(process.env);
}

/** Token de la Cloud API para enviar mensajes (DEC-040 §5). Falla si no está. */
export function getWhatsAppApiEnv(): WhatsAppApiEnv {
  return parseWhatsAppApiEnv(process.env);
}
