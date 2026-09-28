import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

/*
 * Vitest del spike ADR-001. Los archivos corren en serie (comparten la base y
 * los fixtures) y en orden: 90-* contamina a propósito el pooler local.
 */
export default defineConfig({
  // Caché dentro del node_modules raíz (ignorado por git), no en spikes/.
  cacheDir: fileURLToPath(
    new URL("../../node_modules/.vite/adr-001", import.meta.url),
  ),
  test: {
    root: fileURLToPath(new URL(".", import.meta.url)),
    include: ["test/**/*.test.ts"],
    globalSetup: ["test/support/global-setup.ts"],
    fileParallelism: false,
    sequence: { shuffle: false },
    testTimeout: 120_000,
    hookTimeout: 120_000,
  },
});
