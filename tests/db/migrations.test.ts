import { readdir, readFile } from "node:fs/promises";

import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { catalogSnapshot, tableNames } from "./support/catalog";
import {
  migrateUpTo,
  runMigrations,
  startTestServer,
  type TestDatabase,
  type TestServer,
} from "./support/postgres";
import { OPPORTUNITIES, seedOpportunities } from "./support/opportunities";
import { MEMBERSHIPS, seedTenants } from "./support/tenants";

/*
 * Migraciones de db/migrations aplicadas desde cero con `pnpm db:migrate`
 * sobre PostgreSQL 17 (con el mínimo de Supabase de supabase-shim.sql).
 */

const MIGRATIONS_DIR = new URL("../../db/migrations/", import.meta.url);

/*
 * Reversión de 0003_contact_identity_opportunity_create,
 * 0002_opportunities_persistence, 0001_tenant_isolation y
 * 0000_saas_core_schema. drizzle-kit no tiene down migrations: esto no es
 * parte del producto. Prueba que la huella de las migraciones es
 * exactamente la declarada (volver al catálogo previo, incluido el rol
 * app_runtime) y que se pueden recrear limpias. Restaura los default
 * privileges de Supabase del shim.
 */
const REVERT_0003 = `
  REVOKE INSERT ON public.contacts, public.opportunities FROM authenticated;
  DROP POLICY opportunities_insert_member ON public.opportunities;
  DROP POLICY contacts_insert_member ON public.contacts;
  ALTER TABLE public.contacts DROP CONSTRAINT contacts_phone_normalized_check;
  DROP INDEX public.contacts_organization_id_phone_normalized_key;
  ALTER TABLE public.contacts DROP COLUMN phone_normalized;
`;

const REVERT_0002 = `
  DROP POLICY opportunities_select_member ON public.opportunities;
  DROP POLICY contacts_select_member ON public.contacts;
  DROP TABLE public.opportunities;
  DROP TABLE public.contacts;
`;

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

  it("crea solo las tablas de H0 y de H1.1 en public (H1.2 no agrega tablas)", async () => {
    expect(await tableNames(db.admin, "public")).toEqual([
      "contacts",
      "memberships",
      "opportunities",
      "organizations",
      "profiles",
    ]);
  });

  it("registra 0000 a 0003 en el historial de drizzle", async () => {
    expect(await appliedMigrations()).toBe(4);
  });

  it("volver a migrar no cambia nada", async () => {
    await runMigrations(db.migrationUrl);

    expect(await appliedMigrations()).toBe(4);
    expect(await catalogSnapshot(db.admin)).toEqual(afterMigration);
  });

  it("ninguna migración versiona passwords", async () => {
    const files = (await readdir(MIGRATIONS_DIR)).filter((f) =>
      f.endsWith(".sql"),
    );
    expect(files).toEqual([
      "0000_saas_core_schema.sql",
      "0001_tenant_isolation.sql",
      "0002_opportunities_persistence.sql",
      "0003_contact_identity_opportunity_create.sql",
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
        await tx.unsafe(REVERT_0003);
        await tx.unsafe(REVERT_0002);
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

/*
 * Una base en Foundation (0000 y 0001, DEC-022) recibe 0002 y 0003 juntas:
 * solo agregan lo suyo y no tocan los datos existentes.
 */
describe("0002 sobre una base en Foundation", () => {
  async function foundationCount(sql: TestDatabase["admin"]) {
    const [row] = await sql<
      { organizations: number; memberships: number; history: number }[]
    >`
      SELECT
        (SELECT count(*)::int FROM public.organizations) AS organizations,
        (SELECT count(*)::int FROM public.memberships) AS memberships,
        (SELECT count(*)::int FROM drizzle.__drizzle_migrations) AS history
    `;
    return row;
  }

  it("pnpm db:migrate aplica lo pendiente, conserva los datos y deja el mismo catálogo", async () => {
    const foundation = await server.createDatabase();
    await migrateUpTo(foundation.migrationUrl, "0001_tenant_isolation");
    await seedTenants(foundation.admin);
    expect(await tableNames(foundation.admin, "public")).toEqual([
      "memberships",
      "organizations",
      "profiles",
    ]);
    expect(await foundationCount(foundation.admin)).toEqual({
      organizations: 3,
      memberships: MEMBERSHIPS.length,
      history: 2,
    });

    await runMigrations(foundation.migrationUrl);

    expect(await foundationCount(foundation.admin)).toEqual({
      organizations: 3,
      memberships: MEMBERSHIPS.length,
      history: 4,
    });
    expect(await catalogSnapshot(foundation.admin)).toEqual(afterMigration);
  });

  /*
   * Postcondiciones de 0002 (ADR-001 §3.6) sobre toda tabla de public: si
   * la base no cumple las invariantes, 0002 falla y no aplica nada.
   */
  const unsafeStates: [string, string, string][] = [
    [
      "una tabla de public sin RLS",
      "CREATE TABLE public.probe (id int)",
      "DROP TABLE public.probe",
    ],
    [
      "una tabla tenant-scoped sin índice que empiece por organization_id",
      `CREATE TABLE public.probe (organization_id uuid NOT NULL REFERENCES public.organizations(id));
       ALTER TABLE public.probe ENABLE ROW LEVEL SECURITY`,
      "DROP TABLE public.probe",
    ],
    [
      "anon con SELECT sobre una tabla",
      "GRANT SELECT ON public.organizations TO anon",
      "REVOKE SELECT ON public.organizations FROM anon",
    ],
    [
      "app_runtime con privilegios directos (lectura fuera del boundary)",
      "GRANT SELECT ON public.memberships TO app_runtime",
      "REVOKE SELECT ON public.memberships FROM app_runtime",
    ],
    [
      "authenticated con un privilegio sin policy",
      "GRANT INSERT ON public.memberships TO authenticated",
      "REVOKE INSERT ON public.memberships FROM authenticated",
    ],
  ];

  it.each(unsafeStates)(
    "0002 falla cerrada ante %s",
    async (_, unsafe, restore) => {
      const foundation = await server.createDatabase();
      await migrateUpTo(foundation.migrationUrl, "0001_tenant_isolation");
      await foundation.admin.unsafe(unsafe);
      try {
        await expect(runMigrations(foundation.migrationUrl)).rejects.toThrow(
          "pnpm db:migrate failed",
        );
        await expect(
          migrateReportingErrors(foundation.migrationUrl),
        ).rejects.toMatchObject({
          cause: { message: expect.stringMatching(/^ADR-001: /) },
        });
        const tables = await tableNames(foundation.admin, "public");
        expect(tables).not.toContain("contacts");
        expect(tables).not.toContain("opportunities");
        const [history] = await foundation.admin<{ count: number }[]>`
          SELECT count(*)::int AS count FROM drizzle.__drizzle_migrations
        `;
        expect(history?.count).toBe(2);
      } finally {
        await foundation.admin.unsafe(restore);
      }
      // Corregido el estado, 0002 se aplica.
      await runMigrations(foundation.migrationUrl);
      expect(await tableNames(foundation.admin, "public")).toContain(
        "opportunities",
      );
    },
  );
});

/*
 * Staging hoy está en H1.1 (0000 a 0002, DEC-023). 0003 se aplica sobre esa
 * base: solo agrega lo suyo, no toca los datos existentes y no backfillea
 * teléfonos.
 */
describe("0003 sobre una base en H1.1 (staging hoy)", () => {
  async function h11Snapshot(sql: TestDatabase["admin"]) {
    return sql<
      {
        id: string;
        name: string;
        phone: string | null;
        city: string | null;
        opportunities: number;
      }[]
    >`
      SELECT c.id, c.name, c.phone, c.city,
        (SELECT count(*)::int FROM public.opportunities o WHERE o.contact_id = c.id) AS opportunities
      FROM public.contacts c ORDER BY c.id
    `;
  }

  it("pnpm db:migrate aplica solo 0003, conserva los datos y deja el mismo catálogo", async () => {
    const h11 = await server.createDatabase();
    await migrateUpTo(h11.migrationUrl, "0002_opportunities_persistence");
    await seedTenants(h11.admin);
    await seedOpportunities(h11.admin);
    const before = await h11Snapshot(h11.admin);
    expect(before.reduce((sum, c) => sum + c.opportunities, 0)).toBe(
      OPPORTUNITIES.length,
    );

    await runMigrations(h11.migrationUrl);

    const [history] = await h11.admin<{ count: number }[]>`
      SELECT count(*)::int AS count FROM drizzle.__drizzle_migrations
    `;
    expect(history?.count).toBe(4);
    expect(await h11Snapshot(h11.admin)).toEqual(before);
    // Sin backfill: los contactos existentes quedan sin teléfono normalizado.
    const [normalized] = await h11.admin<{ count: number }[]>`
      SELECT count(*)::int AS count FROM public.contacts
      WHERE phone_normalized IS NOT NULL
    `;
    expect(normalized?.count).toBe(0);
    expect(await catalogSnapshot(h11.admin)).toEqual(afterMigration);
  });

  /*
   * Postcondiciones de 0003: las de 0002 sobre toda tabla de public, más
   * ninguna policy de escritura sin WITH CHECK y ningún UPDATE, DELETE ni
   * TRUNCATE de authenticated. Si la base no las cumple, 0003 falla y no
   * aplica nada.
   */
  const unsafeStates: [string, string, string][] = [
    [
      "authenticated con UPDATE sobre contacts (y su policy)",
      `GRANT UPDATE ON public.contacts TO authenticated;
       CREATE POLICY probe_update ON public.contacts FOR UPDATE TO authenticated
         USING (organization_id IN (SELECT private.user_org_ids()))
         WITH CHECK (organization_id IN (SELECT private.user_org_ids()))`,
      `DROP POLICY probe_update ON public.contacts;
       REVOKE UPDATE ON public.contacts FROM authenticated`,
    ],
    [
      "authenticated con DELETE sobre opportunities (y su policy)",
      `GRANT DELETE ON public.opportunities TO authenticated;
       CREATE POLICY probe_delete ON public.opportunities FOR DELETE TO authenticated
         USING (organization_id IN (SELECT private.user_org_ids()))`,
      `DROP POLICY probe_delete ON public.opportunities;
       REVOKE DELETE ON public.opportunities FROM authenticated`,
    ],
    [
      "una policy de escritura sin WITH CHECK",
      `CREATE POLICY probe_insert ON public.memberships FOR INSERT TO authenticated`,
      "DROP POLICY probe_insert ON public.memberships",
    ],
    [
      "app_runtime con INSERT directo",
      "GRANT INSERT ON public.contacts TO app_runtime",
      "REVOKE INSERT ON public.contacts FROM app_runtime",
    ],
    [
      "authenticated con TRUNCATE",
      "GRANT TRUNCATE ON public.opportunities TO authenticated",
      "REVOKE TRUNCATE ON public.opportunities FROM authenticated",
    ],
  ];

  it.each(unsafeStates)(
    "0003 falla cerrada ante %s",
    async (_, unsafe, restore) => {
      const h11 = await server.createDatabase();
      await migrateUpTo(h11.migrationUrl, "0002_opportunities_persistence");
      await h11.admin.unsafe(unsafe);
      try {
        await expect(runMigrations(h11.migrationUrl)).rejects.toThrow(
          "pnpm db:migrate failed",
        );
        await expect(
          migrateReportingErrors(h11.migrationUrl),
        ).rejects.toMatchObject({
          cause: { message: expect.stringMatching(/^ADR-001: /) },
        });
        const [state] = await h11.admin<
          { phoneNormalized: boolean; history: number }[]
        >`
          SELECT
            EXISTS (
              SELECT FROM pg_attribute
              WHERE attrelid = 'public.contacts'::regclass
                AND attname = 'phone_normalized' AND NOT attisdropped
            ) AS "phoneNormalized",
            (SELECT count(*)::int FROM drizzle.__drizzle_migrations) AS history
        `;
        expect(state).toEqual({ phoneNormalized: false, history: 3 });
      } finally {
        await h11.admin.unsafe(restore);
      }
      // Corregido el estado, 0003 se aplica.
      await runMigrations(h11.migrationUrl);
      expect(await catalogSnapshot(h11.admin)).toEqual(afterMigration);
    },
  );
});
