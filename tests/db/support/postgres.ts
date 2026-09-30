import { execFile } from "node:child_process";
import { randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
import { promisify } from "node:util";

import postgres, { type Sql, type TransactionSql } from "postgres";

/*
 * PostgreSQL 17 desechable para probar las migraciones desde cero. Nunca
 * staging ni Supabase: el harness crea roles de cluster y bases de prueba,
 * así que solo acepta un servidor local y dedicado (ver README).
 *
 * TEST_ADMIN_DATABASE_URL es el superusuario de ese servidor. Las
 * migraciones no corren con él: corren con `pnpm db:migrate` como
 * `postgres`, un rol sin superuser, igual que en Supabase.
 */

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);
const execFileAsync = promisify(execFile);

export type TransactionFn = (tx: TransactionSql) => Promise<void>;

export type TestDatabase = {
  name: string;
  /** Superusuario conectado a la base de prueba. Solo fixtures y catálogo. */
  admin: Sql;
  /** Credencial de migración (`postgres`) para la base de prueba. */
  migrationUrl: string;
  /**
   * Credencial de runtime (`app_runtime`) para la base de prueba. Fija una
   * password aleatoria fuera de las migraciones, como en Supabase (ADR-001
   * §4). Requiere que 0001_tenant_isolation haya creado el rol.
   */
  runtimeUrl(): Promise<string>;
};

export type TestServer = {
  createDatabase(): Promise<TestDatabase>;
  close(): Promise<void>;
};

function adminUrl(): URL {
  const raw = process.env.TEST_ADMIN_DATABASE_URL?.trim() ?? "";
  if (raw === "") {
    throw new Error(
      "TEST_ADMIN_DATABASE_URL is required: superuser of a disposable local PostgreSQL 17 (see README).",
    );
  }
  const url = new URL(raw);
  if (!LOCAL_HOSTS.has(url.hostname)) {
    throw new Error(
      "TEST_ADMIN_DATABASE_URL must point to a disposable local server (localhost). Never staging.",
    );
  }
  return url;
}

function connect(url: URL, database: string): Sql {
  const target = new URL(url);
  target.pathname = `/${database}`;
  return postgres(target.toString(), { max: 1, onnotice: () => {} });
}

/*
 * Roles de cluster que Supabase trae y de los que depende la migración.
 * `postgres` imita al de Supabase: LOGIN, sin superuser, con BYPASSRLS y con
 * ADMIN OPTION sobre `authenticated` (puede otorgarlo a app_runtime, C9 de
 * ADR-001), sin heredarlo ni asumirlo. La password es aleatoria por corrida
 * y no sale del proceso.
 *
 * `app_runtime` lo crea la migración 0001. Se borra al empezar cada suite
 * para que cada una lo vea nacer como en un Supabase nuevo: ningún objeto le
 * otorga privilegios, así que el DROP no depende de las bases de prueba.
 */
async function prepareCluster(server: Sql): Promise<string> {
  const [cluster] = await server<
    { supabase: boolean; postgresSuper: boolean | null }[]
  >`
    SELECT
      EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'supabase_auth_admin') AS supabase,
      (SELECT rolsuper FROM pg_roles WHERE rolname = 'postgres') AS "postgresSuper"
  `;
  if (cluster?.supabase) {
    throw new Error(
      "TEST_ADMIN_DATABASE_URL points to Supabase. Use a plain disposable PostgreSQL 17.",
    );
  }
  if (cluster?.postgresSuper) {
    throw new Error(
      "The postgres role is a superuser on this server. Start it with another superuser (see README): in Supabase, postgres is not a superuser.",
    );
  }

  await server.unsafe(`
    DO $$
    BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'postgres') THEN
        CREATE ROLE postgres LOGIN NOSUPERUSER CREATEDB CREATEROLE BYPASSRLS;
      END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
        CREATE ROLE anon NOLOGIN NOINHERIT;
      END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
        CREATE ROLE authenticated NOLOGIN NOINHERIT;
      END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
        CREATE ROLE service_role NOLOGIN NOINHERIT BYPASSRLS;
      END IF;
    END
    $$;
    GRANT authenticated TO postgres WITH ADMIN OPTION, INHERIT FALSE, SET FALSE;
    DROP ROLE IF EXISTS app_runtime;
  `);

  // Hex: seguro para interpolar (ALTER ROLE no acepta parámetros).
  const password = randomBytes(24).toString("hex");
  await server.unsafe(`ALTER ROLE postgres PASSWORD '${password}'`);
  return password;
}

export async function startTestServer(): Promise<TestServer> {
  const url = adminUrl();
  const maintenanceDb = url.pathname.replace(/^\//, "") || "postgres";
  const server = connect(url, maintenanceDb);
  const shim = await readFile(
    new URL("./supabase-shim.sql", import.meta.url),
    "utf8",
  );
  const password = await prepareCluster(server);
  const databases: TestDatabase[] = [];

  return {
    async createDatabase() {
      // Nombre generado: seguro para interpolar como identificador.
      const name = `porandu_test_${randomBytes(6).toString("hex")}`;
      await server.unsafe(`CREATE DATABASE "${name}"`);
      await server.unsafe(`GRANT CREATE ON DATABASE "${name}" TO postgres`);

      const admin = connect(url, name);
      await admin.unsafe(shim);

      const migration = new URL(url);
      migration.username = "postgres";
      migration.password = password;
      migration.pathname = `/${name}`;

      const runtimeUrl = async () => {
        // Hex: seguro para interpolar (ALTER ROLE no acepta parámetros).
        const runtimePassword = randomBytes(24).toString("hex");
        await server.unsafe(
          `ALTER ROLE app_runtime PASSWORD '${runtimePassword}'`,
        );
        const runtime = new URL(migration);
        runtime.username = "app_runtime";
        runtime.password = runtimePassword;
        return runtime.toString();
      };

      const database = {
        name,
        admin,
        migrationUrl: migration.toString(),
        runtimeUrl,
      };
      databases.push(database);
      return database;
    },

    async close() {
      for (const { name, admin } of databases) {
        await admin.end();
        await server.unsafe(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
      }
      await server.end();
    },
  };
}

/*
 * Aplica las migraciones con el script real (`pnpm db:migrate`, drizzle-kit)
 * y la credencial de migración de la base de prueba. La variable del
 * entorno prevalece sobre un `.env.local` local.
 */
export async function runMigrations(migrationUrl: string): Promise<string> {
  try {
    const { stdout } = await execFileAsync("pnpm", ["--silent", "db:migrate"], {
      env: { ...process.env, MIGRATION_DATABASE_URL: migrationUrl },
    });
    return stdout;
  } catch (error) {
    const { stdout, stderr } = error as { stdout?: string; stderr?: string };
    throw new Error(
      `pnpm db:migrate failed:\n${stdout ?? ""}\n${stderr ?? ""}`,
    );
  }
}

class Rollback extends Error {}

/** Ejecuta `fn` en una transacción que siempre termina en ROLLBACK. */
export async function inRolledBackTransaction(
  sql: Sql,
  fn: TransactionFn,
): Promise<void> {
  try {
    await sql.begin(async (tx) => {
      await fn(tx);
      throw new Rollback();
    });
  } catch (error) {
    if (!(error instanceof Rollback)) throw error;
  }
}

export type DatabaseRole =
  "anon" | "authenticated" | "postgres" | "app_runtime";

/*
 * Ejecuta `fn` como `role` dentro de un savepoint. Si falla, el ROLLBACK TO
 * SAVEPOINT deshace también el SET LOCAL ROLE y la transacción sigue usable.
 */
export async function asRole<T>(
  tx: TransactionSql,
  role: DatabaseRole,
  fn: (sp: TransactionSql) => Promise<T>,
): Promise<T> {
  return tx.savepoint(async (sp) => {
    await sp.unsafe(`SET LOCAL ROLE ${role}`);
    const result = await fn(sp);
    await sp`RESET ROLE`;
    return result;
  }) as Promise<T>;
}
