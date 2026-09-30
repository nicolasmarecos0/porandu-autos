import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { redact } from "./target.mts";

/*
 * Aplica las migraciones oficiales con el script del repositorio
 * (`pnpm db:migrate`: drizzle-kit, drizzle.config.ts y db/migrations, la
 * única fuente). La URL de migración (rol postgres) se pasa solo al proceso
 * hijo, nunca por el shell ni por argumentos. El hijo no hereda ninguna
 * credencial de runtime.
 *
 * drizzle-kit aplica todas las pendientes en una sola transacción: si una
 * falla, no queda ninguna aplicada. Sale con código 1 sin imprimir el error
 * de Postgres; la causa queda en el log de la base (Supabase → Logs).
 */

const execFileAsync = promisify(execFile);
const ROOT = fileURLToPath(new URL("../../", import.meta.url));

/** Variables que el proceso de migración nunca recibe. */
const RUNTIME_ONLY = [
  "RUNTIME_DATABASE_URL",
  "STAGING_RUNTIME_DB_PASSWORD",
  "STAGING_SECRET_KEY",
];

export async function runOfficialMigrations(
  migrationUrl: string,
  secrets: readonly string[],
): Promise<string> {
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    MIGRATION_DATABASE_URL: migrationUrl,
  };
  for (const name of RUNTIME_ONLY) delete env[name];

  try {
    const { stdout, stderr } = await execFileAsync(
      "pnpm",
      ["--silent", "db:migrate"],
      { cwd: ROOT, env, timeout: 10 * 60 * 1000 },
    );
    return redact(`${stdout}${stderr}`, [...secrets, migrationUrl]).trim();
  } catch (error) {
    const { stdout, stderr, code } = error as {
      stdout?: string;
      stderr?: string;
      code?: unknown;
    };
    const output = redact(`${stdout ?? ""}${stderr ?? ""}`, [
      ...secrets,
      migrationUrl,
    ]).trim();
    throw new Error(
      `pnpm db:migrate failed (exit ${String(code)}). Pending migrations run in a single transaction: none of them was applied.\n${output}`,
    );
  }
}
