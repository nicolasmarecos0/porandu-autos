/*
 * Credencial de migración (ADR-001 §2 y §4).
 *
 * Validación pura: recibe el valor y no lee `process.env`. El único punto de
 * lectura de `MIGRATION_DATABASE_URL` es `drizzle.config.ts`; el runtime
 * nunca la referencia. Los imports son relativos porque drizzle-kit carga
 * este módulo fuera de Next, sin el alias `@/`.
 */
import { databaseRole, EnvValidationError } from "../lib/env";

const MIGRATION_ROLE = "postgres";

export function parseMigrationDatabaseUrl(value: string | undefined): string {
  const url = value?.trim() ?? "";
  if (url === "") {
    throw new EnvValidationError(["MIGRATION_DATABASE_URL is required."]);
  }

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new EnvValidationError([
      "MIGRATION_DATABASE_URL must be a postgres:// URL.",
    ]);
  }
  if (parsed.protocol !== "postgres:" && parsed.protocol !== "postgresql:") {
    throw new EnvValidationError([
      "MIGRATION_DATABASE_URL must be a postgres:// URL.",
    ]);
  }

  // Las migraciones corren como postgres; nunca con la credencial de runtime.
  if (databaseRole(parsed) !== MIGRATION_ROLE) {
    throw new EnvValidationError([
      `MIGRATION_DATABASE_URL must connect as ${MIGRATION_ROLE} (ADR-001). The app_runtime role is reserved for the application runtime.`,
    ]);
  }

  return url;
}
