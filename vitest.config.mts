import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    // Mismo alias que `paths` en tsconfig.json: `@/*` → raíz del repo.
    alias: [
      {
        find: /^@\//,
        replacement: fileURLToPath(new URL("./", import.meta.url)),
      },
    ],
  },
  test: {
    // Unit y lógica de servidor, sin DOM. tests/tenant/ (Postgres real) y
    // tests/e2e/ (Playwright) tendrán su propia configuración cuando existan.
    include: ["tests/unit/**/*.test.ts"],
    environment: "node",
  },
});
