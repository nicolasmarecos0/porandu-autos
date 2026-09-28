import { tmpdir } from "node:os";
import { join } from "node:path";
import { stagingUrls } from "./staging";

/*
 * Entornos del spike:
 *   e0: PostgreSQL local + shim mínimo de Supabase (e0/). Solo para iterar el
 *       harness. NO es evidencia para ADR-001.
 *   e1: Supabase local real (CLI + Docker) en GitHub Actions.
 *   e2: proyecto Supabase de staging (cloud, sa-east-1). Las URLs se derivan en
 *       proceso desde los secrets (test/support/staging.ts). Sin conexión
 *       directa: GitHub Actions no tiene IPv6, así que todo va por el pooler
 *       (5432 sesión, 6543 transacción).
 */
export type SpikeTarget = "e0" | "e1" | "e2";

function read(name: string): string | undefined {
  const value = process.env[name];
  return value === undefined || value === "" ? undefined : value;
}

function required(name: string): string {
  const value = read(name);
  if (value === undefined) throw new Error(`Falta la variable ${name}`);
  return value;
}

const rawTarget = read("SPIKE_TARGET") ?? "e0";
if (rawTarget !== "e0" && rawTarget !== "e1" && rawTarget !== "e2") {
  throw new Error(`SPIKE_TARGET inválido: ${rawTarget}`);
}
export const target: SpikeTarget = rawTarget;
export const isE1 = target === "e1";
export const isE2 = target === "e2";
/** e1 y e2 usan Supabase real (Auth, claves, Data API); e0 no. */
export const usesSupabase = target !== "e0";

const staging = isE2 ? stagingUrls() : undefined;

export const env = {
  target,
  /** Credencial de migración (`postgres`). Solo harness y drizzle-kit. */
  migrationUrl: staging?.migrationUrl ?? required("SPIKE_MIGRATION_URL"),
  /** `app_runtime` sin pooler de transacción: directa (e0/e1) o pooler en modo sesión (e2). */
  runtimeUrl: staging?.runtimeSessionUrl ?? required("SPIKE_RUNTIME_URL"),
  /** `app_runtime` vía Supavisor en modo transacción (obligatorio en e1 y e2). */
  runtimePoolerUrl:
    staging?.runtimeTransactionUrl ??
    (isE1
      ? required("SPIKE_RUNTIME_POOLER_URL")
      : read("SPIKE_RUNTIME_POOLER_URL")),
  /** `postgres` vía pooler de transacción: diagnóstico y baseline de latencia. */
  postgresPoolerUrl:
    staging?.postgresTransactionUrl ?? read("SPIKE_POSTGRES_POOLER_URL"),
  appRuntimePassword: required("SPIKE_APP_RUNTIME_PASSWORD"),
  supabaseUrl: usesSupabase ? required("SPIKE_SUPABASE_URL") : undefined,
  publishableKey: usesSupabase ? required("SPIKE_PUBLISHABLE_KEY") : undefined,
  publishableKeyKind: read("SPIKE_PUBLISHABLE_KEY_KIND") ?? "unknown",
  secretKey: usesSupabase ? required("SPIKE_SECRET_KEY") : undefined,
  secretKeyKind: read("SPIKE_SECRET_KEY_KIND") ?? "unknown",
  /** e0: firma de tokens del shim. e1: opcional (token vencido firmado). e2: no se usa. */
  jwtSecret: usesSupabase
    ? read("SPIKE_JWT_SECRET")
    : required("SPIKE_JWT_SECRET"),
  resultsDir: read("SPIKE_RESULTS_DIR") ?? join(tmpdir(), "adr-001-results"),
} as const;

export function isLoopbackUrl(url: string): boolean {
  const host = new URL(url).hostname;
  return host === "127.0.0.1" || host === "localhost" || host === "::1";
}
