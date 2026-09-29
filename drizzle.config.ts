import { defineConfig } from "drizzle-kit";

import { parseMigrationDatabaseUrl } from "./db/migration-env";

/*
 * drizzle-kit usa exclusivamente la credencial de migración (rol postgres,
 * ADR-001 §2). Este es el único archivo que puede leer
 * MIGRATION_DATABASE_URL, y ESLint le prohíbe leer RUNTIME_DATABASE_URL.
 */
export default defineConfig({
  dialect: "postgresql",
  schema: "./db/schema/index.ts",
  out: "./db/migrations",
  dbCredentials: {
    url: parseMigrationDatabaseUrl(process.env.MIGRATION_DATABASE_URL),
  },
});
