/*
 * E2 · conexiones a Supabase staging derivadas DENTRO del proceso.
 *
 * Nadie arma connection strings a mano y ninguna URL con credenciales pasa por
 * el shell ni por los logs. Entradas (GitHub Actions secrets → env):
 *   SPIKE_STAGING_POOLER_URL   el "Session pooler" tal como lo muestra Supabase
 *                              (Connect → Session pooler). Puede conservar
 *                              `[YOUR-PASSWORD]`: de acá solo se toman usuario,
 *                              host y base de datos.
 *   SPIKE_STAGING_DB_PASSWORD  password de la base (rol `postgres`).
 *   SPIKE_SUPABASE_URL         https://<project_ref>.supabase.co
 *   SPIKE_APP_RUNTIME_PASSWORD efímera, generada en el runner (solo runtime).
 *
 * Mismo host del pooler compartido: 5432 = modo sesión (migraciones y harness),
 * 6543 = modo transacción (runtime objetivo). TLS con sslmode=require.
 *
 * Solo sintaxis TypeScript borrable: scripts/*.mjs lo importan con Node.
 */

type Env = Record<string, string | undefined>;

export type StagingDb = {
  readonly projectRef: string;
  readonly host: string;
  readonly database: string;
  readonly region: string | null;
};

export type StagingUrls = {
  readonly migrationUrl: string;
  readonly runtimeSessionUrl: string;
  readonly runtimeTransactionUrl: string;
  readonly postgresTransactionUrl: string;
};

const POOLER_RE =
  /^postgres(?:ql)?:\/\/([^:@/\s]+)(?::[^@\s]*)?@([^:/?#\s]+)(?::(\d+))?\/([^?#\s]*)/;

function need(env: Env, name: string): string {
  const value = env[name]?.trim();
  if (!value) throw new Error(`Falta la variable ${name}`);
  return value;
}

/** Valida y descompone el Session pooler string. Nunca incluye valores en los errores. */
export function parseStagingDb(env: Env = process.env): StagingDb {
  const match = POOLER_RE.exec(need(env, "SPIKE_STAGING_POOLER_URL"));
  if (!match) {
    throw new Error(
      "SPIKE_STAGING_POOLER_URL no tiene el formato postgresql://postgres.<ref>:…@<host>:5432/postgres",
    );
  }
  const user = match[1] ?? "";
  const host = match[2] ?? "";
  const database = match[4] || "postgres";
  const userMatch = /^postgres\.([a-z0-9]{20})$/.exec(user);
  if (!userMatch?.[1]) {
    throw new Error(
      "El usuario del pooler debe ser postgres.<project_ref> (Session pooler de Supabase)",
    );
  }
  if (!host.endsWith(".pooler.supabase.com")) {
    throw new Error(
      "El host debe ser el pooler compartido de Supabase (*.pooler.supabase.com)",
    );
  }
  const projectRef = userMatch[1];
  let apiHost: string;
  try {
    apiHost = new URL(need(env, "SPIKE_SUPABASE_URL")).hostname;
  } catch {
    throw new Error("SPIKE_SUPABASE_URL no es una URL válida");
  }
  if (apiHost !== `${projectRef}.supabase.co`) {
    throw new Error(
      "El project ref del Session pooler no coincide con SPIKE_SUPABASE_URL",
    );
  }
  const region = /^aws-\d+-([a-z0-9-]+)\.pooler\.supabase\.com$/.exec(host);
  return { projectRef, host, database, region: region?.[1] ?? null };
}

function buildUrl(
  db: StagingDb,
  user: string,
  password: string,
  port: 5432 | 6543,
): string {
  return `postgresql://${encodeURIComponent(user)}:${encodeURIComponent(password)}@${db.host}:${port}/${db.database}?sslmode=require`;
}

/** Credencial de migración: `postgres` vía pooler en modo sesión. */
export function stagingMigrationUrl(env: Env = process.env): string {
  const db = parseStagingDb(env);
  return buildUrl(
    db,
    `postgres.${db.projectRef}`,
    need(env, "SPIKE_STAGING_DB_PASSWORD"),
    5432,
  );
}

export function stagingUrls(env: Env = process.env): StagingUrls {
  const db = parseStagingDb(env);
  const dbPassword = need(env, "SPIKE_STAGING_DB_PASSWORD");
  const runtimePassword = need(env, "SPIKE_APP_RUNTIME_PASSWORD");
  return {
    migrationUrl: buildUrl(db, `postgres.${db.projectRef}`, dbPassword, 5432),
    runtimeSessionUrl: buildUrl(
      db,
      `app_runtime.${db.projectRef}`,
      runtimePassword,
      5432,
    ),
    runtimeTransactionUrl: buildUrl(
      db,
      `app_runtime.${db.projectRef}`,
      runtimePassword,
      6543,
    ),
    postgresTransactionUrl: buildUrl(
      db,
      `postgres.${db.projectRef}`,
      dbPassword,
      6543,
    ),
  };
}
