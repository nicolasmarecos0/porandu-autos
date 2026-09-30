import type { Sql } from "postgres";

import { getDb } from "@/db/client";

/*
 * Único módulo de tests/db con acceso al cliente de runtime (excepción de
 * ESLint). Da el pool de postgres-js que usan withUser()/withTenant(), para
 * inspeccionar el estado de sesión de sus conexiones fuera del boundary y
 * cerrarlo al terminar la suite. RUNTIME_DATABASE_URL tiene que estar fijada
 * antes del primer uso.
 */
export function runtimePool(): Sql {
  return getDb().$client;
}

export async function closeRuntimePool(): Promise<void> {
  // Si la suite falló antes de fijar la URL, no hay pool que cerrar.
  if (!process.env.RUNTIME_DATABASE_URL) return;
  await getDb().$client.end();
}
