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
import { MEMBERSHIPS, ORG_1, seedTenants } from "./support/tenants";
import { seedVehicles, VEHICLES } from "./support/vehicles";

/*
 * Migraciones de db/migrations aplicadas desde cero con `pnpm db:migrate`
 * sobre PostgreSQL 17 (con el mínimo de Supabase de supabase-shim.sql).
 */

const MIGRATIONS_DIR = new URL("../../db/migrations/", import.meta.url);

/*
 * Reversión de 0010_opportunity_closure_metadata,
 * 0009_opportunity_notes_vehicle_link, 0008_opportunity_stages, 0007_opportunity_demand_facts,
 * 0006_vehicle_availability,
 * 0005_vehicle_quick_create,
 * 0004_vehicles_stock_persistence, 0003_contact_identity_opportunity_create,
 * 0002_opportunities_persistence, 0001_tenant_isolation y
 * 0000_saas_core_schema. drizzle-kit no tiene down
 * migrations: esto no es parte del producto. Prueba que la huella de las
 * migraciones es exactamente la declarada (volver al catálogo previo,
 * incluido el rol app_runtime) y que se pueden recrear limpias. Restaura los
 * default privileges de Supabase del shim.
 */
/*
 * 0010 reemplaza la función del trigger (CREATE OR REPLACE): revertirla
 * restaura la de 0009, tal como la escribe su migración.
 */
async function function0009(): Promise<string> {
  const sql = await readFile(
    new URL("0009_opportunity_notes_vehicle_link.sql", MIGRATIONS_DIR),
    "utf8",
  );
  const start = sql.indexOf('CREATE OR REPLACE FUNCTION "private"');
  return sql.slice(start, sql.indexOf("$$;", sql.indexOf("AS $$")) + 3);
}

const REVERT_0010 = `
  REVOKE UPDATE (loss_notes, sale_price, sale_currency, payment_method, delivery_status, delivery_date) ON public.opportunities FROM authenticated;
  ALTER TABLE public.opportunities DROP CONSTRAINT opportunities_won_closure_check;
  ALTER TABLE public.opportunities DROP CONSTRAINT opportunities_delivery_date_check;
  ALTER TABLE public.opportunities DROP CONSTRAINT opportunities_delivery_status_check;
  ALTER TABLE public.opportunities DROP CONSTRAINT opportunities_payment_method_check;
  ALTER TABLE public.opportunities DROP CONSTRAINT opportunities_sale_price_check;
  ALTER TABLE public.opportunities DROP CONSTRAINT opportunities_sale_currency_check;
  ALTER TABLE public.opportunities DROP CONSTRAINT opportunities_loss_notes_stage_check;
  ALTER TABLE public.opportunities DROP CONSTRAINT opportunities_loss_notes_check;
  ALTER TABLE public.opportunities DROP COLUMN delivery_date;
  ALTER TABLE public.opportunities DROP COLUMN delivery_status;
  ALTER TABLE public.opportunities DROP COLUMN payment_method;
  ALTER TABLE public.opportunities DROP COLUMN sale_currency;
  ALTER TABLE public.opportunities DROP COLUMN sale_price;
  ALTER TABLE public.opportunities DROP COLUMN loss_notes;
  ALTER TABLE public.opportunities DROP CONSTRAINT opportunities_loss_reason_check;
  ALTER TABLE public.opportunities ADD CONSTRAINT opportunities_loss_reason_check CHECK (loss_reason IN ('price', 'vehicle_not_available', 'bought_elsewhere', 'no_response', 'unqualified', 'other'));
`;

const REVERT_0009 = `
  REVOKE UPDATE (vehicle_id) ON public.opportunities FROM authenticated;
  DROP POLICY opportunity_notes_insert_member ON public.opportunity_notes;
  DROP POLICY opportunity_notes_select_member ON public.opportunity_notes;
  DROP TABLE public.opportunity_notes;
  DROP INDEX public.opportunities_organization_id_vehicle_id_idx;
  ALTER TABLE public.opportunities DROP CONSTRAINT opportunities_vehicle_stage_check;
  ALTER TABLE public.opportunities DROP CONSTRAINT opportunities_vehicle_fk;
  ALTER TABLE public.opportunities DROP COLUMN vehicle_id;
  ALTER TABLE public.vehicles DROP CONSTRAINT vehicles_organization_id_id_key;
`;

const REVERT_0008 = `
  REVOKE UPDATE (stage, loss_reason, updated_at) ON public.opportunities FROM authenticated;
  DROP TRIGGER opportunities_stage_transition ON public.opportunities;
  DROP FUNCTION private.enforce_opportunity_stage_transition();
  DROP POLICY opportunities_update_stage ON public.opportunities;
  ALTER TABLE public.opportunities DROP CONSTRAINT opportunities_loss_reason_stage_check;
  ALTER TABLE public.opportunities DROP CONSTRAINT opportunities_loss_reason_check;
  ALTER TABLE public.opportunities DROP COLUMN loss_reason;
  ALTER TABLE public.opportunities DROP CONSTRAINT opportunities_stage_check;
  ALTER TABLE public.opportunities ADD CONSTRAINT opportunities_stage_check CHECK (stage IN ('new', 'qualified', 'test_drive', 'negotiation'));
`;

const REVERT_0007 = `
  DROP POLICY opportunity_demand_facts_insert_member ON public.opportunity_demand_facts;
  DROP POLICY opportunity_demand_facts_select_member ON public.opportunity_demand_facts;
  DROP TABLE public.opportunity_demand_facts;
  ALTER TABLE public.opportunities DROP CONSTRAINT opportunities_organization_id_id_key;
`;

const REVERT_0006 = `
  REVOKE UPDATE (status, updated_at) ON public.vehicles FROM authenticated;
  DROP POLICY vehicles_update_mark_available ON public.vehicles;
`;

const REVERT_0005 = `
  REVOKE INSERT ON public.vehicles FROM authenticated;
  DROP POLICY vehicles_insert_member ON public.vehicles;
`;

const REVERT_0004 = `
  DROP POLICY vehicles_select_member ON public.vehicles;
  DROP TABLE public.vehicles;
`;

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

/*
 * Los snapshots fila a fila de los rollouts (más abajo) comparan
 * opportunities sin `loss_reason`, `vehicle_id` ni los metadatos del cierre:
 * las columnas las agregan 0008 (H1.6), 0009 (Hito 2) y 0010 (DEC-034) y
 * nacen NULL en toda fila existente, que es lo que prueban "0008 sobre una
 * base en H1.4/H1.5", "0009 sobre una base en H1.6" y "0010 sobre una base
 * en el Hito 2".
 */
const LATER_COLUMNS = sqlColumns([
  "loss_reason",
  "vehicle_id",
  "loss_notes",
  "sale_price",
  "sale_currency",
  "payment_method",
  "delivery_status",
  "delivery_date",
]);

/** `- 'a' - 'b'`: quita columnas de un to_jsonb() de opportunities. */
function sqlColumns(names: readonly string[]): string {
  return names.map((name) => ` - '${name}'`).join("");
}
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

  it("crea solo las tablas de H0, H1.1, H1.3A, H1.4 y Hito 2 en public (H1.2 no agrega tablas)", async () => {
    expect(await tableNames(db.admin, "public")).toEqual([
      "contacts",
      "memberships",
      "opportunities",
      "opportunity_demand_facts",
      "opportunity_notes",
      "organizations",
      "profiles",
      "vehicles",
    ]);
  });

  it("registra 0000 a 0010 en el historial de drizzle", async () => {
    expect(await appliedMigrations()).toBe(11);
  });

  it("volver a migrar no cambia nada", async () => {
    await runMigrations(db.migrationUrl);

    expect(await appliedMigrations()).toBe(11);
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
      "0004_vehicles_stock_persistence.sql",
      "0005_vehicle_quick_create.sql",
      "0006_vehicle_availability.sql",
      "0007_opportunity_demand_facts.sql",
      "0008_opportunity_stages.sql",
      "0009_opportunity_notes_vehicle_link.sql",
      "0010_opportunity_closure_metadata.sql",
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
        await tx.unsafe(REVERT_0010);
        await tx.unsafe(REVERT_0009);
        await tx.unsafe(REVERT_0008);
        await tx.unsafe(REVERT_0007);
        await tx.unsafe(REVERT_0006);
        await tx.unsafe(REVERT_0005);
        await tx.unsafe(REVERT_0004);
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
 * Una base en Foundation (0000 y 0001, DEC-022) recibe 0002 a 0005 juntas:
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
      history: 11,
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
 * Una base en H1.1 (0000 a 0002, DEC-023) recibe 0003 (y 0004 a 0007): solo
 * agregan lo suyo, no tocan los datos existentes y no backfillean teléfonos.
 */
describe("0003 sobre una base en H1.1", () => {
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

  it("pnpm db:migrate aplica 0003 a 0010, conserva los datos y deja el mismo catálogo", async () => {
    const h11 = await server.createDatabase();
    await migrateUpTo(h11.migrationUrl, "0002_opportunities_persistence");
    await seedTenants(h11.admin);
    // Antes de H1.6 solo había oportunidades en `new` (CHECK de 0002 a 0007).
    await seedOpportunities(h11.admin, { initialOnly: true });
    const before = await h11Snapshot(h11.admin);
    expect(before.reduce((sum, c) => sum + c.opportunities, 0)).toBe(
      OPPORTUNITIES.length,
    );

    await runMigrations(h11.migrationUrl);

    const [history] = await h11.admin<{ count: number }[]>`
      SELECT count(*)::int AS count FROM drizzle.__drizzle_migrations
    `;
    expect(history?.count).toBe(11);
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

/*
 * Una base en H1.2 (0000 a 0003, DEC-024) recibe 0004 (y 0005 a 0007): solo agrega
 * vehicles y su alta, no toca nada de lo que existe y deja el mismo catálogo
 * que una base nueva.
 */
describe("0004 sobre una base en H1.2", () => {
  /** Todo lo que puede tener staging hoy, fila por fila. */
  async function h12Snapshot(sql: TestDatabase["admin"]) {
    const [snapshot] = await sql<{ data: unknown }[]>`
      SELECT jsonb_build_object(
        'organizations', (SELECT jsonb_agg(o ORDER BY o.id) FROM public.organizations o),
        'profiles', (SELECT jsonb_agg(p ORDER BY p.id) FROM public.profiles p),
        'memberships', (SELECT jsonb_agg(m ORDER BY m.id) FROM public.memberships m),
        'contacts', (SELECT jsonb_agg(c ORDER BY c.id) FROM public.contacts c),
        'opportunities', (SELECT jsonb_agg(to_jsonb(op)${sql.unsafe(LATER_COLUMNS)} ORDER BY op.id) FROM public.opportunities op)
      ) AS data
    `;
    return snapshot?.data;
  }

  async function history(sql: TestDatabase["admin"]): Promise<number> {
    const [row] = await sql<{ count: number }[]>`
      SELECT count(*)::int AS count FROM drizzle.__drizzle_migrations
    `;
    return row?.count ?? 0;
  }

  it("pnpm db:migrate aplica 0004 a 0010, conserva los datos y deja el mismo catálogo", async () => {
    const h12 = await server.createDatabase();
    await migrateUpTo(
      h12.migrationUrl,
      "0003_contact_identity_opportunity_create",
    );
    await seedTenants(h12.admin);
    await seedOpportunities(h12.admin, { initialOnly: true });
    // Un contacto con identidad telefónica (H1.2), como deja el alta real.
    await h12.admin`
      UPDATE public.contacts SET phone_normalized = '+595981555214'
      WHERE phone = '0981 555 214'
    `;
    const before = await h12Snapshot(h12.admin);
    expect(await history(h12.admin)).toBe(4);
    expect(await tableNames(h12.admin, "public")).not.toContain("vehicles");

    await runMigrations(h12.migrationUrl);

    expect(await history(h12.admin)).toBe(11);
    expect(await h12Snapshot(h12.admin)).toEqual(before);
    // Sin seeds: vehicles nace vacía.
    const [vehicles] = await h12.admin<{ count: number }[]>`
      SELECT count(*)::int AS count FROM public.vehicles
    `;
    expect(vehicles?.count).toBe(0);
    expect(await catalogSnapshot(h12.admin)).toEqual(afterMigration);

    // Y después de 0004, la tabla nueva acepta las filas del harness.
    await seedVehicles(h12.admin);
    const [seeded] = await h12.admin<{ count: number }[]>`
      SELECT count(*)::int AS count FROM public.vehicles
    `;
    expect(seeded?.count).toBe(VEHICLES.length);
  });

  /*
   * Postcondiciones de 0004: las de 0003 sobre toda tabla de public, más que
   * authenticated solo da de alta en contacts y opportunities (en H1.3A,
   * vehicles es de solo lectura). Si la base no las cumple, 0004 falla y no
   * aplica nada (tampoco 0005 ni 0006, que van en la misma transacción).
   */
  const unsafeStates: [string, string, string, RegExp][] = [
    [
      "una tabla de public sin RLS",
      "CREATE TABLE public.probe (id int)",
      "DROP TABLE public.probe",
      /RLS enabled/,
    ],
    [
      "app_runtime con SELECT directo (lectura fuera del boundary)",
      "GRANT SELECT ON public.opportunities TO app_runtime",
      "REVOKE SELECT ON public.opportunities FROM app_runtime",
      /anon and app_runtime must not have privileges/,
    ],
    [
      "authenticated con UPDATE sobre opportunities (y su policy)",
      `GRANT UPDATE ON public.opportunities TO authenticated;
       CREATE POLICY probe_update ON public.opportunities FOR UPDATE TO authenticated
         USING (organization_id IN (SELECT private.user_org_ids()))
         WITH CHECK (organization_id IN (SELECT private.user_org_ids()))`,
      `DROP POLICY probe_update ON public.opportunities;
       REVOKE UPDATE ON public.opportunities FROM authenticated`,
      /must not update, delete or truncate/,
    ],
    [
      "authenticated con INSERT fuera de contacts y opportunities (aun con policy y WITH CHECK)",
      `GRANT INSERT ON public.memberships TO authenticated;
       CREATE POLICY probe_insert ON public.memberships FOR INSERT TO authenticated
         WITH CHECK (organization_id IN (SELECT private.user_org_ids()))`,
      `DROP POLICY probe_insert ON public.memberships;
       REVOKE INSERT ON public.memberships FROM authenticated`,
      /may only insert into contacts and opportunities/,
    ],
  ];

  it.each(unsafeStates)(
    "0004 falla cerrada ante %s",
    async (_, unsafe, restore, reason) => {
      const h12 = await server.createDatabase();
      await migrateUpTo(
        h12.migrationUrl,
        "0003_contact_identity_opportunity_create",
      );
      await h12.admin.unsafe(unsafe);
      try {
        await expect(runMigrations(h12.migrationUrl)).rejects.toThrow(
          "pnpm db:migrate failed",
        );
        await expect(
          migrateReportingErrors(h12.migrationUrl),
        ).rejects.toMatchObject({
          cause: { message: expect.stringMatching(/^ADR-001: /) },
        });
        await expect(
          migrateReportingErrors(h12.migrationUrl),
        ).rejects.toMatchObject({
          cause: { message: expect.stringMatching(reason) },
        });
        expect(await tableNames(h12.admin, "public")).not.toContain("vehicles");
        expect(await history(h12.admin)).toBe(4);
      } finally {
        await h12.admin.unsafe(restore);
      }
      // Corregido el estado, 0004 se aplica.
      await runMigrations(h12.migrationUrl);
      expect(await catalogSnapshot(h12.admin)).toEqual(afterMigration);
    },
  );
});

/*
 * Una base en H1.3A (0000 a 0004, DEC-025) recibe 0005 (y 0006 y 0007), con datos
 * (también vehículos): solo agregan las policies y los grants de alta y de
 * disponibilidad de vehicles, no tocan ninguna fila y dejan el mismo
 * catálogo que una base nueva.
 */
describe("0005 sobre una base en H1.3A", () => {
  /** Todo lo que puede tener una base en H1.3A, fila por fila. */
  async function h13aSnapshot(sql: TestDatabase["admin"]) {
    const [snapshot] = await sql<{ data: unknown }[]>`
      SELECT jsonb_build_object(
        'organizations', (SELECT jsonb_agg(o ORDER BY o.id) FROM public.organizations o),
        'profiles', (SELECT jsonb_agg(p ORDER BY p.id) FROM public.profiles p),
        'memberships', (SELECT jsonb_agg(m ORDER BY m.id) FROM public.memberships m),
        'contacts', (SELECT jsonb_agg(c ORDER BY c.id) FROM public.contacts c),
        'opportunities', (SELECT jsonb_agg(to_jsonb(op)${sql.unsafe(LATER_COLUMNS)} ORDER BY op.id) FROM public.opportunities op),
        'vehicles', (SELECT jsonb_agg(v ORDER BY v.id) FROM public.vehicles v)
      ) AS data
    `;
    return snapshot?.data;
  }

  async function history(sql: TestDatabase["admin"]): Promise<number> {
    const [row] = await sql<{ count: number }[]>`
      SELECT count(*)::int AS count FROM drizzle.__drizzle_migrations
    `;
    return row?.count ?? 0;
  }

  async function vehiclePolicies(sql: TestDatabase["admin"]) {
    const rows = await sql<{ name: string }[]>`
      SELECT policyname AS name FROM pg_policies
      WHERE schemaname = 'public' AND tablename = 'vehicles'
      ORDER BY 1
    `;
    return rows.map((row) => row.name);
  }

  it("pnpm db:migrate aplica 0005 a 0010, conserva los datos y deja el mismo catálogo", async () => {
    const h13a = await server.createDatabase();
    await migrateUpTo(h13a.migrationUrl, "0004_vehicles_stock_persistence");
    await seedTenants(h13a.admin);
    await seedOpportunities(h13a.admin, { initialOnly: true });
    await seedVehicles(h13a.admin);
    const before = await h13aSnapshot(h13a.admin);
    expect(await history(h13a.admin)).toBe(5);
    expect(await vehiclePolicies(h13a.admin)).toEqual([
      "vehicles_select_member",
    ]);

    await runMigrations(h13a.migrationUrl);

    expect(await history(h13a.admin)).toBe(11);
    // Ninguna fila cambia: ni estados, ni precios, ni timestamps.
    expect(await h13aSnapshot(h13a.admin)).toEqual(before);
    expect(await vehiclePolicies(h13a.admin)).toEqual([
      "vehicles_insert_member",
      "vehicles_select_member",
      "vehicles_update_mark_available",
    ]);
    expect(await catalogSnapshot(h13a.admin)).toEqual(afterMigration);
  });

  /*
   * Postcondiciones de 0005: las de 0004 sobre toda tabla de public, con
   * vehicles entre las altas aprobadas. Si la base no las cumple, 0005 falla
   * y no aplica nada (tampoco 0006, que va en la misma transacción).
   */
  const unsafeStates: [string, string, string, RegExp][] = [
    [
      "una tabla de public sin RLS",
      "CREATE TABLE public.probe (id int)",
      "DROP TABLE public.probe",
      /RLS enabled/,
    ],
    [
      "app_runtime con INSERT directo sobre vehicles",
      "GRANT INSERT ON public.vehicles TO app_runtime",
      "REVOKE INSERT ON public.vehicles FROM app_runtime",
      /anon and app_runtime must not have privileges/,
    ],
    [
      "una policy de alta de vehicles sin WITH CHECK",
      "CREATE POLICY probe_insert ON public.vehicles FOR INSERT TO authenticated",
      "DROP POLICY probe_insert ON public.vehicles",
      /must have a WITH CHECK/,
    ],
    [
      "authenticated con UPDATE sobre vehicles (y su policy)",
      `GRANT UPDATE ON public.vehicles TO authenticated;
       CREATE POLICY probe_update ON public.vehicles FOR UPDATE TO authenticated
         USING (organization_id IN (SELECT private.user_org_ids()))
         WITH CHECK (organization_id IN (SELECT private.user_org_ids()))`,
      `DROP POLICY probe_update ON public.vehicles;
       REVOKE UPDATE ON public.vehicles FROM authenticated`,
      /must not update, delete or truncate/,
    ],
    [
      "authenticated con DELETE sobre vehicles (y su policy)",
      `GRANT DELETE ON public.vehicles TO authenticated;
       CREATE POLICY probe_delete ON public.vehicles FOR DELETE TO authenticated
         USING (organization_id IN (SELECT private.user_org_ids()))`,
      `DROP POLICY probe_delete ON public.vehicles;
       REVOKE DELETE ON public.vehicles FROM authenticated`,
      /must not update, delete or truncate/,
    ],
    [
      "authenticated con INSERT fuera de contacts, opportunities y vehicles (aun con policy y WITH CHECK)",
      `GRANT INSERT ON public.memberships TO authenticated;
       CREATE POLICY probe_insert ON public.memberships FOR INSERT TO authenticated
         WITH CHECK (organization_id IN (SELECT private.user_org_ids()))`,
      `DROP POLICY probe_insert ON public.memberships;
       REVOKE INSERT ON public.memberships FROM authenticated`,
      /may only insert into contacts, opportunities and vehicles/,
    ],
  ];

  it.each(unsafeStates)(
    "0005 falla cerrada ante %s",
    async (_, unsafe, restore, reason) => {
      const h13a = await server.createDatabase();
      await migrateUpTo(h13a.migrationUrl, "0004_vehicles_stock_persistence");
      await h13a.admin.unsafe(unsafe);
      try {
        await expect(runMigrations(h13a.migrationUrl)).rejects.toThrow(
          "pnpm db:migrate failed",
        );
        await expect(
          migrateReportingErrors(h13a.migrationUrl),
        ).rejects.toMatchObject({
          cause: { message: expect.stringMatching(/^ADR-001: /) },
        });
        await expect(
          migrateReportingErrors(h13a.migrationUrl),
        ).rejects.toMatchObject({
          cause: { message: expect.stringMatching(reason) },
        });
        expect(await vehiclePolicies(h13a.admin)).not.toContain(
          "vehicles_insert_member",
        );
        expect(await history(h13a.admin)).toBe(5);
      } finally {
        await h13a.admin.unsafe(restore);
      }
      // Corregido el estado, 0005 se aplica.
      await runMigrations(h13a.migrationUrl);
      expect(await catalogSnapshot(h13a.admin)).toEqual(afterMigration);
    },
  );
});

/*
 * Una base en H1.3B (0000 a 0005, DEC-027) recibe 0006 (y 0007), con datos
 * (vehículos en los cuatro estados): 0006 solo agrega
 * la policy de disponibilidad y el UPDATE por columna (status, updated_at)
 * de vehicles, no toca ninguna fila (ninguna unidad cambia de estado) y deja
 * el mismo catálogo que una base nueva.
 */
describe("0006 sobre una base en H1.3B", () => {
  /** Todo lo que puede tener staging hoy, fila por fila. */
  async function h13bSnapshot(sql: TestDatabase["admin"]) {
    const [snapshot] = await sql<{ data: unknown }[]>`
      SELECT jsonb_build_object(
        'organizations', (SELECT jsonb_agg(o ORDER BY o.id) FROM public.organizations o),
        'profiles', (SELECT jsonb_agg(p ORDER BY p.id) FROM public.profiles p),
        'memberships', (SELECT jsonb_agg(m ORDER BY m.id) FROM public.memberships m),
        'contacts', (SELECT jsonb_agg(c ORDER BY c.id) FROM public.contacts c),
        'opportunities', (SELECT jsonb_agg(to_jsonb(op)${sql.unsafe(LATER_COLUMNS)} ORDER BY op.id) FROM public.opportunities op),
        'vehicles', (SELECT jsonb_agg(v ORDER BY v.id) FROM public.vehicles v)
      ) AS data
    `;
    return snapshot?.data;
  }

  async function history(sql: TestDatabase["admin"]): Promise<number> {
    const [row] = await sql<{ count: number }[]>`
      SELECT count(*)::int AS count FROM drizzle.__drizzle_migrations
    `;
    return row?.count ?? 0;
  }

  async function vehiclePolicies(sql: TestDatabase["admin"]) {
    const rows = await sql<{ name: string }[]>`
      SELECT policyname AS name FROM pg_policies
      WHERE schemaname = 'public' AND tablename = 'vehicles'
      ORDER BY 1
    `;
    return rows.map((row) => row.name);
  }

  /** Columnas de vehicles que authenticated puede actualizar. */
  async function updatableColumns(sql: TestDatabase["admin"]) {
    const rows = await sql<{ name: string }[]>`
      SELECT attname AS name FROM pg_attribute
      WHERE attrelid = 'public.vehicles'::regclass AND attnum > 0
        AND NOT attisdropped
        AND has_column_privilege('authenticated', attrelid, attnum, 'UPDATE')
      ORDER BY attnum
    `;
    return rows.map((row) => row.name);
  }

  it("pnpm db:migrate aplica 0006 a 0010, conserva los datos y deja el mismo catálogo", async () => {
    const h13b = await server.createDatabase();
    await migrateUpTo(h13b.migrationUrl, "0005_vehicle_quick_create");
    await seedTenants(h13b.admin);
    await seedOpportunities(h13b.admin, { initialOnly: true });
    await seedVehicles(h13b.admin);
    const before = await h13bSnapshot(h13b.admin);
    expect(await history(h13b.admin)).toBe(6);
    expect(await vehiclePolicies(h13b.admin)).toEqual([
      "vehicles_insert_member",
      "vehicles_select_member",
    ]);
    expect(await updatableColumns(h13b.admin)).toEqual([]);

    await runMigrations(h13b.migrationUrl);

    expect(await history(h13b.admin)).toBe(11);
    // Ninguna fila cambia: ni estados, ni precios, ni timestamps.
    expect(await h13bSnapshot(h13b.admin)).toEqual(before);
    expect(await vehiclePolicies(h13b.admin)).toEqual([
      "vehicles_insert_member",
      "vehicles_select_member",
      "vehicles_update_mark_available",
    ]);
    expect(await updatableColumns(h13b.admin)).toEqual([
      "status",
      "updated_at",
    ]);
    expect(await catalogSnapshot(h13b.admin)).toEqual(afterMigration);
  });

  /*
   * Postcondiciones de 0006: las de 0005 sobre toda tabla de public, con la
   * cobertura por policy extendida a los privilegios por columna, toda
   * policy de UPDATE con USING y, como única edición, vehicles.status y
   * vehicles.updated_at. Si la base no las cumple, 0006 falla y no aplica
   * nada.
   */
  const unsafeStates: [string, string, string, RegExp][] = [
    [
      "una tabla de public sin RLS",
      "CREATE TABLE public.probe (id int)",
      "DROP TABLE public.probe",
      /RLS enabled/,
    ],
    [
      "app_runtime con UPDATE directo sobre vehicles.status",
      "GRANT UPDATE (status) ON public.vehicles TO app_runtime",
      "REVOKE UPDATE (status) ON public.vehicles FROM app_runtime",
      /anon and app_runtime must not have privileges/,
    ],
    [
      "anon con UPDATE sobre vehicles.status",
      "GRANT UPDATE (status) ON public.vehicles TO anon",
      "REVOKE UPDATE (status) ON public.vehicles FROM anon",
      /anon and app_runtime must not have privileges/,
    ],
    [
      "authenticated con UPDATE por columna sin policy (contacts.name)",
      "GRANT UPDATE (name) ON public.contacts TO authenticated",
      "REVOKE UPDATE (name) ON public.contacts FROM authenticated",
      /must be covered by a policy/,
    ],
    [
      "authenticated con UPDATE de toda la tabla vehicles",
      "GRANT UPDATE ON public.vehicles TO authenticated",
      "REVOKE UPDATE ON public.vehicles FROM authenticated",
      /may only update vehicles\.status and vehicles\.updated_at/,
    ],
    [
      "authenticated con UPDATE sobre vehicles.price",
      "GRANT UPDATE (price) ON public.vehicles TO authenticated",
      "REVOKE UPDATE (price) ON public.vehicles FROM authenticated",
      /may only update vehicles\.status and vehicles\.updated_at/,
    ],
    [
      "authenticated con UPDATE sobre otra tabla (y su policy)",
      `GRANT UPDATE (name) ON public.contacts TO authenticated;
       CREATE POLICY probe_update ON public.contacts FOR UPDATE TO authenticated
         USING (organization_id IN (SELECT private.user_org_ids()))
         WITH CHECK (organization_id IN (SELECT private.user_org_ids()))`,
      `DROP POLICY probe_update ON public.contacts;
       REVOKE UPDATE (name) ON public.contacts FROM authenticated`,
      /may only update vehicles\.status and vehicles\.updated_at/,
    ],
    [
      "una policy de UPDATE de vehicles sin USING",
      `CREATE POLICY probe_update ON public.vehicles FOR UPDATE TO authenticated
         WITH CHECK (organization_id IN (SELECT private.user_org_ids()))`,
      "DROP POLICY probe_update ON public.vehicles",
      /must have a USING/,
    ],
    [
      "authenticated con DELETE sobre vehicles (y su policy)",
      `GRANT DELETE ON public.vehicles TO authenticated;
       CREATE POLICY probe_delete ON public.vehicles FOR DELETE TO authenticated
         USING (organization_id IN (SELECT private.user_org_ids()))`,
      `DROP POLICY probe_delete ON public.vehicles;
       REVOKE DELETE ON public.vehicles FROM authenticated`,
      /must not delete or truncate/,
    ],
    [
      "authenticated con INSERT fuera de contacts, opportunities y vehicles (aun con policy y WITH CHECK)",
      `GRANT INSERT ON public.memberships TO authenticated;
       CREATE POLICY probe_insert ON public.memberships FOR INSERT TO authenticated
         WITH CHECK (organization_id IN (SELECT private.user_org_ids()))`,
      `DROP POLICY probe_insert ON public.memberships;
       REVOKE INSERT ON public.memberships FROM authenticated`,
      /may only insert into contacts, opportunities and vehicles/,
    ],
  ];

  it.each(unsafeStates)(
    "0006 falla cerrada ante %s",
    async (_, unsafe, restore, reason) => {
      const h13b = await server.createDatabase();
      await migrateUpTo(h13b.migrationUrl, "0005_vehicle_quick_create");
      await h13b.admin.unsafe(unsafe);
      try {
        await expect(runMigrations(h13b.migrationUrl)).rejects.toThrow(
          "pnpm db:migrate failed",
        );
        await expect(
          migrateReportingErrors(h13b.migrationUrl),
        ).rejects.toMatchObject({
          cause: { message: expect.stringMatching(/^ADR-001: /) },
        });
        await expect(
          migrateReportingErrors(h13b.migrationUrl),
        ).rejects.toMatchObject({
          cause: { message: expect.stringMatching(reason) },
        });
        expect(await vehiclePolicies(h13b.admin)).not.toContain(
          "vehicles_update_mark_available",
        );
        expect(await history(h13b.admin)).toBe(6);
      } finally {
        await h13b.admin.unsafe(restore);
      }
      // Corregido el estado, 0006 se aplica.
      await runMigrations(h13b.migrationUrl);
      expect(await catalogSnapshot(h13b.admin)).toEqual(afterMigration);
    },
  );
});

/*
 * Staging hoy está en H1.3C (0000 a 0006, DEC-028). 0007 se aplica sobre una
 * base equivalente, con datos (oportunidades con interés legado y vehículos):
 * solo agrega la unique (organization_id, id) de opportunities y el ledger de
 * demanda vacío, sin backfill del legado ni cambios en ninguna fila, y deja
 * el mismo catálogo que una base nueva.
 */
describe("0007 sobre una base en H1.3C (staging hoy)", () => {
  /** Todo lo que puede tener staging hoy, fila por fila. */
  async function h13cSnapshot(sql: TestDatabase["admin"]) {
    const [snapshot] = await sql<{ data: unknown }[]>`
      SELECT jsonb_build_object(
        'organizations', (SELECT jsonb_agg(o ORDER BY o.id) FROM public.organizations o),
        'profiles', (SELECT jsonb_agg(p ORDER BY p.id) FROM public.profiles p),
        'memberships', (SELECT jsonb_agg(m ORDER BY m.id) FROM public.memberships m),
        'contacts', (SELECT jsonb_agg(c ORDER BY c.id) FROM public.contacts c),
        'opportunities', (SELECT jsonb_agg(to_jsonb(op)${sql.unsafe(LATER_COLUMNS)} ORDER BY op.id) FROM public.opportunities op),
        'vehicles', (SELECT jsonb_agg(v ORDER BY v.id) FROM public.vehicles v)
      ) AS data
    `;
    return snapshot?.data;
  }

  async function history(sql: TestDatabase["admin"]): Promise<number> {
    const [row] = await sql<{ count: number }[]>`
      SELECT count(*)::int AS count FROM drizzle.__drizzle_migrations
    `;
    return row?.count ?? 0;
  }

  it("pnpm db:migrate aplica 0007 a 0010, conserva los datos (sin backfill del legado) y deja el mismo catálogo", async () => {
    const h13c = await server.createDatabase();
    await migrateUpTo(h13c.migrationUrl, "0006_vehicle_availability");
    await seedTenants(h13c.admin);
    await seedOpportunities(h13c.admin, { initialOnly: true });
    await seedVehicles(h13c.admin);
    const before = await h13cSnapshot(h13c.admin);
    expect(await history(h13c.admin)).toBe(7);
    expect(await tableNames(h13c.admin, "public")).not.toContain(
      "opportunity_demand_facts",
    );

    await runMigrations(h13c.migrationUrl);

    expect(await history(h13c.admin)).toBe(11);
    // Ninguna fila cambia: interest_model e interest_version quedan como
    // legado de solo lectura.
    expect(await h13cSnapshot(h13c.admin)).toEqual(before);
    const [facts] = await h13c.admin<{ count: number }[]>`
      SELECT count(*)::int AS count FROM public.opportunity_demand_facts
    `;
    expect(facts?.count).toBe(0);
    expect(await catalogSnapshot(h13c.admin)).toEqual(afterMigration);
  });

  /*
   * Postcondiciones de 0007: las de 0006 sobre toda tabla de public, con
   * opportunity_demand_facts entre las altas aprobadas, y las del ledger
   * append-only. Si la base no las cumple, 0007 falla y no aplica nada.
   */
  const unsafeStates: [string, string, string, RegExp][] = [
    [
      "una tabla de public sin RLS",
      "CREATE TABLE public.probe (id int)",
      "DROP TABLE public.probe",
      /RLS enabled/,
    ],
    [
      "default privileges que darían a app_runtime lectura de la tabla nueva",
      "ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT SELECT ON TABLES TO app_runtime",
      "ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE SELECT ON TABLES FROM app_runtime",
      /anon and app_runtime must not have privileges/,
    ],
    [
      "authenticated con UPDATE sobre otra tabla (y su policy)",
      `GRANT UPDATE (name) ON public.contacts TO authenticated;
       CREATE POLICY probe_update ON public.contacts FOR UPDATE TO authenticated
         USING (organization_id IN (SELECT private.user_org_ids()))
         WITH CHECK (organization_id IN (SELECT private.user_org_ids()))`,
      `DROP POLICY probe_update ON public.contacts;
       REVOKE UPDATE (name) ON public.contacts FROM authenticated`,
      /may only update vehicles\.status and vehicles\.updated_at/,
    ],
    [
      "authenticated con DELETE sobre opportunities (y su policy)",
      `GRANT DELETE ON public.opportunities TO authenticated;
       CREATE POLICY probe_delete ON public.opportunities FOR DELETE TO authenticated
         USING (organization_id IN (SELECT private.user_org_ids()))`,
      `DROP POLICY probe_delete ON public.opportunities;
       REVOKE DELETE ON public.opportunities FROM authenticated`,
      /must not delete or truncate/,
    ],
    [
      "authenticated con INSERT fuera de las altas aprobadas (aun con policy y WITH CHECK)",
      `GRANT INSERT ON public.memberships TO authenticated;
       CREATE POLICY probe_insert ON public.memberships FOR INSERT TO authenticated
         WITH CHECK (organization_id IN (SELECT private.user_org_ids()))`,
      `DROP POLICY probe_insert ON public.memberships;
       REVOKE INSERT ON public.memberships FROM authenticated`,
      /may only insert into contacts, opportunities, vehicles and opportunity_demand_facts/,
    ],
  ];

  it.each(unsafeStates)(
    "0007 falla cerrada ante %s",
    async (_, unsafe, restore, reason) => {
      const h13c = await server.createDatabase();
      await migrateUpTo(h13c.migrationUrl, "0006_vehicle_availability");
      await h13c.admin.unsafe(unsafe);
      try {
        await expect(runMigrations(h13c.migrationUrl)).rejects.toThrow(
          "pnpm db:migrate failed",
        );
        await expect(
          migrateReportingErrors(h13c.migrationUrl),
        ).rejects.toMatchObject({
          cause: { message: expect.stringMatching(/^ADR-001: /) },
        });
        await expect(
          migrateReportingErrors(h13c.migrationUrl),
        ).rejects.toMatchObject({
          cause: { message: expect.stringMatching(reason) },
        });
        expect(await tableNames(h13c.admin, "public")).not.toContain(
          "opportunity_demand_facts",
        );
        expect(await history(h13c.admin)).toBe(7);
      } finally {
        await h13c.admin.unsafe(restore);
      }
      // Corregido el estado, 0007 se aplica.
      await runMigrations(h13c.migrationUrl);
      expect(await catalogSnapshot(h13c.admin)).toEqual(afterMigration);
    },
  );
});

/*
 * Una base en H1.4/H1.5 (0000 a 0007) recibe 0008 (H1.6,
 * DEC-032): reemplaza las etapas de B1 por las comerciales, agrega
 * loss_reason, la policy de UPDATE, el trigger de transiciones y el UPDATE
 * por columna de opportunities. No toca ninguna fila.
 */
describe("0008 sobre una base en H1.4/H1.5", () => {
  /** Todo lo que puede tener staging, fila por fila (sin la columna nueva). */
  async function h14Snapshot(sql: TestDatabase["admin"]) {
    const [snapshot] = await sql<{ data: unknown }[]>`
      SELECT jsonb_build_object(
        'organizations', (SELECT jsonb_agg(o ORDER BY o.id) FROM public.organizations o),
        'profiles', (SELECT jsonb_agg(p ORDER BY p.id) FROM public.profiles p),
        'memberships', (SELECT jsonb_agg(m ORDER BY m.id) FROM public.memberships m),
        'contacts', (SELECT jsonb_agg(c ORDER BY c.id) FROM public.contacts c),
        'opportunities', (SELECT jsonb_agg(to_jsonb(op)${sql.unsafe(LATER_COLUMNS)} ORDER BY op.id) FROM public.opportunities op),
        'vehicles', (SELECT jsonb_agg(v ORDER BY v.id) FROM public.vehicles v),
        'demand_facts', (SELECT jsonb_agg(f ORDER BY f.id) FROM public.opportunity_demand_facts f)
      ) AS data
    `;
    return snapshot?.data;
  }

  async function history(sql: TestDatabase["admin"]): Promise<number> {
    const [row] = await sql<{ count: number }[]>`
      SELECT count(*)::int AS count FROM drizzle.__drizzle_migrations
    `;
    return row?.count ?? 0;
  }

  /** Columnas de opportunities que authenticated puede actualizar. */
  async function updatableColumns(sql: TestDatabase["admin"]) {
    const rows = await sql<{ name: string }[]>`
      SELECT attname AS name FROM pg_attribute
      WHERE attrelid = 'public.opportunities'::regclass AND attnum > 0
        AND NOT attisdropped
        AND has_column_privilege('authenticated', attrelid, attnum, 'UPDATE')
      ORDER BY attnum
    `;
    return rows.map((row) => row.name);
  }

  async function stageCheck(sql: TestDatabase["admin"]): Promise<string> {
    const [row] = await sql<{ definition: string }[]>`
      SELECT pg_get_constraintdef(oid) AS definition FROM pg_constraint
      WHERE conname = 'opportunities_stage_check'
    `;
    return row?.definition ?? "";
  }

  it("pnpm db:migrate aplica 0008 a 0010, conserva los datos y deja el mismo catálogo", async () => {
    const h14 = await server.createDatabase();
    await migrateUpTo(h14.migrationUrl, "0007_opportunity_demand_facts");
    await seedTenants(h14.admin);
    await seedOpportunities(h14.admin, { initialOnly: true });
    await seedVehicles(h14.admin);
    const before = await h14Snapshot(h14.admin);
    expect(await history(h14.admin)).toBe(8);
    expect(await updatableColumns(h14.admin)).toEqual([]);
    expect(await stageCheck(h14.admin)).toContain("'qualified'::text");

    await runMigrations(h14.migrationUrl);

    expect(await history(h14.admin)).toBe(11);
    // Ninguna fila cambia: ni etapas, ni timestamps, ni recencia.
    expect(await h14Snapshot(h14.admin)).toEqual(before);
    const [reasons] = await h14.admin<{ count: number }[]>`
      SELECT count(*)::int AS count FROM public.opportunities
      WHERE loss_reason IS NOT NULL
    `;
    expect(reasons?.count).toBe(0);
    expect(await stageCheck(h14.admin)).toContain("'negotiating'::text");
    expect(await updatableColumns(h14.admin)).toEqual([
      "stage",
      "updated_at",
      "loss_reason",
      "vehicle_id",
      "loss_notes",
      "sale_price",
      "sale_currency",
      "payment_method",
      "delivery_status",
      "delivery_date",
    ]);
    expect(await catalogSnapshot(h14.admin)).toEqual(afterMigration);
  });

  it("una oportunidad en una etapa de B1 (qualified) detiene 0008 en vez de reinterpretarla, y no aplica nada", async () => {
    const h14 = await server.createDatabase();
    await migrateUpTo(h14.migrationUrl, "0007_opportunity_demand_facts");
    await seedTenants(h14.admin);
    await seedOpportunities(h14.admin, { initialOnly: true });
    // Imposible por la aplicación (el alta nace en `new` y no había UPDATE);
    // solo un superusuario lo escribe.
    await h14.admin`
      UPDATE public.opportunities SET stage = 'qualified' WHERE id = ${OPPORTUNITIES[0]!.id}
    `;
    const before = await h14Snapshot(h14.admin);

    await expect(runMigrations(h14.migrationUrl)).rejects.toThrow(
      "pnpm db:migrate failed",
    );
    await expect(
      migrateReportingErrors(h14.migrationUrl),
    ).rejects.toMatchObject({
      cause: {
        message: expect.stringMatching(
          /^DEC-032: opportunities in a stage other than new cannot be migrated automatically/,
        ),
      },
    });
    expect(await history(h14.admin)).toBe(8);
    expect(await stageCheck(h14.admin)).toContain("'qualified'::text");
    expect(await h14Snapshot(h14.admin)).toEqual(before);

    // Quien lo decide la corrige a mano y 0008 se aplica.
    await h14.admin`
      UPDATE public.opportunities SET stage = 'new' WHERE id = ${OPPORTUNITIES[0]!.id}
    `;
    await runMigrations(h14.migrationUrl);
    expect(await history(h14.admin)).toBe(11);
    expect(await catalogSnapshot(h14.admin)).toEqual(afterMigration);
  });

  /*
   * Postcondiciones de 0008: las de 0007 sobre toda tabla de public, con la
   * edición de opportunities (stage, loss_reason y updated_at) entre las
   * aprobadas. Si la base no las cumple, 0008 falla y no aplica nada.
   */
  const UPDATE_COLUMNS_MESSAGE =
    /may only update vehicles\.status, vehicles\.updated_at \(H1\.3C\) and opportunities\.stage, opportunities\.loss_reason, opportunities\.updated_at \(H1\.6\)/;
  const unsafeStates: [string, string, string, RegExp][] = [
    [
      "una tabla de public sin RLS",
      "CREATE TABLE public.probe (id int)",
      "DROP TABLE public.probe",
      /RLS enabled/,
    ],
    [
      "app_runtime con UPDATE directo sobre opportunities.stage",
      "GRANT UPDATE (stage) ON public.opportunities TO app_runtime",
      "REVOKE UPDATE (stage) ON public.opportunities FROM app_runtime",
      /anon and app_runtime must not have privileges/,
    ],
    [
      "authenticated con UPDATE de toda la tabla opportunities",
      "GRANT UPDATE ON public.opportunities TO authenticated",
      "REVOKE UPDATE ON public.opportunities FROM authenticated",
      UPDATE_COLUMNS_MESSAGE,
    ],
    [
      "authenticated con UPDATE sobre opportunities.source",
      "GRANT UPDATE (source) ON public.opportunities TO authenticated",
      "REVOKE UPDATE (source) ON public.opportunities FROM authenticated",
      UPDATE_COLUMNS_MESSAGE,
    ],
    [
      "authenticated con UPDATE sobre opportunities.last_activity_at",
      "GRANT UPDATE (last_activity_at) ON public.opportunities TO authenticated",
      "REVOKE UPDATE (last_activity_at) ON public.opportunities FROM authenticated",
      UPDATE_COLUMNS_MESSAGE,
    ],
    [
      "authenticated con UPDATE sobre otra tabla (y su policy)",
      `GRANT UPDATE (name) ON public.contacts TO authenticated;
       CREATE POLICY probe_update ON public.contacts FOR UPDATE TO authenticated
         USING (organization_id IN (SELECT private.user_org_ids()))
         WITH CHECK (organization_id IN (SELECT private.user_org_ids()))`,
      `DROP POLICY probe_update ON public.contacts;
       REVOKE UPDATE (name) ON public.contacts FROM authenticated`,
      UPDATE_COLUMNS_MESSAGE,
    ],
    [
      "una policy de UPDATE de opportunities sin USING",
      `CREATE POLICY probe_update ON public.opportunities FOR UPDATE TO authenticated
         WITH CHECK (organization_id IN (SELECT private.user_org_ids()))`,
      "DROP POLICY probe_update ON public.opportunities",
      /must have a USING/,
    ],
    [
      "authenticated con DELETE sobre opportunities (y su policy)",
      `GRANT DELETE ON public.opportunities TO authenticated;
       CREATE POLICY probe_delete ON public.opportunities FOR DELETE TO authenticated
         USING (organization_id IN (SELECT private.user_org_ids()))`,
      `DROP POLICY probe_delete ON public.opportunities;
       REVOKE DELETE ON public.opportunities FROM authenticated`,
      /must not delete or truncate/,
    ],
    [
      "authenticated con INSERT fuera de las altas aprobadas (aun con policy y WITH CHECK)",
      `GRANT INSERT ON public.memberships TO authenticated;
       CREATE POLICY probe_insert ON public.memberships FOR INSERT TO authenticated
         WITH CHECK (organization_id IN (SELECT private.user_org_ids()))`,
      `DROP POLICY probe_insert ON public.memberships;
       REVOKE INSERT ON public.memberships FROM authenticated`,
      /may only insert into contacts, opportunities, vehicles and opportunity_demand_facts/,
    ],
  ];

  it.each(unsafeStates)(
    "0008 falla cerrada ante %s",
    async (_, unsafe, restore, reason) => {
      const h14 = await server.createDatabase();
      await migrateUpTo(h14.migrationUrl, "0007_opportunity_demand_facts");
      await h14.admin.unsafe(unsafe);
      try {
        await expect(runMigrations(h14.migrationUrl)).rejects.toThrow(
          "pnpm db:migrate failed",
        );
        await expect(
          migrateReportingErrors(h14.migrationUrl),
        ).rejects.toMatchObject({
          cause: { message: expect.stringMatching(/^ADR-001: /) },
        });
        await expect(
          migrateReportingErrors(h14.migrationUrl),
        ).rejects.toMatchObject({
          cause: { message: expect.stringMatching(reason) },
        });
        // Nada se aplicó: ni la columna, ni la policy, ni el trigger.
        expect(await history(h14.admin)).toBe(8);
        expect(await stageCheck(h14.admin)).toContain("'qualified'::text");
        const [objects] = await h14.admin<
          { column: boolean; trigger: boolean }[]
        >`
          SELECT
            EXISTS (
              SELECT FROM pg_attribute
              WHERE attrelid = 'public.opportunities'::regclass
                AND attname = 'loss_reason' AND NOT attisdropped
            ) AS "column",
            EXISTS (
              SELECT FROM pg_trigger
              WHERE tgrelid = 'public.opportunities'::regclass AND NOT tgisinternal
            ) AS trigger
        `;
        expect(objects).toEqual({ column: false, trigger: false });
      } finally {
        await h14.admin.unsafe(restore);
      }
      // Corregido el estado, 0008 se aplica.
      await runMigrations(h14.migrationUrl);
      expect(await catalogSnapshot(h14.admin)).toEqual(afterMigration);
    },
  );

  /*
   * La postcondición del trigger no se puede forzar antes de migrar (el
   * trigger lo crea la misma migración), así que se corre su bloque contra
   * una base ya migrada: pasa con el trigger habilitado y falla cerrada si
   * está deshabilitado, si falta o si es de otra clase.
   */
  it("la postcondición de 0008 exige el trigger de transiciones, habilitado", async () => {
    const sql = await readFile(
      new URL("0008_opportunity_stages.sql", MIGRATIONS_DIR),
      "utf8",
    );
    const block = sql.split("--> statement-breakpoint").at(-1)!.trim();
    expect(block).toContain(
      "DEC-032: opportunities need the enabled BEFORE UPDATE",
    );

    // Sobre una base en H1.6: 0009 amplía las ediciones y las altas que esta
    // postcondición admite.
    const fresh = await server.createDatabase();
    await migrateUpTo(fresh.migrationUrl, "0008_opportunity_stages");
    // Control: con el trigger habilitado, la postcondición pasa.
    await fresh.admin.begin(async (tx) => {
      await tx.unsafe(block);
    });

    const broken = [
      "ALTER TABLE public.opportunities DISABLE TRIGGER opportunities_stage_transition",
      "DROP TRIGGER opportunities_stage_transition ON public.opportunities",
      `DROP TRIGGER opportunities_stage_transition ON public.opportunities;
       CREATE TRIGGER opportunities_stage_transition AFTER UPDATE ON public.opportunities
         FOR EACH ROW EXECUTE FUNCTION private.enforce_opportunity_stage_transition()`,
    ];
    for (const statement of broken) {
      await expect(
        fresh.admin.begin(async (tx) => {
          await tx.unsafe(statement);
          await tx.unsafe(block);
        }),
        statement,
      ).rejects.toMatchObject({
        message: expect.stringMatching(
          /^DEC-032: opportunities need the enabled BEFORE UPDATE stage transition trigger/,
        ),
      });
    }
  });
});

/*
 * Una base en H1.6 (0000 a 0008, DEC-032) recibe 0009 (Hito 2, DEC-033):
 * agrega la bitácora (opportunity_notes), la unidad vinculada
 * (opportunities.vehicle_id, nula en toda fila existente) con su FK
 * compuesta, su CHECK y su UPDATE por columna, y amplía la función del
 * trigger. No toca ninguna fila.
 */
describe("0009 sobre una base en H1.6", () => {
  /** Todo lo que puede tener staging, fila por fila (sin la columna nueva). */
  async function h16Snapshot(sql: TestDatabase["admin"]) {
    const [snapshot] = await sql<{ data: unknown }[]>`
      SELECT jsonb_build_object(
        'organizations', (SELECT jsonb_agg(o ORDER BY o.id) FROM public.organizations o),
        'profiles', (SELECT jsonb_agg(p ORDER BY p.id) FROM public.profiles p),
        'memberships', (SELECT jsonb_agg(m ORDER BY m.id) FROM public.memberships m),
        'contacts', (SELECT jsonb_agg(c ORDER BY c.id) FROM public.contacts c),
        'opportunities', (SELECT jsonb_agg(to_jsonb(op)${sql.unsafe(LATER_COLUMNS)} ORDER BY op.id) FROM public.opportunities op),
        'vehicles', (SELECT jsonb_agg(v ORDER BY v.id) FROM public.vehicles v),
        'demand_facts', (SELECT jsonb_agg(f ORDER BY f.id) FROM public.opportunity_demand_facts f)
      ) AS data
    `;
    return snapshot?.data;
  }

  async function history(sql: TestDatabase["admin"]): Promise<number> {
    const [row] = await sql<{ count: number }[]>`
      SELECT count(*)::int AS count FROM drizzle.__drizzle_migrations
    `;
    return row?.count ?? 0;
  }

  /** Si existen la columna de la unidad y la tabla de la bitácora. */
  async function hito2Objects(sql: TestDatabase["admin"]) {
    const [row] = await sql<{ column: boolean; notes: boolean }[]>`
      SELECT
        EXISTS (
          SELECT FROM pg_attribute
          WHERE attrelid = 'public.opportunities'::regclass
            AND attname = 'vehicle_id' AND NOT attisdropped
        ) AS "column",
        to_regclass('public.opportunity_notes') IS NOT NULL AS notes
    `;
    return row;
  }

  it("pnpm db:migrate aplica 0009 y 0010, conserva los datos (en todas las etapas abiertas) y deja el mismo catálogo", async () => {
    const h16 = await server.createDatabase();
    await migrateUpTo(h16.migrationUrl, "0008_opportunity_stages");
    await seedTenants(h16.admin);
    // Desde H1.6 las oportunidades pueden estar en cualquier etapa.
    await seedOpportunities(h16.admin);
    await seedVehicles(h16.admin);
    const before = await h16Snapshot(h16.admin);
    expect(await history(h16.admin)).toBe(9);
    expect(await hito2Objects(h16.admin)).toEqual({
      column: false,
      notes: false,
    });

    await runMigrations(h16.migrationUrl);

    expect(await history(h16.admin)).toBe(11);
    // Ninguna fila cambia: ni etapas, ni timestamps, ni recencia, ni stock.
    expect(await h16Snapshot(h16.admin)).toEqual(before);
    const [linked] = await h16.admin<{ count: number }[]>`
      SELECT count(*)::int AS count FROM public.opportunities
      WHERE vehicle_id IS NOT NULL
    `;
    expect(linked?.count).toBe(0);
    const [notes] = await h16.admin<{ count: number }[]>`
      SELECT count(*)::int AS count FROM public.opportunity_notes
    `;
    expect(notes?.count).toBe(0);
    expect(OPPORTUNITIES.length).toBeGreaterThan(0);
    expect(VEHICLES.length).toBeGreaterThan(0);
    expect(await catalogSnapshot(h16.admin)).toEqual(afterMigration);
  });

  /*
   * Postcondiciones de 0009: las de 0008, con opportunities.vehicle_id entre
   * las ediciones aprobadas y opportunity_notes entre las altas aprobadas. Si
   * la base no las cumple, 0009 falla y no aplica nada.
   */
  const UPDATE_COLUMNS_MESSAGE =
    /may only update vehicles\.status, vehicles\.updated_at \(H1\.3C\) and opportunities\.stage, loss_reason, vehicle_id, updated_at \(H1\.6, Hito 2\)/;
  const unsafeStates: [string, string, string, RegExp][] = [
    [
      "authenticated con UPDATE sobre opportunities.source",
      "GRANT UPDATE (source) ON public.opportunities TO authenticated",
      "REVOKE UPDATE (source) ON public.opportunities FROM authenticated",
      UPDATE_COLUMNS_MESSAGE,
    ],
    [
      "app_runtime con UPDATE directo sobre opportunities.stage",
      "GRANT UPDATE (stage) ON public.opportunities TO app_runtime",
      "REVOKE UPDATE (stage) ON public.opportunities FROM app_runtime",
      /anon and app_runtime must not have privileges/,
    ],
    [
      "service_role con UPDATE sobre la demanda",
      "GRANT UPDATE ON public.opportunity_demand_facts TO service_role",
      "REVOKE UPDATE ON public.opportunity_demand_facts FROM service_role",
      /service_role must not update, delete or truncate opportunity_demand_facts or opportunity_notes/,
    ],
    [
      "authenticated con INSERT fuera de las altas aprobadas (aun con policy y WITH CHECK)",
      `GRANT INSERT ON public.memberships TO authenticated;
       CREATE POLICY probe_insert ON public.memberships FOR INSERT TO authenticated
         WITH CHECK (organization_id IN (SELECT private.user_org_ids()))`,
      `DROP POLICY probe_insert ON public.memberships;
       REVOKE INSERT ON public.memberships FROM authenticated`,
      /may only insert into contacts, opportunities, vehicles, opportunity_demand_facts \(H1\.4\) and opportunity_notes \(Hito 2\)/,
    ],
  ];

  it.each(unsafeStates)(
    "0009 falla cerrada ante %s",
    async (_, unsafe, restore, reason) => {
      const h16 = await server.createDatabase();
      await migrateUpTo(h16.migrationUrl, "0008_opportunity_stages");
      await h16.admin.unsafe(unsafe);
      try {
        await expect(runMigrations(h16.migrationUrl)).rejects.toThrow(
          "pnpm db:migrate failed",
        );
        await expect(
          migrateReportingErrors(h16.migrationUrl),
        ).rejects.toMatchObject({
          cause: { message: expect.stringMatching(reason) },
        });
        // Nada se aplicó: ni la columna, ni la tabla.
        expect(await history(h16.admin)).toBe(9);
        expect(await hito2Objects(h16.admin)).toEqual({
          column: false,
          notes: false,
        });
      } finally {
        await h16.admin.unsafe(restore);
      }
      // Corregido el estado, 0009 se aplica.
      await runMigrations(h16.migrationUrl);
      expect(await catalogSnapshot(h16.admin)).toEqual(afterMigration);
    },
  );

  /*
   * Las postcondiciones que dependen de lo que crea la misma migración (el
   * trigger ampliado y la bitácora append-only) se corren contra una base ya
   * migrada: pasan sobre el catálogo real y fallan cerradas ante cada
   * mutación.
   */
  it("la postcondición de 0009 exige el trigger y la bitácora append-only", async () => {
    const sql = await readFile(
      new URL("0009_opportunity_notes_vehicle_link.sql", MIGRATIONS_DIR),
      "utf8",
    );
    const block = sql.split("--> statement-breakpoint").at(-1)!.trim();
    expect(block).toMatch(/^-- Custom SQL · postcondiciones[\s\S]*DO \$\$/);

    // Sobre una base en el Hito 2: 0010 amplía las ediciones que esta
    // postcondición admite.
    const fresh = await server.createDatabase();
    await migrateUpTo(
      fresh.migrationUrl,
      "0009_opportunity_notes_vehicle_link",
    );
    // Control: sobre el catálogo del Hito 2, la postcondición pasa.
    await fresh.admin.begin(async (tx) => {
      await tx.unsafe(block);
    });

    const broken: [string, RegExp][] = [
      [
        "ALTER TABLE public.opportunities DISABLE TRIGGER opportunities_stage_transition",
        /^DEC-032: opportunities need the enabled BEFORE UPDATE stage transition trigger/,
      ],
      [
        `CREATE POLICY probe ON public.opportunity_notes FOR DELETE TO authenticated
           USING (organization_id IN (SELECT private.user_org_ids()))`,
        /opportunity_notes are append-only: no UPDATE, DELETE or ALL policies/,
      ],
      [
        `GRANT UPDATE (body) ON public.opportunity_notes TO authenticated;
         CREATE POLICY probe ON public.opportunity_notes FOR UPDATE TO authenticated
           USING (organization_id IN (SELECT private.user_org_ids()))
           WITH CHECK (organization_id IN (SELECT private.user_org_ids()))`,
        UPDATE_COLUMNS_MESSAGE,
      ],
      [
        "GRANT DELETE ON public.opportunity_notes TO service_role",
        /service_role must not update, delete or truncate opportunity_demand_facts or opportunity_notes/,
      ],
      [
        "GRANT UPDATE (body) ON public.opportunity_notes TO service_role",
        /service_role must not update, delete or truncate opportunity_demand_facts or opportunity_notes/,
      ],
      [
        "ALTER TABLE public.opportunity_notes DISABLE ROW LEVEL SECURITY",
        /RLS enabled/,
      ],
    ];
    for (const [statement, reason] of broken) {
      await expect(
        fresh.admin.begin(async (tx) => {
          await tx.unsafe(statement);
          await tx.unsafe(block);
        }),
        statement,
      ).rejects.toMatchObject({ message: expect.stringMatching(reason) });
    }
  });
});

/*
 * Una base en el Hito 2 (0000 a 0009, DEC-033) recibe 0010 (DEC-034): los
 * metadatos del cierre (nulos en toda fila existente), la lista nueva de
 * motivos de pérdida, sus CHECKs, la función del trigger ampliada y el
 * UPDATE por columna. No toca ninguna fila; una fila cerrada que no puede
 * cumplir los CHECKs nuevos la detiene en vez de reinterpretarla.
 */
describe("0010 sobre una base en el Hito 2", () => {
  const HITO_2 = "0009_opportunity_notes_vehicle_link";
  const CLOSURE_COLUMNS = sqlColumns([
    "loss_notes",
    "sale_price",
    "sale_currency",
    "payment_method",
    "delivery_status",
    "delivery_date",
  ]);

  /** Todo lo que puede tener staging, fila por fila (sin las columnas nuevas). */
  async function hito2Snapshot(sql: TestDatabase["admin"]) {
    const [snapshot] = await sql<{ data: unknown }[]>`
      SELECT jsonb_build_object(
        'organizations', (SELECT jsonb_agg(o ORDER BY o.id) FROM public.organizations o),
        'profiles', (SELECT jsonb_agg(p ORDER BY p.id) FROM public.profiles p),
        'memberships', (SELECT jsonb_agg(m ORDER BY m.id) FROM public.memberships m),
        'contacts', (SELECT jsonb_agg(c ORDER BY c.id) FROM public.contacts c),
        'opportunities', (SELECT jsonb_agg(to_jsonb(op)${sql.unsafe(CLOSURE_COLUMNS)} ORDER BY op.id) FROM public.opportunities op),
        'vehicles', (SELECT jsonb_agg(v ORDER BY v.id) FROM public.vehicles v),
        'demand_facts', (SELECT jsonb_agg(f ORDER BY f.id) FROM public.opportunity_demand_facts f),
        'notes', (SELECT jsonb_agg(n ORDER BY n.id) FROM public.opportunity_notes n)
      ) AS data
    `;
    return snapshot?.data;
  }

  async function history(sql: TestDatabase["admin"]): Promise<number> {
    const [row] = await sql<{ count: number }[]>`
      SELECT count(*)::int AS count FROM drizzle.__drizzle_migrations
    `;
    return row?.count ?? 0;
  }

  /** Si existen las columnas del cierre (todas o ninguna). */
  async function closureColumnsExist(sql: TestDatabase["admin"]) {
    const [row] = await sql<{ count: number }[]>`
      SELECT count(*)::int AS count FROM pg_attribute
      WHERE attrelid = 'public.opportunities'::regclass AND NOT attisdropped
        AND attname IN ('loss_notes', 'sale_price', 'sale_currency',
          'payment_method', 'delivery_status', 'delivery_date')
    `;
    return row?.count;
  }

  async function lossReasonCheck(sql: TestDatabase["admin"]): Promise<string> {
    const [row] = await sql<{ definition: string }[]>`
      SELECT pg_get_constraintdef(oid) AS definition FROM pg_constraint
      WHERE conname = 'opportunities_loss_reason_check'
    `;
    return row?.definition ?? "";
  }

  /** Una oportunidad cerrada como la pudo dejar el Hito 2 (sin metadatos). */
  async function closedInHito2(
    sql: TestDatabase["admin"],
    stage: "won" | "lost",
    lossReason: string | null,
  ): Promise<string> {
    const [contact] = await sql<{ id: string }[]>`
      INSERT INTO public.contacts (organization_id, name)
      VALUES (${ORG_1}, ${`Cerrada en el Hito 2 (${stage})`}) RETURNING id
    `;
    const [opportunity] = await sql<{ id: string }[]>`
      INSERT INTO public.opportunities (organization_id, contact_id, stage,
        loss_reason, source)
      VALUES (${ORG_1}, ${contact!.id}, ${stage}, ${lossReason}, 'web')
      RETURNING id
    `;
    return opportunity!.id;
  }

  /** Una base en el Hito 2 con datos en todas las etapas que 0010 admite. */
  async function hito2Base(): Promise<TestDatabase> {
    const base = await server.createDatabase();
    await migrateUpTo(base.migrationUrl, HITO_2);
    await seedTenants(base.admin);
    await seedOpportunities(base.admin);
    await seedVehicles(base.admin);
    // Perdidas con motivos que existen en las dos listas (DEC-032 y DEC-034).
    await closedInHito2(base.admin, "lost", "price");
    await closedInHito2(base.admin, "lost", "other");
    return base;
  }

  it("pnpm db:migrate aplica solo 0010, conserva los datos (también las perdidas con motivos que siguen) y deja el mismo catálogo", async () => {
    const hito2 = await hito2Base();
    const before = await hito2Snapshot(hito2.admin);
    expect(await history(hito2.admin)).toBe(10);
    expect(await closureColumnsExist(hito2.admin)).toBe(0);
    expect(await lossReasonCheck(hito2.admin)).toContain("'unqualified'::text");

    await runMigrations(hito2.migrationUrl);

    expect(await history(hito2.admin)).toBe(11);
    // Ninguna fila cambia: ni etapas, ni motivos, ni timestamps, ni stock.
    expect(await hito2Snapshot(hito2.admin)).toEqual(before);
    const [metadata] = await hito2.admin<{ count: number }[]>`
      SELECT count(*)::int AS count FROM public.opportunities
      WHERE num_nonnulls(loss_notes, sale_price, sale_currency,
        payment_method, delivery_status, delivery_date) > 0
    `;
    expect(metadata?.count).toBe(0);
    const [lost] = await hito2.admin<{ reasons: string[] }[]>`
      SELECT array_agg(loss_reason ORDER BY loss_reason) AS reasons
      FROM public.opportunities WHERE stage = 'lost'
    `;
    expect(lost?.reasons).toEqual(["other", "price"]);
    expect(await lossReasonCheck(hito2.admin)).toContain("'ghosted'::text");
    expect(await catalogSnapshot(hito2.admin)).toEqual(afterMigration);
  });

  it("una oportunidad ganada sin venta detiene 0010 en vez de inventarla, y no aplica nada", async () => {
    const hito2 = await hito2Base();
    const won = await closedInHito2(hito2.admin, "won", null);
    const before = await hito2Snapshot(hito2.admin);

    await expect(runMigrations(hito2.migrationUrl)).rejects.toThrow(
      "pnpm db:migrate failed",
    );
    await expect(
      migrateReportingErrors(hito2.migrationUrl),
    ).rejects.toMatchObject({
      cause: {
        message: expect.stringMatching(
          /^DEC-034: closed opportunities without the new closure metadata cannot be migrated automatically/,
        ),
      },
    });
    expect(await history(hito2.admin)).toBe(10);
    expect(await closureColumnsExist(hito2.admin)).toBe(0);
    expect(await lossReasonCheck(hito2.admin)).toContain("'unqualified'::text");
    expect(await hito2Snapshot(hito2.admin)).toEqual(before);

    // Quien lo decide la corrige a mano (acá, la descarta) y 0010 se aplica.
    await hito2.admin`DELETE FROM public.opportunities WHERE id = ${won}`;
    await runMigrations(hito2.migrationUrl);
    expect(await history(hito2.admin)).toBe(11);
    expect(await catalogSnapshot(hito2.admin)).toEqual(afterMigration);
  });

  it.each([
    "vehicle_not_available",
    "bought_elsewhere",
    "no_response",
    "unqualified",
  ])(
    "una perdida con el motivo %s (que ya no existe) detiene 0010 en vez de reinterpretarlo",
    async (legacy) => {
      const hito2 = await hito2Base();
      const lost = await closedInHito2(hito2.admin, "lost", legacy);

      await expect(
        migrateReportingErrors(hito2.migrationUrl),
      ).rejects.toMatchObject({
        cause: {
          message: expect.stringMatching(/^DEC-034: closed opportunities/),
        },
      });
      expect(await history(hito2.admin)).toBe(10);
      expect(await closureColumnsExist(hito2.admin)).toBe(0);

      // El trigger no deja reescribir el motivo: el mantenimiento lo
      // deshabilita de forma explícita, corrige y lo vuelve a habilitar.
      await expect(
        hito2.admin`UPDATE public.opportunities SET loss_reason = 'other' WHERE id = ${lost}`,
      ).rejects.toMatchObject({ code: "23514" });
      await hito2.admin.begin(async (tx) => {
        await tx`ALTER TABLE public.opportunities DISABLE TRIGGER opportunities_stage_transition`;
        await tx`UPDATE public.opportunities SET loss_reason = 'other' WHERE id = ${lost}`;
        await tx`ALTER TABLE public.opportunities ENABLE TRIGGER opportunities_stage_transition`;
      });
      await runMigrations(hito2.migrationUrl);
      expect(await history(hito2.admin)).toBe(11);
      expect(await catalogSnapshot(hito2.admin)).toEqual(afterMigration);
    },
  );

  /*
   * Postcondiciones de 0010: las de 0009, con los metadatos del cierre entre
   * las ediciones aprobadas, y las propias de DEC-034. Si la base no las
   * cumple, 0010 falla y no aplica nada.
   */
  const UPDATE_COLUMNS_MESSAGE =
    /may only update vehicles\.status, vehicles\.updated_at \(H1\.3C\) and opportunities\.stage, loss_reason, vehicle_id, updated_at and the closure metadata \(H1\.6, Hito 2, DEC-034\)/;
  const unsafeStates: [string, string, string, RegExp][] = [
    [
      "una tabla de public sin RLS",
      "CREATE TABLE public.probe (id int)",
      "DROP TABLE public.probe",
      /RLS enabled/,
    ],
    [
      "authenticated con UPDATE sobre opportunities.last_activity_at",
      "GRANT UPDATE (last_activity_at) ON public.opportunities TO authenticated",
      "REVOKE UPDATE (last_activity_at) ON public.opportunities FROM authenticated",
      UPDATE_COLUMNS_MESSAGE,
    ],
    [
      "app_runtime con UPDATE directo sobre opportunities.stage",
      "GRANT UPDATE (stage) ON public.opportunities TO app_runtime",
      "REVOKE UPDATE (stage) ON public.opportunities FROM app_runtime",
      /anon and app_runtime must not have privileges/,
    ],
    [
      "la FK compuesta de la unidad sin validar",
      `ALTER TABLE public.opportunities DROP CONSTRAINT opportunities_vehicle_fk;
       ALTER TABLE public.opportunities ADD CONSTRAINT opportunities_vehicle_fk
         FOREIGN KEY (organization_id, vehicle_id) REFERENCES public.vehicles (organization_id, id)
         ON DELETE RESTRICT NOT VALID`,
      "ALTER TABLE public.opportunities VALIDATE CONSTRAINT opportunities_vehicle_fk",
      /^DEC-034: the sold vehicle must belong to the same organization/,
    ],
  ];

  it.each(unsafeStates)(
    "0010 falla cerrada ante %s",
    async (_, unsafe, restore, reason) => {
      const hito2 = await server.createDatabase();
      await migrateUpTo(hito2.migrationUrl, HITO_2);
      await hito2.admin.unsafe(unsafe);
      try {
        await expect(runMigrations(hito2.migrationUrl)).rejects.toThrow(
          "pnpm db:migrate failed",
        );
        await expect(
          migrateReportingErrors(hito2.migrationUrl),
        ).rejects.toMatchObject({
          cause: { message: expect.stringMatching(reason) },
        });
        // Nada se aplicó: ni las columnas, ni la lista nueva de motivos.
        expect(await history(hito2.admin)).toBe(10);
        expect(await closureColumnsExist(hito2.admin)).toBe(0);
        expect(await lossReasonCheck(hito2.admin)).toContain(
          "'unqualified'::text",
        );
      } finally {
        await hito2.admin.unsafe(restore);
      }
      // Corregido el estado, 0010 se aplica.
      await runMigrations(hito2.migrationUrl);
      expect(await catalogSnapshot(hito2.admin)).toEqual(afterMigration);
    },
  );

  /*
   * Las postcondiciones que dependen de lo que crea la misma migración (los
   * CHECKs de cierre y la función ampliada) se corren contra una base ya
   * migrada: pasan sobre el catálogo real y fallan cerradas ante cada
   * mutación.
   */
  it("la postcondición de 0010 exige los CHECKs de cierre validados, la regla de inmutabilidad y la FK compuesta", async () => {
    const sql = await readFile(
      new URL("0010_opportunity_closure_metadata.sql", MIGRATIONS_DIR),
      "utf8",
    );
    const block = sql.split("--> statement-breakpoint").at(-1)!.trim();
    expect(block).toMatch(/^-- Custom SQL · postcondiciones[\s\S]*DO \$\$/);

    const fresh = await server.createDatabase();
    await runMigrations(fresh.migrationUrl);
    // Control: sobre el catálogo real, la postcondición pasa.
    await fresh.admin.begin(async (tx) => {
      await tx.unsafe(block);
    });

    const wonCheck =
      "(stage = 'won' AND vehicle_id IS NOT NULL AND sale_price IS NOT NULL AND sale_currency IS NOT NULL AND payment_method IS NOT NULL AND delivery_status IS NOT NULL AND delivery_date IS NOT NULL) OR (stage <> 'won' AND sale_price IS NULL AND sale_currency IS NULL AND payment_method IS NULL AND delivery_status IS NULL AND delivery_date IS NULL)";
    const broken: [string, RegExp][] = [
      [
        "ALTER TABLE public.opportunities DISABLE TRIGGER opportunities_stage_transition",
        /^DEC-032: opportunities need the enabled BEFORE UPDATE stage transition trigger/,
      ],
      [
        await function0009(),
        /^DEC-034: the stage transition trigger must keep the closure metadata immutable/,
      ],
      [
        "ALTER TABLE public.opportunities DROP CONSTRAINT opportunities_won_closure_check",
        /^DEC-034: opportunities need the validated closure CHECK constraints/,
      ],
      [
        `ALTER TABLE public.opportunities DROP CONSTRAINT opportunities_won_closure_check;
         ALTER TABLE public.opportunities ADD CONSTRAINT opportunities_won_closure_check CHECK (${wonCheck}) NOT VALID`,
        /^DEC-034: opportunities need the validated closure CHECK constraints/,
      ],
      [
        "ALTER TABLE public.opportunities DROP CONSTRAINT opportunities_loss_notes_stage_check",
        /^DEC-034: opportunities need the validated closure CHECK constraints/,
      ],
      [
        "ALTER TABLE public.opportunities DROP CONSTRAINT opportunities_vehicle_fk",
        /^DEC-034: the sold vehicle must belong to the same organization/,
      ],
      [
        `GRANT UPDATE (last_activity_at) ON public.opportunities TO authenticated`,
        UPDATE_COLUMNS_MESSAGE,
      ],
    ];
    for (const [statement, reason] of broken) {
      await expect(
        fresh.admin.begin(async (tx) => {
          await tx.unsafe(statement);
          await tx.unsafe(block);
        }),
        statement.slice(0, 80),
      ).rejects.toMatchObject({ message: expect.stringMatching(reason) });
    }
  });

  describe("idempotencia", () => {
    it("pnpm db:migrate dos veces: la segunda no aplica nada, ni toca los datos", async () => {
      const hito2 = await hito2Base();
      await runMigrations(hito2.migrationUrl);
      const rows = await hito2.admin`
        SELECT to_jsonb(op) AS row FROM public.opportunities op ORDER BY op.id
      `;
      const catalog = await catalogSnapshot(hito2.admin);

      await runMigrations(hito2.migrationUrl);

      expect(await history(hito2.admin)).toBe(11);
      expect(
        await hito2.admin`
          SELECT to_jsonb(op) AS row FROM public.opportunities op ORDER BY op.id
        `,
      ).toEqual(rows);
      expect(await catalogSnapshot(hito2.admin)).toEqual(catalog);
    });

    it("volver a ejecutar su SQL fuera del historial falla entero y no deja nada a medias", async () => {
      const sql = await readFile(
        new URL("0010_opportunity_closure_metadata.sql", MIGRATIONS_DIR),
        "utf8",
      );
      const statements = sql.split("--> statement-breakpoint");
      const fresh = await server.createDatabase();
      await runMigrations(fresh.migrationUrl);
      const owner = postgres(fresh.migrationUrl, {
        max: 1,
        onnotice: () => {},
      });
      try {
        await expect(
          owner.begin(async (tx) => {
            for (const statement of statements) await tx.unsafe(statement);
          }),
        ).rejects.toMatchObject({ code: "42701" });
      } finally {
        await owner.end();
      }
      // La transacción se revirtió: el CHECK de motivos que la segunda
      // pasada borró antes de fallar sigue ahí, igual que todo lo demás.
      expect(await catalogSnapshot(fresh.admin)).toEqual(afterMigration);
      expect(await history(fresh.admin)).toBe(11);
    });

    it("se revierte sola al catálogo del Hito 2 y se vuelve a aplicar idéntica", async () => {
      const reference = await server.createDatabase();
      await migrateUpTo(reference.migrationUrl, HITO_2);
      const hito2Catalog = await catalogSnapshot(reference.admin);

      const fresh = await server.createDatabase();
      await runMigrations(fresh.migrationUrl);
      const owner = postgres(fresh.migrationUrl, {
        max: 1,
        onnotice: () => {},
      });
      try {
        // La reversión corre con la credencial de migración, dueña de todo.
        await owner.begin(async (tx) => {
          await tx.unsafe(REVERT_0010);
          await tx.unsafe(await function0009());
          await tx.unsafe(`
            DELETE FROM drizzle.__drizzle_migrations
            WHERE created_at = (SELECT max(created_at) FROM drizzle.__drizzle_migrations)
          `);
        });
      } finally {
        await owner.end();
      }
      expect(await catalogSnapshot(fresh.admin)).toEqual(hito2Catalog);
      expect(await history(fresh.admin)).toBe(10);

      await runMigrations(fresh.migrationUrl);
      expect(await history(fresh.admin)).toBe(11);
      expect(await catalogSnapshot(fresh.admin)).toEqual(afterMigration);
    });
  });
});
