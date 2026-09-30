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

/*
 * Reversión de 0000_saas_core_schema. drizzle-kit no tiene down migrations:
 * esto no es parte del producto. Prueba que la huella de la migración es
 * exactamente la declarada (volver al catálogo previo) y que se puede
 * recrear limpia. Restaura los default privileges de Supabase del shim.
 */
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

  it("registra 0000_saas_core_schema en el historial de drizzle", async () => {
    expect(await appliedMigrations()).toBe(1);
  });

  it("volver a migrar no cambia nada", async () => {
    await runMigrations(db.migrationUrl);

    expect(await appliedMigrations()).toBe(1);
    expect(await catalogSnapshot(db.admin)).toEqual(afterMigration);
  });

  it("se revierte al catálogo previo y se vuelve a aplicar idéntica", async () => {
    const revert = postgres(db.migrationUrl, { max: 1, onnotice: () => {} });
    try {
      // La reversión corre con la credencial de migración, dueña de todo.
      await revert.begin((tx) => tx.unsafe(REVERT_0000));
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
