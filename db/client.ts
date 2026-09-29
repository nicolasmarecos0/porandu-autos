import "server-only";

import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres, { type Sql } from "postgres";

import { getServerEnv } from "@/lib/env.server";

/*
 * Cliente de base de datos del runtime (ADR-001 §2 y §3.1).
 *
 * - Se conecta solo con RUNTIME_DATABASE_URL (rol app_runtime), validada por
 *   lib/env.server.ts. Nunca con la credencial de migración.
 * - Es perezoso: importar este módulo no lee el entorno ni abre conexiones,
 *   así build, typecheck y tests no tocan la base. postgres-js tampoco
 *   conecta hasta la primera query.
 * - `prepare: false`: Supavisor en modo transacción no soporta prepared
 *   statements con nombre (ADR-001 §4).
 *
 * Fuera de db/ solo lo importan sus tests. El acceso tenant-scoped pasará por
 * withTenant() (db/tenant.ts), que operará sobre este cliente.
 */

export type RuntimeDatabase = PostgresJsDatabase & { $client: Sql };

let runtimeDb: RuntimeDatabase | undefined;

export function getDb(): RuntimeDatabase {
  if (!runtimeDb) {
    const { runtimeDatabaseUrl } = getServerEnv();
    runtimeDb = drizzle(postgres(runtimeDatabaseUrl, { prepare: false }));
  }
  return runtimeDb;
}
