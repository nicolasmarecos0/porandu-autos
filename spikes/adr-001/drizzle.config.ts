import { defineConfig } from "drizzle-kit";
import { stagingMigrationUrl } from "./test/support/staging";

/*
 * drizzle-kit del spike ADR-001. Es el ÚNICO lugar del spike que lee la
 * credencial de migración (`postgres`). El runtime nunca la ve: usa
 * SPIKE_RUNTIME_URL (`app_runtime`).
 *   e0/e1: SPIKE_MIGRATION_URL.
 *   e2:    derivada en proceso desde los secrets de staging (pooler en modo
 *          sesión), sin que la URL pase por el shell ni por los logs.
 */
export default defineConfig({
  dialect: "postgresql",
  schema: "./spikes/adr-001/src/schema.ts",
  out: "./spikes/adr-001/migrations",
  schemaFilter: ["public"],
  entities: { roles: { provider: "supabase" } },
  dbCredentials: {
    url:
      process.env.SPIKE_TARGET === "e2"
        ? stagingMigrationUrl()
        : (process.env.SPIKE_MIGRATION_URL ?? ""),
  },
});
