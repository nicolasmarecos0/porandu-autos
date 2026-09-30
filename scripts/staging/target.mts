/*
 * Destino de las operaciones de base de datos de staging (H0.8).
 *
 * Tooling del workflow `Staging DB` (.github/workflows/staging-db.yml) y de
 * sus tests. La aplicación nunca lo importa (tests/unit/auth/boundaries.test.ts).
 *
 * Recibe los GitHub secrets por variables de entorno y deriva todo dentro del
 * proceso: ninguna URL con credenciales pasa por el shell ni por los logs, y
 * ningún mensaje de error incluye un valor, solo el nombre de la variable.
 *
 * El proyecto de staging se identifica por su project ref, que tiene que
 * coincidir en cuatro fuentes independientes:
 *   - STAGING_PROJECT_REF: variable (no secreta) del environment `staging`;
 *   - STAGING_CONFIRM_PROJECT_REF: lo que tipea quien dispara el workflow;
 *   - STAGING_SUPABASE_URL: https://<ref>.supabase.co;
 *   - STAGING_SESSION_POOLER_URL: usuario postgres.<ref> del Session pooler.
 * Además, el pooler tiene que ser el de Supabase en sa-east-1 (ADR-001 §5).
 * Cualquier diferencia aborta antes de abrir una conexión.
 */

export type EnvSource = Readonly<Record<string, string | undefined>>;

export class StagingConfigError extends Error {
  readonly issues: readonly string[];

  constructor(issues: readonly string[]) {
    super(
      `Invalid staging configuration:\n${issues.map((i) => `- ${i}`).join("\n")}`,
    );
    this.name = "StagingConfigError";
    this.issues = issues;
  }
}

/** Región del proyecto de staging (ADR-001 §5, E2). */
export const STAGING_REGION = "sa-east-1";

/** Session pooler (modo sesión): migraciones, preflight y verificación. */
export const SESSION_POOLER_PORT = 5432;
/** Transaction pooler (modo transacción): runtime (ADR-001 §2). */
export const TRANSACTION_POOLER_PORT = 6543;

const DATABASE = "postgres";
const PROJECT_REF = /^[a-z0-9]{20}$/;
const POOLER_HOST = /^aws-\d+-([a-z0-9-]+)\.pooler\.supabase\.com$/;
/*
 * postgresql://<user>[:<password>]@<host>[:<port>]/<database>. La password
 * no se captura: puede contener cualquier carácter (o el placeholder
 * `[YOUR-PASSWORD]` que muestra Supabase). El host es lo que sigue a la
 * última `@`.
 */
const POOLER_STRING =
  /^postgres(?:ql)?:\/\/([^:@/\s]+)(?::.*)?@([^:@/?#\s]+)(?::(\d+))?\/([^?#\s]*)(?:\?\S*)?$/;

/*
 * Password de app_runtime: solo caracteres URL-safe no reservados (no hace
 * falta codificarla en la URL y SASLprep la deja igual) y al menos 32.
 * Recomendado: `openssl rand -hex 32` (64 caracteres).
 */
const RUNTIME_PASSWORD = /^[A-Za-z0-9._~-]{32,128}$/;

export type StagingTarget = Readonly<{
  projectRef: string;
  region: string;
  /** Host del pooler compartido de Supabase (sesión y transacción). */
  poolerHost: string;
  database: string;
  /** https://<ref>.supabase.co, sin barra final. */
  supabaseUrl: string;
}>;

function read(env: EnvSource, name: string, issues: string[]): string {
  const value = env[name]?.trim() ?? "";
  if (value === "") issues.push(`${name} is required.`);
  return value;
}

/**
 * Valida el destino. No abre conexiones ni lee passwords: solo identidad
 * del proyecto.
 */
export function parseStagingTarget(env: EnvSource): StagingTarget {
  const issues: string[] = [];

  const projectRef = read(env, "STAGING_PROJECT_REF", issues);
  if (projectRef !== "" && !PROJECT_REF.test(projectRef)) {
    issues.push("STAGING_PROJECT_REF must be a Supabase project ref.");
  }

  const confirmation = read(env, "STAGING_CONFIRM_PROJECT_REF", issues);
  if (confirmation !== "" && confirmation !== projectRef) {
    issues.push(
      "STAGING_CONFIRM_PROJECT_REF (workflow input) does not match STAGING_PROJECT_REF.",
    );
  }

  const rawSupabaseUrl = read(env, "STAGING_SUPABASE_URL", issues);
  let supabaseUrl = "";
  if (rawSupabaseUrl !== "") {
    let url: URL | null = null;
    try {
      url = new URL(rawSupabaseUrl);
    } catch {
      issues.push("STAGING_SUPABASE_URL must be a URL.");
    }
    if (url) {
      if (
        url.protocol !== "https:" ||
        url.username !== "" ||
        url.password !== "" ||
        url.port !== "" ||
        !["", "/"].includes(url.pathname) ||
        url.search !== "" ||
        url.hash !== ""
      ) {
        issues.push(
          "STAGING_SUPABASE_URL must be https://<project_ref>.supabase.co.",
        );
      } else if (url.hostname !== `${projectRef}.supabase.co`) {
        issues.push(
          "STAGING_SUPABASE_URL does not belong to STAGING_PROJECT_REF.",
        );
      } else {
        supabaseUrl = url.origin;
      }
    }
  }

  const poolerString = read(env, "STAGING_SESSION_POOLER_URL", issues);
  let poolerHost = "";
  let region = "";
  if (poolerString !== "") {
    const match = POOLER_STRING.exec(poolerString);
    if (!match) {
      issues.push(
        "STAGING_SESSION_POOLER_URL must be the Supabase Session pooler string (postgresql://postgres.<project_ref>:…@<host>:5432/postgres).",
      );
    } else {
      const [, user = "", host = "", port = "", database = ""] = match;
      if (user !== `postgres.${projectRef}`) {
        issues.push(
          "STAGING_SESSION_POOLER_URL user must be postgres.<STAGING_PROJECT_REF>.",
        );
      }
      const hostMatch = POOLER_HOST.exec(host);
      if (!hostMatch) {
        issues.push(
          "STAGING_SESSION_POOLER_URL host must be the shared Supabase pooler (aws-N-<region>.pooler.supabase.com).",
        );
      } else if (hostMatch[1] !== STAGING_REGION) {
        issues.push(`STAGING_SESSION_POOLER_URL must be in ${STAGING_REGION}.`);
      } else {
        poolerHost = host;
        region = STAGING_REGION;
      }
      if (port !== String(SESSION_POOLER_PORT)) {
        issues.push(
          `STAGING_SESSION_POOLER_URL must use the Session pooler port ${SESSION_POOLER_PORT}.`,
        );
      }
      if (database !== DATABASE) {
        issues.push(`STAGING_SESSION_POOLER_URL database must be ${DATABASE}.`);
      }
    }
  }

  if (issues.length > 0) throw new StagingConfigError(issues);
  return { projectRef, region, poolerHost, database: DATABASE, supabaseUrl };
}

/** Password del rol `postgres` del proyecto: solo migraciones y tooling. */
export function readMigrationPassword(env: EnvSource): string {
  const issues: string[] = [];
  const password = env.STAGING_DB_PASSWORD ?? "";
  if (password.trim() === "") issues.push("STAGING_DB_PASSWORD is required.");
  else if (password.includes("YOUR-PASSWORD")) {
    issues.push(
      "STAGING_DB_PASSWORD still contains the [YOUR-PASSWORD] placeholder.",
    );
  }
  if (issues.length > 0) throw new StagingConfigError(issues);
  return password;
}

/**
 * Password de app_runtime (STAGING_RUNTIME_DB_PASSWORD). Nunca puede ser la
 * de `postgres`: si el paso también recibe STAGING_DB_PASSWORD, se compara.
 */
export function readRuntimePassword(env: EnvSource): string {
  const issues: string[] = [];
  const password = env.STAGING_RUNTIME_DB_PASSWORD ?? "";
  if (password === "") {
    issues.push("STAGING_RUNTIME_DB_PASSWORD is required.");
  } else if (!RUNTIME_PASSWORD.test(password)) {
    issues.push(
      "STAGING_RUNTIME_DB_PASSWORD must be 32–128 characters from [A-Za-z0-9._~-] (e.g. `openssl rand -hex 32`).",
    );
  }
  const migrationPassword = env.STAGING_DB_PASSWORD;
  if (password !== "" && migrationPassword && password === migrationPassword) {
    issues.push(
      "STAGING_RUNTIME_DB_PASSWORD must not reuse the postgres password (STAGING_DB_PASSWORD).",
    );
  }
  if (issues.length > 0) throw new StagingConfigError(issues);
  return password;
}

function databaseUrl(
  target: StagingTarget,
  role: "postgres" | "app_runtime",
  password: string,
  port: number,
): string {
  const url = new URL(`postgresql://${target.poolerHost}`);
  // Supavisor enruta por `<rol>.<project_ref>` (ADR-001 §2).
  url.username = `${role}.${target.projectRef}`;
  // El setter de URL no codifica `%`: se codifica todo explícitamente para
  // que postgres-js (decodeURIComponent) recupere la password exacta.
  url.password = encodeURIComponent(password);
  url.port = String(port);
  url.pathname = `/${target.database}`;
  // TLS sin verificar la CA, como E2. verify-full queda para E3 (ADR-001 §7).
  url.searchParams.set("sslmode", "require");
  return url.toString();
}

/**
 * MIGRATION_DATABASE_URL de staging: `postgres` por el Session pooler (5432).
 * Solo para drizzle-kit, el preflight, la verificación y los fixtures.
 */
export function migrationDatabaseUrl(
  target: StagingTarget,
  password: string,
): string {
  return databaseUrl(target, "postgres", password, SESSION_POOLER_PORT);
}

/**
 * RUNTIME_DATABASE_URL de staging: `app_runtime` por el Transaction pooler
 * (6543). db/client.ts ya usa `prepare: false`. Se construye en memoria y
 * nunca se escribe en el repo ni en los logs.
 */
export function runtimeDatabaseUrl(
  target: StagingTarget,
  password: string,
): string {
  return databaseUrl(target, "app_runtime", password, TRANSACTION_POOLER_PORT);
}

/**
 * Formas en que un secreto puede aparecer en un texto: literal y
 * URL-encoded. GitHub solo enmascara el valor literal del secret.
 */
export function secretVariants(secrets: readonly string[]): string[] {
  const variants = new Set<string>();
  for (const secret of secrets) {
    if (secret === "") continue;
    variants.add(secret);
    variants.add(encodeURIComponent(secret));
  }
  // Primero las más largas: una variante puede contener a otra.
  return [...variants].sort((a, b) => b.length - a.length);
}

/** Registra las variantes como máscaras de GitHub Actions (`::add-mask::`). */
export function maskSecrets(
  secrets: readonly string[],
  write: (line: string) => void = (line) => process.stdout.write(`${line}\n`),
): void {
  for (const variant of secretVariants(secrets)) {
    write(`::add-mask::${variant}`);
  }
}

const CONNECTION_STRING = /postgres(?:ql)?:\/\/\S+/gi;

/**
 * Quita secretos y connection strings de un texto antes de imprimirlo
 * (salida de drizzle-kit, mensajes de error de drivers).
 */
export function redact(text: string, secrets: readonly string[]): string {
  let result = text.replace(CONNECTION_STRING, "postgresql://***");
  for (const variant of secretVariants(secrets)) {
    result = result.split(variant).join("***");
  }
  return result;
}
