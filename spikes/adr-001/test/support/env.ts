import { tmpdir } from "node:os";
import { join } from "node:path";

/*
 * Entornos del spike:
 *   e0: PostgreSQL local + shim mínimo de Supabase (e0/). Solo para iterar el
 *       harness. NO es evidencia para ADR-001.
 *   e1: Supabase local real (CLI + Docker) en GitHub Actions. Es la evidencia.
 */
export type SpikeTarget = "e0" | "e1";

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
if (rawTarget !== "e0" && rawTarget !== "e1") {
  throw new Error(`SPIKE_TARGET inválido: ${rawTarget}`);
}
export const target: SpikeTarget = rawTarget;
export const isE1 = target === "e1";

export const env = {
  target,
  /** Credencial de migración (`postgres`). Solo harness y drizzle-kit. */
  migrationUrl: required("SPIKE_MIGRATION_URL"),
  /** `app_runtime`, conexión directa. */
  runtimeUrl: required("SPIKE_RUNTIME_URL"),
  /** `app_runtime` vía Supavisor en modo transacción (obligatorio en e1). */
  runtimePoolerUrl: isE1
    ? required("SPIKE_RUNTIME_POOLER_URL")
    : read("SPIKE_RUNTIME_POOLER_URL"),
  /** `postgres` vía pooler: solo para diagnosticar el tenant del pooler. */
  postgresPoolerUrl: read("SPIKE_POSTGRES_POOLER_URL"),
  appRuntimePassword: required("SPIKE_APP_RUNTIME_PASSWORD"),
  supabaseUrl: isE1 ? required("SPIKE_SUPABASE_URL") : undefined,
  publishableKey: isE1 ? required("SPIKE_PUBLISHABLE_KEY") : undefined,
  publishableKeyKind: read("SPIKE_PUBLISHABLE_KEY_KIND") ?? "unknown",
  secretKey: isE1 ? required("SPIKE_SECRET_KEY") : undefined,
  secretKeyKind: read("SPIKE_SECRET_KEY_KIND") ?? "unknown",
  /** e0: firma de tokens del shim. e1: opcional (token vencido firmado). */
  jwtSecret: isE1 ? read("SPIKE_JWT_SECRET") : required("SPIKE_JWT_SECRET"),
  resultsDir: read("SPIKE_RESULTS_DIR") ?? join(tmpdir(), "adr-001-results"),
} as const;

export function isLoopbackUrl(url: string): boolean {
  const host = new URL(url).hostname;
  return host === "127.0.0.1" || host === "localhost" || host === "::1";
}
