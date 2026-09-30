import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

/*
 * Acceptance contra el proyecto Supabase de staging (`pnpm test:staging`).
 * Solo los corre el workflow Staging DB (.github/workflows/staging-db.yml),
 * con los secrets del environment `staging`: nunca CI ni una máquina local.
 * En serie y sin reintentos: un fallo contra staging se investiga.
 */
export default defineConfig({
  resolve: {
    alias: [
      {
        find: /^@\//,
        replacement: fileURLToPath(new URL("./", import.meta.url)),
      },
    ],
  },
  test: {
    include: ["tests/staging/**/*.test.ts"],
    environment: "node",
    fileParallelism: false,
    retry: 0,
    testTimeout: 120_000,
    hookTimeout: 300_000,
  },
});
