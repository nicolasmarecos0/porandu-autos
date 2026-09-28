import { defineConfig } from "drizzle-kit";

/*
 * drizzle-kit del spike ADR-001. Es el ÚNICO lugar del spike que lee la
 * credencial de migración (`postgres`). El runtime nunca la ve: usa
 * SPIKE_RUNTIME_URL (`app_runtime`).
 */
export default defineConfig({
  dialect: "postgresql",
  schema: "./spikes/adr-001/src/schema.ts",
  out: "./spikes/adr-001/migrations",
  schemaFilter: ["public"],
  entities: { roles: { provider: "supabase" } },
  dbCredentials: {
    url: process.env.SPIKE_MIGRATION_URL ?? "",
  },
});
