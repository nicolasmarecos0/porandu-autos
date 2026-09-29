import "server-only";

import { parseServerEnv, type ServerEnv } from "@/lib/env";

/*
 * Variables server-only del runtime. Next resuelve `server-only` sin
 * dependencia instalada y falla el build si un Client Component importa
 * este módulo.
 */
export function getServerEnv(): ServerEnv {
  return parseServerEnv(process.env);
}
