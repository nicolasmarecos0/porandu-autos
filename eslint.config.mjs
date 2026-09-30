import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";
import prettier from "eslint-config-prettier/flat";

// ADR-001 §2/§3.1: la credencial de migración (postgres) no se lee en
// runtime. Solo drizzle.config.ts se exceptúa.
const MIGRATION_URL_MESSAGE =
  "MIGRATION_DATABASE_URL is migration-only (ADR-001). Runtime code uses RUNTIME_DATABASE_URL via lib/env.server.ts.";
const noMigrationUrl = [
  {
    selector:
      "MemberExpression[property.name='MIGRATION_DATABASE_URL'], MemberExpression[property.value='MIGRATION_DATABASE_URL']",
    message: MIGRATION_URL_MESSAGE,
  },
  {
    selector:
      "VariableDeclarator[init.property.name='env'] > ObjectPattern > Property[key.name='MIGRATION_DATABASE_URL']",
    message: MIGRATION_URL_MESSAGE,
  },
];

// A la inversa, drizzle.config.ts no puede leer RUNTIME_DATABASE_URL.
const RUNTIME_URL_MESSAGE =
  "drizzle-kit uses MIGRATION_DATABASE_URL only (ADR-001). RUNTIME_DATABASE_URL belongs to the application runtime.";
const noRuntimeUrl = [
  {
    selector:
      "MemberExpression[property.name='RUNTIME_DATABASE_URL'], MemberExpression[property.value='RUNTIME_DATABASE_URL']",
    message: RUNTIME_URL_MESSAGE,
  },
  {
    selector:
      "VariableDeclarator[init.property.name='env'] > ObjectPattern > Property[key.name='RUNTIME_DATABASE_URL']",
    message: RUNTIME_URL_MESSAGE,
  },
];

// DEC-006 / ADR-001: db/client es la conexión de bajo nivel. Solo
// db/tenant.ts (withUser/withTenant) la importa; los imports de tipos no
// abren conexiones y se permiten.
const DB_CLIENT_MESSAGE =
  "db/client is the low-level runtime connection (ADR-001). Access data through withUser()/withTenant() in db/tenant.ts.";
const dbClientImport = {
  regex: "(^|/)db/client$",
  allowTypeImports: true,
  message: DB_CLIENT_MESSAGE,
};
// Dentro de db/, también por ruta relativa (./client, ../client).
const dbClientRelativeImport = {
  regex: "^\\.{1,2}/client$",
  allowTypeImports: true,
  message: DB_CLIENT_MESSAGE,
};
// import() dinámico: no-restricted-imports no lo cubre.
const noDbClientDynamicImport = {
  selector: "ImportExpression[source.value=/(^|\\/)db\\/client$/]",
  message: DB_CLIENT_MESSAGE,
};
const noDbClientRelativeDynamicImport = {
  selector: "ImportExpression[source.value=/^\\.{1,2}\\/client$/]",
  message: DB_CLIENT_MESSAGE,
};

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  prettier,
  {
    rules: {
      "no-restricted-syntax": [
        "error",
        ...noMigrationUrl,
        noDbClientDynamicImport,
      ],
      "no-restricted-imports": ["error", { patterns: [dbClientImport] }],
    },
  },
  {
    files: ["db/**"],
    rules: {
      "no-restricted-syntax": [
        "error",
        ...noMigrationUrl,
        noDbClientDynamicImport,
        noDbClientRelativeDynamicImport,
      ],
      "no-restricted-imports": [
        "error",
        { patterns: [dbClientImport, dbClientRelativeImport] },
      ],
    },
  },
  // Excepción única para las URLs: drizzle.config.ts lee
  // MIGRATION_DATABASE_URL y no puede leer RUNTIME_DATABASE_URL.
  {
    files: ["drizzle.config.ts"],
    rules: {
      "no-restricted-syntax": [
        "error",
        ...noRuntimeUrl,
        noDbClientDynamicImport,
      ],
    },
  },
  // Únicos módulos que acceden a db/client: el boundary y, en tests, la
  // prueba del propio cliente y el acceso de bajo nivel de tests/db.
  {
    files: [
      "db/tenant.ts",
      "tests/unit/db/client.test.ts",
      "tests/db/support/runtime.ts",
    ],
    rules: {
      "no-restricted-syntax": ["error", ...noMigrationUrl],
      "no-restricted-imports": "off",
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
