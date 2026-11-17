import "server-only";

import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres, { type Options, type Sql } from "postgres";

import { isLoopbackHost } from "@/lib/env";
import { getServerEnv } from "@/lib/env.server";

/*
 * Cliente de base de datos del runtime (ADR-001 §2 y §3.1).
 *
 * - Se conecta solo con RUNTIME_DATABASE_URL (rol app_runtime), validada por
 *   lib/env.server.ts. Nunca con la credencial de migración. La validación
 *   rechaza la conexión directa de Supabase (solo IPv6: ENOTFOUND desde
 *   Vercel) y exige el pooler en modo transacción (6543).
 * - Es perezoso: importar este módulo no lee el entorno ni abre conexiones,
 *   así build, typecheck y tests no tocan la base. postgres-js tampoco
 *   conecta hasta la primera query.
 * - Opciones para Supavisor en modo transacción desde funciones serverless
 *   (`runtimeClientOptions()`, ADR-001 §7 E3).
 *
 * Como app_runtime no tiene privilegios directos, una query sobre este
 * cliente fuera de withUser()/withTenant() (db/tenant.ts) falla cerrado.
 * ESLint solo permite importarlo desde db/tenant.ts y sus tests.
 */

export type RuntimeDatabase = PostgresJsDatabase & { $client: Sql };

/** Nombre con que el runtime aparece en los logs y en pg_stat_activity. */
export const RUNTIME_APPLICATION_NAME = "porandu-runtime";

/**
 * Pool por instancia. Vercel (Fluid compute) puede atender varios requests
 * a la vez en una instancia y cada request abre a lo sumo un par de
 * transacciones; Supavisor multiplexa las conexiones de cliente sobre su
 * propio pool. Pocas conexiones por instancia evitan agotar el límite de
 * clientes del pooler cuando escalan las instancias.
 */
export const RUNTIME_POOL_MAX = 5;

/**
 * Segundos sin uso antes de cerrar una conexión. Una instancia suspendida
 * no conserva sockets que Supavisor ya cerró del otro lado.
 */
export const RUNTIME_IDLE_TIMEOUT = 20;

/** Segundos para abrir una conexión antes de fallar (por defecto, 30). */
export const RUNTIME_CONNECT_TIMEOUT = 10;

/**
 * Opciones de postgres-js para el runtime:
 * - `prepare: false`: Supavisor en modo transacción no soporta prepared
 *   statements con nombre (ADR-001 §4).
 * - TLS: si la URL no dice `sslmode`, fuera de loopback se exige TLS
 *   (`require`, como E2: sin verificar la CA; `verify-full` es E3). Un
 *   `sslmode` explícito en la URL manda. Supabase local y el harness de
 *   tests (loopback) siguen sin TLS.
 */
export function runtimeClientOptions(
  runtimeDatabaseUrl: string,
): Options<Record<string, never>> {
  const url = new URL(runtimeDatabaseUrl);
  const explicitTls =
    url.searchParams.has("sslmode") || url.searchParams.has("ssl");
  return {
    prepare: false,
    max: RUNTIME_POOL_MAX,
    idle_timeout: RUNTIME_IDLE_TIMEOUT,
    connect_timeout: RUNTIME_CONNECT_TIMEOUT,
    connection: { application_name: RUNTIME_APPLICATION_NAME },
    ...(explicitTls || isLoopbackHost(url.hostname)
      ? {}
      : { ssl: "require" as const }),
  };
}

let runtimeDb: RuntimeDatabase | undefined;

export function getDb(): RuntimeDatabase {
  if (!runtimeDb) {
    const { runtimeDatabaseUrl } = getServerEnv();
    runtimeDb = drizzle(
      postgres(runtimeDatabaseUrl, runtimeClientOptions(runtimeDatabaseUrl)),
    );
  }
  return runtimeDb;
}
