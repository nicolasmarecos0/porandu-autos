import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";
import prettier from "eslint-config-prettier/flat";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  prettier,
  // ADR-001 §2/§3.1: la credencial de migración (postgres) no se lee en
  // runtime. Solo drizzle.config.ts se exceptúa (bloque siguiente).
  {
    rules: {
      "no-restricted-syntax": [
        "error",
        {
          selector:
            "MemberExpression[property.name='MIGRATION_DATABASE_URL'], MemberExpression[property.value='MIGRATION_DATABASE_URL']",
          message:
            "MIGRATION_DATABASE_URL is migration-only (ADR-001). Runtime code uses RUNTIME_DATABASE_URL via lib/env.server.ts.",
        },
        {
          selector:
            "VariableDeclarator[init.property.name='env'] > ObjectPattern > Property[key.name='MIGRATION_DATABASE_URL']",
          message:
            "MIGRATION_DATABASE_URL is migration-only (ADR-001). Runtime code uses RUNTIME_DATABASE_URL via lib/env.server.ts.",
        },
      ],
    },
  },
  // Excepción única: drizzle.config.ts lee MIGRATION_DATABASE_URL y, a la
  // inversa, no puede leer RUNTIME_DATABASE_URL (ADR-001 §2).
  {
    files: ["drizzle.config.ts"],
    rules: {
      "no-restricted-syntax": [
        "error",
        {
          selector:
            "MemberExpression[property.name='RUNTIME_DATABASE_URL'], MemberExpression[property.value='RUNTIME_DATABASE_URL']",
          message:
            "drizzle-kit uses MIGRATION_DATABASE_URL only (ADR-001). RUNTIME_DATABASE_URL belongs to the application runtime.",
        },
        {
          selector:
            "VariableDeclarator[init.property.name='env'] > ObjectPattern > Property[key.name='RUNTIME_DATABASE_URL']",
          message:
            "drizzle-kit uses MIGRATION_DATABASE_URL only (ADR-001). RUNTIME_DATABASE_URL belongs to the application runtime.",
        },
      ],
    },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
]);

export default eslintConfig;
