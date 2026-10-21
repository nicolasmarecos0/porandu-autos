import "server-only";

import {
  parseServerEnv,
  parseWhatsAppEnv,
  type ServerEnv,
  type WhatsAppEnv,
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
