/*
 * Contrato de variables de entorno (H0).
 *
 * Este módulo solo contiene validación pura: recibe un objeto de entorno y
 * no lee `process.env` por su cuenta. Los puntos de lectura son:
 *   - `lib/env.public.ts`: variables públicas (navegador y servidor).
 *   - `lib/env.server.ts`: variables server-only (`import "server-only"`).
 *
 * `MIGRATION_DATABASE_URL` (rol `postgres`) no forma parte de este contrato:
 * es exclusiva de drizzle-kit y el runtime nunca la referencia (ADR-001 §2
 * y §3.1). Los mensajes de error nombran la variable, nunca su valor.
 */

export type EnvSource = Readonly<Record<string, string | undefined>>;

export type PublicEnv = {
  supabaseUrl: string;
  supabasePublishableKey: string;
};

export type ServerEnv = {
  runtimeDatabaseUrl: string;
};

export class EnvValidationError extends Error {
  readonly issues: readonly string[];

  constructor(issues: readonly string[]) {
    super(`Invalid environment:\n${issues.map((i) => `- ${i}`).join("\n")}`);
    this.name = "EnvValidationError";
    this.issues = issues;
  }
}

const RUNTIME_ROLE = "app_runtime";
const PUBLISHABLE_KEY_PREFIX = "sb_publishable_";

function readRequired(
  source: EnvSource,
  name: string,
  issues: string[],
): string {
  const value = source[name]?.trim() ?? "";
  if (value === "") issues.push(`${name} is required.`);
  return value;
}

function parseUrl(value: string): URL | null {
  try {
    return new URL(value);
  } catch {
    return null;
  }
}

/**
 * Supavisor autentica como `<rol>.<project_ref>`; la conexión directa, como
 * `<rol>`. En ambos casos el rol es lo anterior al primer punto.
 */
export function databaseRole(url: URL): string {
  return decodeURIComponent(url.username).split(".")[0] ?? "";
}

export function parsePublicEnv(source: EnvSource): PublicEnv {
  const issues: string[] = [];

  const supabaseUrl = readRequired(source, "NEXT_PUBLIC_SUPABASE_URL", issues);
  if (supabaseUrl !== "") {
    const url = parseUrl(supabaseUrl);
    if (!url || (url.protocol !== "http:" && url.protocol !== "https:")) {
      issues.push("NEXT_PUBLIC_SUPABASE_URL must be an http(s) URL.");
    }
  }

  const supabasePublishableKey = readRequired(
    source,
    "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
    issues,
  );
  // Una variable NEXT_PUBLIC_* termina en el bundle del navegador: solo se
  // acepta una publishable key, nunca una secret key ni una key legacy.
  if (
    supabasePublishableKey !== "" &&
    !supabasePublishableKey.startsWith(PUBLISHABLE_KEY_PREFIX)
  ) {
    issues.push(
      `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY must be a Supabase publishable key (${PUBLISHABLE_KEY_PREFIX}…).`,
    );
  }

  if (issues.length > 0) throw new EnvValidationError(issues);
  return { supabaseUrl, supabasePublishableKey };
}

export function parseServerEnv(source: EnvSource): ServerEnv {
  const issues: string[] = [];

  const runtimeDatabaseUrl = readRequired(
    source,
    "RUNTIME_DATABASE_URL",
    issues,
  );
  if (runtimeDatabaseUrl !== "") {
    const url = parseUrl(runtimeDatabaseUrl);
    if (
      !url ||
      (url.protocol !== "postgres:" && url.protocol !== "postgresql:")
    ) {
      issues.push("RUNTIME_DATABASE_URL must be a postgres:// URL.");
    } else if (databaseRole(url) !== RUNTIME_ROLE) {
      // ADR-001 §3.1: el runtime se conecta siempre como app_runtime y nunca
      // con la credencial de migración (postgres).
      issues.push(
        `RUNTIME_DATABASE_URL must connect as ${RUNTIME_ROLE} (ADR-001). The postgres role is reserved for migrations.`,
      );
    }
  }

  if (issues.length > 0) throw new EnvValidationError(issues);
  return { runtimeDatabaseUrl };
}
