import { readdir, readFile } from "node:fs/promises";

import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { catalogSnapshot, tableNames } from "./support/catalog";
import {
  runMigrations,
  startTestServer,
  type TestDatabase,
  type TestServer,
} from "./support/postgres";

/*
 * Migraciones de db/migrations aplicadas desde cero con `pnpm db:migrate`
 * sobre PostgreSQL 17 (con el mínimo de Supabase de supabase-shim.sql).
 */

const MIGRATIONS_DIR = new URL("../../db/migrations/", import.meta.url);

/*
 * Reversión de 0001_tenant_isolation y 0000_saas_core_schema. drizzle-kit
 * no tiene down migrations: esto no es parte del producto. Prueba que la
 * huella de las migraciones es exactamente la declarada (volver al catálogo
 * previo, incluido el rol app_runtime) y que se pueden recrear limpias.
 * Restaura los default privileges de Supabase del shim.
 */
const REVERT_0001 = `
  DROP POLICY memberships_select_member ON public.memberships;
  DROP POLICY profiles_select_own ON public.profiles;
  DROP POLICY organizations_select_member ON public.organizations;
  REVOKE SELECT ON public.organizations, public.profiles, public.memberships FROM authenticated;
  DROP FUNCTION private.user_org_ids();
  DROP SCHEMA private;
  REVOKE authenticated FROM app_runtime;
  DROP ROLE app_runtime;
`;

const REVERT_0000 = `
  DROP TABLE public.memberships;
  DROP TABLE public.profiles;
  DROP TABLE public.organizations;
  DROP TYPE public.membership_role;
  ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated;
  ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON SEQUENCES TO anon, authenticated;
  ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON FUNCTIONS TO anon, authenticated;
  DROP SCHEMA drizzle CASCADE;
`;

let server: TestServer;
let db: TestDatabase;
let beforeMigration: unknown;
let afterMigration: unknown;

beforeAll(async () => {
  server = await startTestServer();
  db = await server.createDatabase();
  beforeMigration = await catalogSnapshot(db.admin);
  await runMigrations(db.migrationUrl);
  afterMigration = await catalogSnapshot(db.admin);
});

afterAll(async () => {
  await server?.close();
});

async function appliedMigrations(): Promise<number> {
  const [row] = await db.admin<{ count: number }[]>`
    SELECT count(*)::int AS count FROM drizzle.__drizzle_migrations
  `;
  return row?.count ?? 0;
}

describe("migraciones desde cero (PostgreSQL 17)", () => {
  it("corre sobre PostgreSQL 17", async () => {
    const [row] = await db.admin<{ version: number }[]>`
      SELECT current_setting('server_version_num')::int AS version
    `;
    expect(row?.version).toBeGreaterThanOrEqual(170000);
    expect(row?.version).toBeLessThan(180000);
  });

  it("migra como postgres sin superuser, igual que en Supabase", async () => {
    const [role] = await db.admin<{ super: boolean; bypassRls: boolean }[]>`
      SELECT rolsuper AS super, rolbypassrls AS "bypassRls"
      FROM pg_roles WHERE rolname = 'postgres'
    `;
    expect(role).toEqual({ super: false, bypassRls: true });

    const [owners] = await db.admin<{ owners: string[] }[]>`
      SELECT array_agg(DISTINCT tableowner) AS owners
      FROM pg_tables WHERE schemaname = 'public'
    `;
    expect(owners?.owners).toEqual(["postgres"]);
  });

  it("crea solo organizations, profiles y memberships en public", async () => {
    expect(await tableNames(db.admin, "public")).toEqual([
      "memberships",
      "organizations",
      "profiles",
    ]);
  });

  it("registra 0000_saas_core_schema y 0001_tenant_isolation en el historial de drizzle", async () => {
    expect(await appliedMigrations()).toBe(2);
  });

  it("volver a migrar no cambia nada", async () => {
    await runMigrations(db.migrationUrl);

    expect(await appliedMigrations()).toBe(2);
    expect(await catalogSnapshot(db.admin)).toEqual(afterMigration);
  });

  it("ninguna migración versiona passwords", async () => {
    const files = (await readdir(MIGRATIONS_DIR)).filter((f) =>
      f.endsWith(".sql"),
    );
    expect(files).toEqual([
      "0000_saas_core_schema.sql",
      "0001_tenant_isolation.sql",
    ]);
    for (const file of files) {
      const content = await readFile(new URL(file, MIGRATIONS_DIR), "utf8");
      // Ninguna cláusula PASSWORD '…' (la palabra puede aparecer en comentarios).
      expect(content).not.toMatch(/\bPASSWORD\s+(E?'|\$|NULL)/i);
    }
  });

  it("se revierte al catálogo previo y se vuelve a aplicar idéntica", async () => {
    const revert = postgres(db.migrationUrl, { max: 1, onnotice: () => {} });
    try {
      // La reversión corre con la credencial de migración, dueña de todo.
      await revert.begin(async (tx) => {
        await tx.unsafe(REVERT_0001);
        await tx.unsafe(REVERT_0000);
      });
    } finally {
      await revert.end();
    }
    expect(await catalogSnapshot(db.admin)).toEqual(beforeMigration);

    await runMigrations(db.migrationUrl);
    expect(await catalogSnapshot(db.admin)).toEqual(afterMigration);
  });

  it("una base nueva queda con el mismo catálogo", async () => {
    const fresh = await server.createDatabase();
    await runMigrations(fresh.migrationUrl);

    expect(await catalogSnapshot(fresh.admin)).toEqual(afterMigration);
  });
});

/*
 * Postcondiciones de 0001 (ADR-001 §3.6): si la base no cumple las
 * invariantes, la migración falla y no aplica nada (el migrator corre todas
 * las migraciones pendientes en una transacción). Cada caso deshace su
 * estado inseguro: los roles son del cluster.
 *
 * `pnpm db:migrate` también falla, pero drizzle-kit no imprime el error de
 * Postgres. Para verificar que la causa es la postcondición, estos casos
 * usan el migrator de drizzle-orm, el mismo que corre drizzle-kit.
 */
async function migrateReportingErrors(migrationUrl: string): Promise<void> {
  const client = postgres(migrationUrl, { max: 1, onnotice: () => {} });
  try {
    await migrate(drizzle(client), {
      migrationsFolder: MIGRATIONS_DIR.pathname,
    });
  } finally {
    await client.end();
  }
}

describe("0001 falla cerrada ante un estado inseguro", () => {
  const unsafeStates: [string, string, string][] = [
    [
      "app_runtime preexistente con INHERIT",
      "ALTER ROLE app_runtime INHERIT",
      "ALTER ROLE app_runtime NOINHERIT",
    ],
    [
      "app_runtime preexistente con BYPASSRLS",
      "ALTER ROLE app_runtime BYPASSRLS",
      "ALTER ROLE app_runtime NOBYPASSRLS",
    ],
    [
      "app_runtime miembro de service_role",
      "GRANT service_role TO app_runtime",
      "REVOKE service_role FROM app_runtime",
    ],
    [
      "authenticated con CREATE en public",
      "GRANT CREATE ON SCHEMA public TO authenticated",
      "REVOKE CREATE ON SCHEMA public FROM authenticated",
    ],
  ];

  it.each(unsafeStates)("%s", async (_, unsafe, restore) => {
    const fresh = await server.createDatabase();
    const before = await catalogSnapshot(fresh.admin);
    await fresh.admin.unsafe(unsafe);
    try {
      await expect(runMigrations(fresh.migrationUrl)).rejects.toThrow(
        "pnpm db:migrate failed",
      );
      await expect(
        migrateReportingErrors(fresh.migrationUrl),
      ).rejects.toMatchObject({
        cause: { message: expect.stringMatching(/^ADR-001: /) },
      });
      expect(await tableNames(fresh.admin, "public")).toEqual([]);
    } finally {
      await fresh.admin.unsafe(restore);
    }
    // Solo queda el historial de drizzle, vacío: el migrator lo crea antes
    // de abrir la transacción.
    const [history] = await fresh.admin<{ count: number }[]>`
      SELECT count(*)::int AS count FROM drizzle.__drizzle_migrations
    `;
    expect(history?.count).toBe(0);
    await fresh.admin`DROP SCHEMA drizzle CASCADE`;
    expect(await catalogSnapshot(fresh.admin)).toEqual(before);
  });
});
