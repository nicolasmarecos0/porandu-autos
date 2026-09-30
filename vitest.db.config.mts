import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

/*
 * Tests contra un PostgreSQL 17 real y desechable (`pnpm test:db`), nunca
 * staging. Requieren TEST_ADMIN_DATABASE_URL (ver README). Corren en serie:
 * comparten los roles del cluster.
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
    include: ["tests/db/**/*.test.ts"],
    environment: "node",
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 120_000,
  },
});
