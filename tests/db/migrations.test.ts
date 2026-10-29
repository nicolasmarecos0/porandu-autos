import { readdir, readFile } from "node:fs/promises";

import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import { catalogSnapshot, tableNames } from "./support/catalog";
import {
  migrateUpTo,
  runMigrations,
  startTestServer,
  type TestDatabase,
  type TestServer,
} from "./support/postgres";
import { OPPORTUNITIES, seedOpportunities } from "./support/opportunities";
import { MEMBERSHIPS, ORG_1, seedTenants, USER_A } from "./support/tenants";
import { seedVehicles, VEHICLES } from "./support/vehicles";

/*
 * Migraciones de db/migrations aplicadas desde cero con `pnpm db:migrate`
 * sobre PostgreSQL 17 (con el mínimo de Supabase de supabase-shim.sql).
 */

const MIGRATIONS_DIR = new URL("../../db/migrations/", import.meta.url);

/*
 * Reversión de 0014_whatsapp_outbound, 0013_whatsapp_ingestion,
 * 0012_team_settings,
 * 0011_conversations_and_activity_trigger,
 * 0010_opportunity_closure_metadata,
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
 * 0010 y 0011 reemplazan la función del trigger (CREATE OR REPLACE):
 * revertir una restaura la de la migración anterior, tal como la escribe esa
 * migración.
 */
async function stageFunctionOf(file: string): Promise<string> {
  const sql = await readFile(new URL(file, MIGRATIONS_DIR), "utf8");
  const start = sql.indexOf('CREATE OR REPLACE FUNCTION "private"');
  return sql.slice(start, sql.indexOf("$$;", sql.indexOf("AS $$", start)) + 3);
}

function function0009(): Promise<string> {
  return stageFunctionOf("0009_opportunity_notes_vehicle_link.sql");
}

function function0010(): Promise<string> {
  return stageFunctionOf("0010_opportunity_closure_metadata.sql");
}

const REVERT_0014 = `
  REVOKE SELECT ON public.whatsapp_lines FROM authenticated;
  DROP FUNCTION private.record_outbound_whatsapp_message(uuid, uuid, text, text, text);
  DROP POLICY whatsapp_lines_select_member ON public.whatsapp_lines;
  ALTER POLICY messages_insert_member ON public.messages TO authenticated WITH CHECK (organization_id IN (SELECT private.user_org_ids()) AND recorded_by = (SELECT auth.uid()) AND created_at = now());
  ALTER TABLE public.messages DROP CONSTRAINT messages_source_check;
  ALTER TABLE public.messages ADD CONSTRAINT messages_source_check CHECK ((recorded_by IS NOT NULL AND conversation_id IS NULL AND external_id IS NULL AND sent_at IS NULL) OR (recorded_by IS NULL AND conversation_id IS NOT NULL AND external_id IS NOT NULL AND sent_at IS NOT NULL AND channel = 'whatsapp' AND direction = 'inbound'));
`;

const REVERT_0013 = `
  DROP FUNCTION private.ingest_whatsapp_message(text, text, text, text, text, text, text, timestamp with time zone);
  DROP POLICY conversations_select_member ON public.conversations;
  ALTER TABLE public.messages DROP CONSTRAINT messages_source_check;
  ALTER TABLE public.messages DROP CONSTRAINT messages_external_id_check;
  DROP INDEX public.messages_organization_id_external_id_key;
  ALTER TABLE public.messages DROP CONSTRAINT messages_conversation_fk;
  ALTER TABLE public.messages DROP COLUMN sent_at;
  ALTER TABLE public.messages DROP COLUMN external_id;
  ALTER TABLE public.messages DROP COLUMN conversation_id;
  ALTER TABLE public.messages ALTER COLUMN recorded_by SET NOT NULL;
  DROP TABLE public.conversations;
  DROP TABLE public.whatsapp_lines;
`;

const REVERT_0012 = `
  REVOKE UPDATE (role, active, updated_at) ON public.memberships FROM authenticated;
  REVOKE INSERT ON public.memberships FROM authenticated;
  REVOKE UPDATE (name, default_currency, updated_at) ON public.organizations FROM authenticated;
  DROP TRIGGER organizations_update_guard ON public.organizations;
  DROP FUNCTION private.enforce_organization_update();
  DROP TRIGGER memberships_change_guard ON public.memberships;
  DROP FUNCTION private.enforce_membership_change();
  DROP POLICY memberships_update_admin ON public.memberships;
  DROP POLICY memberships_insert_admin ON public.memberships;
  DROP POLICY organizations_update_admin ON public.organizations;
  ALTER TABLE public.organizations DROP CONSTRAINT organizations_default_currency_check;
  ALTER TABLE public.organizations DROP CONSTRAINT organizations_name_check;
  ALTER TABLE public.organizations DROP COLUMN default_currency;
  DROP FUNCTION private.organization_members(uuid);
  DROP FUNCTION private.find_member_candidate(uuid, text);
  DROP FUNCTION private.user_admin_org_ids();
`;

const REVERT_0011 = `
  DROP TRIGGER messages_touch_activity ON public.messages;
  DROP TRIGGER opportunity_notes_touch_activity ON public.opportunity_notes;
  DROP FUNCTION private.touch_opportunity_activity();
  DROP POLICY messages_insert_member ON public.messages;
  DROP POLICY messages_select_member ON public.messages;
  DROP TABLE public.messages;
  ALTER TABLE public.opportunities DROP CONSTRAINT opportunities_organization_id_id_contact_id_key;
`;

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

  it("crea solo las tablas de H0, H1.1, H1.3A, H1.4, Hito 2, Hito 4 e Hito 7 en public (H1.2 no agrega tablas)", async () => {
    expect(await tableNames(db.admin, "public")).toEqual([
      "contacts",
      "conversations",
      "memberships",
      "messages",
      "opportunities",
      "opportunity_demand_facts",
      "opportunity_notes",
      "organizations",
      "profiles",
      "vehicles",
      "whatsapp_lines",
    ]);
  });

  it("registra 0000 a 0014 en el historial de drizzle", async () => {
    expect(await appliedMigrations()).toBe(15);
  });

  it("volver a migrar no cambia nada", async () => {
    await runMigrations(db.migrationUrl);

    expect(await appliedMigrations()).toBe(15);
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
      "0011_conversations_and_activity_trigger.sql",
      "0012_team_settings.sql",
      "0013_whatsapp_ingestion.sql",
      "0014_whatsapp_outbound.sql",
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
        await tx.unsafe(REVERT_0014);
        await tx.unsafe(REVERT_0013);
        await tx.unsafe(REVERT_0012);
        await tx.unsafe(REVERT_0011);
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
      history: 15,
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

  it("pnpm db:migrate aplica 0003 a 0011, conserva los datos y deja el mismo catálogo", async () => {
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
    expect(history?.count).toBe(15);
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
        'organizations', (SELECT jsonb_agg(to_jsonb(o) - 'default_currency' ORDER BY o.id) FROM public.organizations o),
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

  it("pnpm db:migrate aplica 0004 a 0011, conserva los datos y deja el mismo catálogo", async () => {
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

    expect(await history(h12.admin)).toBe(15);
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
        'organizations', (SELECT jsonb_agg(to_jsonb(o) - 'default_currency' ORDER BY o.id) FROM public.organizations o),
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

  it("pnpm db:migrate aplica 0005 a 0011, conserva los datos y deja el mismo catálogo", async () => {
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

    expect(await history(h13a.admin)).toBe(15);
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
        'organizations', (SELECT jsonb_agg(to_jsonb(o) - 'default_currency' ORDER BY o.id) FROM public.organizations o),
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

  it("pnpm db:migrate aplica 0006 a 0011, conserva los datos y deja el mismo catálogo", async () => {
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

    expect(await history(h13b.admin)).toBe(15);
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
        'organizations', (SELECT jsonb_agg(to_jsonb(o) - 'default_currency' ORDER BY o.id) FROM public.organizations o),
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

  it("pnpm db:migrate aplica 0007 a 0011, conserva los datos (sin backfill del legado) y deja el mismo catálogo", async () => {
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

    expect(await history(h13c.admin)).toBe(15);
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
        'organizations', (SELECT jsonb_agg(to_jsonb(o) - 'default_currency' ORDER BY o.id) FROM public.organizations o),
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

  it("pnpm db:migrate aplica 0008 a 0011, conserva los datos y deja el mismo catálogo", async () => {
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

    expect(await history(h14.admin)).toBe(15);
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
    expect(await history(h14.admin)).toBe(15);
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
        'organizations', (SELECT jsonb_agg(to_jsonb(o) - 'default_currency' ORDER BY o.id) FROM public.organizations o),
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

  it("pnpm db:migrate aplica 0009 a 0011, conserva los datos (en todas las etapas abiertas) y deja el mismo catálogo", async () => {
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

    expect(await history(h16.admin)).toBe(15);
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
        'organizations', (SELECT jsonb_agg(to_jsonb(o) - 'default_currency' ORDER BY o.id) FROM public.organizations o),
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

  it("pnpm db:migrate aplica 0010 y 0011, conserva los datos (también las perdidas con motivos que siguen) y deja el mismo catálogo", async () => {
    const hito2 = await hito2Base();
    const before = await hito2Snapshot(hito2.admin);
    expect(await history(hito2.admin)).toBe(10);
    expect(await closureColumnsExist(hito2.admin)).toBe(0);
    expect(await lossReasonCheck(hito2.admin)).toContain("'unqualified'::text");

    await runMigrations(hito2.migrationUrl);

    expect(await history(hito2.admin)).toBe(15);
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
    expect(await history(hito2.admin)).toBe(15);
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
      expect(await history(hito2.admin)).toBe(15);
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

    // Sobre una base en el Hito 2A: 0011 amplía las altas que esta
    // postcondición admite.
    const fresh = await server.createDatabase();
    await migrateUpTo(fresh.migrationUrl, "0010_opportunity_closure_metadata");
    // Control: sobre el catálogo del Hito 2A, la postcondición pasa.
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

      expect(await history(hito2.admin)).toBe(15);
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
      expect(await history(fresh.admin)).toBe(15);
    });

    it("se revierte sola al catálogo del Hito 2 y se vuelve a aplicar idéntica", async () => {
      const reference = await server.createDatabase();
      await migrateUpTo(reference.migrationUrl, HITO_2);
      const hito2Catalog = await catalogSnapshot(reference.admin);

      // Sobre una base en el Hito 2A (0011 se revierte en su propio bloque).
      const fresh = await server.createDatabase();
      await migrateUpTo(
        fresh.migrationUrl,
        "0010_opportunity_closure_metadata",
      );
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
      expect(await history(fresh.admin)).toBe(15);
      expect(await catalogSnapshot(fresh.admin)).toEqual(afterMigration);
    });
  });
});

/*
 * Una base en el Hito 2A (0000 a 0010, DEC-034) recibe 0011 (DEC-036): la
 * tabla `messages`, la unique de opportunities que es destino de su FK, la
 * función del toque de actividad con sus dos triggers y la función del
 * trigger de la oportunidad ampliada. No toca ninguna fila: las notas que ya
 * existían no mueven la recencia (sin backfill).
 */
describe("0011 sobre una base en el Hito 2A", () => {
  const HITO_2A = "0010_opportunity_closure_metadata";

  /** Todo lo que puede tener staging, fila por fila. */
  async function hito2aSnapshot(sql: TestDatabase["admin"]) {
    const [snapshot] = await sql<{ data: unknown }[]>`
      SELECT jsonb_build_object(
        'organizations', (SELECT jsonb_agg(to_jsonb(o) - 'default_currency' ORDER BY o.id) FROM public.organizations o),
        'profiles', (SELECT jsonb_agg(p ORDER BY p.id) FROM public.profiles p),
        'memberships', (SELECT jsonb_agg(m ORDER BY m.id) FROM public.memberships m),
        'contacts', (SELECT jsonb_agg(c ORDER BY c.id) FROM public.contacts c),
        'opportunities', (SELECT jsonb_agg(op ORDER BY op.id) FROM public.opportunities op),
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

  /** Si existen la tabla de mensajes y la función del toque. */
  async function hito4Objects(sql: TestDatabase["admin"]) {
    const [row] = await sql<{ messages: boolean; touch: boolean }[]>`
      SELECT
        to_regclass('public.messages') IS NOT NULL AS messages,
        to_regprocedure('private.touch_opportunity_activity()') IS NOT NULL AS touch
    `;
    return row;
  }

  /** Una base en el Hito 2A con datos y notas anteriores a 0011. */
  async function hito2aBase(): Promise<TestDatabase> {
    const base = await server.createDatabase();
    await migrateUpTo(base.migrationUrl, HITO_2A);
    await seedTenants(base.admin);
    await seedOpportunities(base.admin);
    await seedVehicles(base.admin);
    const [first] = OPPORTUNITIES;
    await base.admin`
      INSERT INTO public.opportunity_notes (organization_id, opportunity_id,
        body, recorded_by)
      VALUES (${first!.organizationId}, ${first!.id}, 'Nota del Hito 2',
        ${USER_A})
    `;
    return base;
  }

  it("pnpm db:migrate aplica 0011 a 0014, conserva los datos (sin backfill de la recencia desde las notas) y deja el mismo catálogo", async () => {
    const hito2a = await hito2aBase();
    const before = await hito2aSnapshot(hito2a.admin);
    expect(await history(hito2a.admin)).toBe(11);
    expect(await hito4Objects(hito2a.admin)).toEqual({
      messages: false,
      touch: false,
    });

    await runMigrations(hito2a.migrationUrl);

    expect(await history(hito2a.admin)).toBe(15);
    // Ninguna fila cambia: ni la recencia, ni updated_at, ni las notas.
    expect(await hito2aSnapshot(hito2a.admin)).toEqual(before);
    const [messages] = await hito2a.admin<{ count: number }[]>`
      SELECT count(*)::int AS count FROM public.messages
    `;
    expect(messages?.count).toBe(0);
    expect(await catalogSnapshot(hito2a.admin)).toEqual(afterMigration);
  });

  /*
   * Postcondiciones de 0011: las de 0010, con messages entre las altas
   * aprobadas y los ledgers append-only. Si la base no las cumple, 0011
   * falla y no aplica nada.
   */
  const INSERT_MESSAGE =
    /may only insert into contacts, opportunities, vehicles, opportunity_demand_facts \(H1\.4\), opportunity_notes \(Hito 2\) and messages \(Hito 4\)/;
  const SERVICE_ROLE_MESSAGE =
    /service_role must not update, delete or truncate opportunity_demand_facts, opportunity_notes or messages/;
  const UPDATE_COLUMNS_MESSAGE =
    /may only update vehicles\.status, vehicles\.updated_at \(H1\.3C\) and opportunities\.stage, loss_reason, vehicle_id, updated_at and the closure metadata \(H1\.6, Hito 2, DEC-034\)/;
  const unsafeStates: [string, string, string, RegExp][] = [
    [
      "authenticated con UPDATE sobre opportunities.last_activity_at (el toque no abre una edición)",
      "GRANT UPDATE (last_activity_at) ON public.opportunities TO authenticated",
      "REVOKE UPDATE (last_activity_at) ON public.opportunities FROM authenticated",
      UPDATE_COLUMNS_MESSAGE,
    ],
    [
      "authenticated con INSERT fuera de las altas aprobadas (aun con policy y WITH CHECK)",
      `GRANT INSERT ON public.memberships TO authenticated;
       CREATE POLICY probe_insert ON public.memberships FOR INSERT TO authenticated
         WITH CHECK (organization_id IN (SELECT private.user_org_ids()))`,
      `DROP POLICY probe_insert ON public.memberships;
       REVOKE INSERT ON public.memberships FROM authenticated`,
      INSERT_MESSAGE,
    ],
    [
      "service_role con DELETE sobre la bitácora",
      "GRANT DELETE ON public.opportunity_notes TO service_role",
      "REVOKE DELETE ON public.opportunity_notes FROM service_role",
      SERVICE_ROLE_MESSAGE,
    ],
    [
      "el trigger de transiciones deshabilitado",
      "ALTER TABLE public.opportunities DISABLE TRIGGER opportunities_stage_transition",
      "ALTER TABLE public.opportunities ENABLE TRIGGER opportunities_stage_transition",
      /^DEC-032: opportunities need the enabled BEFORE UPDATE stage transition trigger/,
    ],
  ];

  it.each(unsafeStates)(
    "0011 falla cerrada ante %s",
    async (_, unsafe, restore, reason) => {
      const hito2a = await server.createDatabase();
      await migrateUpTo(hito2a.migrationUrl, HITO_2A);
      await hito2a.admin.unsafe(unsafe);
      try {
        await expect(runMigrations(hito2a.migrationUrl)).rejects.toThrow(
          "pnpm db:migrate failed",
        );
        await expect(
          migrateReportingErrors(hito2a.migrationUrl),
        ).rejects.toMatchObject({
          cause: { message: expect.stringMatching(reason) },
        });
        // Nada se aplicó: ni la tabla, ni la función, ni los triggers.
        expect(await history(hito2a.admin)).toBe(11);
        expect(await hito4Objects(hito2a.admin)).toEqual({
          messages: false,
          touch: false,
        });
      } finally {
        await hito2a.admin.unsafe(restore);
      }
      // Corregido el estado, 0011 se aplica.
      await runMigrations(hito2a.migrationUrl);
      expect(await catalogSnapshot(hito2a.admin)).toEqual(afterMigration);
    },
  );

  /*
   * Las postcondiciones que dependen de lo que crea la misma migración (la
   * función del toque, sus triggers, la función ampliada y los mensajes) se
   * corren contra una base ya migrada: pasan sobre el catálogo real y fallan
   * cerradas ante cada mutación.
   */
  it("la postcondición de 0011 exige el toque de actividad (función, triggers y regla), las FKs de los mensajes y los mensajes append-only", async () => {
    const sql = await readFile(
      new URL("0011_conversations_and_activity_trigger.sql", MIGRATIONS_DIR),
      "utf8",
    );
    const block = sql.split("--> statement-breakpoint").at(-1)!.trim();
    expect(block).toMatch(/^-- Custom SQL · postcondiciones[\s\S]*DO \$\$/);

    // Sobre una base en el Hito 4/5: 0012 amplía las altas y las ediciones
    // que esta postcondición admite.
    const fresh = await server.createDatabase();
    await migrateUpTo(
      fresh.migrationUrl,
      "0011_conversations_and_activity_trigger",
    );
    // Control: sobre el catálogo del Hito 4/5, la postcondición pasa.
    await fresh.admin.begin(async (tx) => {
      await tx.unsafe(block);
    });

    const TOUCH_FUNCTION =
      /^DEC-036: private\.touch_opportunity_activity\(\) must be SECURITY DEFINER owned by postgres/;
    const TOUCH_TRIGGERS =
      /^DEC-036: opportunity_notes and messages need the enabled AFTER INSERT activity triggers/;
    const broken: [string, RegExp][] = [
      [
        await function0010(),
        /^DEC-036: the stage transition trigger must validate the activity touch/,
      ],
      [
        "ALTER TABLE public.opportunity_notes DISABLE TRIGGER opportunity_notes_touch_activity",
        TOUCH_TRIGGERS,
      ],
      [
        "DROP TRIGGER messages_touch_activity ON public.messages",
        TOUCH_TRIGGERS,
      ],
      [
        "GRANT EXECUTE ON FUNCTION private.touch_opportunity_activity() TO authenticated",
        TOUCH_FUNCTION,
      ],
      [
        "GRANT EXECUTE ON FUNCTION private.touch_opportunity_activity() TO PUBLIC",
        TOUCH_FUNCTION,
      ],
      [
        "ALTER FUNCTION private.touch_opportunity_activity() SECURITY INVOKER",
        TOUCH_FUNCTION,
      ],
      [
        "ALTER FUNCTION private.touch_opportunity_activity() RESET search_path",
        TOUCH_FUNCTION,
      ],
      [
        "ALTER FUNCTION private.touch_opportunity_activity() OWNER TO service_role",
        TOUCH_FUNCTION,
      ],
      [
        "ALTER TABLE public.messages DROP CONSTRAINT messages_opportunity_fk",
        /^DEC-036: messages need the composite contact and opportunity foreign keys/,
      ],
      [
        `ALTER TABLE public.messages DROP CONSTRAINT messages_contact_fk;
         ALTER TABLE public.messages ADD CONSTRAINT messages_contact_fk
           FOREIGN KEY (organization_id, contact_id) REFERENCES public.contacts (organization_id, id)
           ON DELETE RESTRICT NOT VALID`,
        /^DEC-036: messages need the composite contact and opportunity foreign keys/,
      ],
      [
        `CREATE POLICY probe ON public.messages FOR DELETE TO authenticated
           USING (organization_id IN (SELECT private.user_org_ids()))`,
        /opportunity_demand_facts, opportunity_notes and messages are append-only: no UPDATE, DELETE or ALL policies/,
      ],
      [
        `GRANT UPDATE (content) ON public.messages TO authenticated;
         CREATE POLICY probe ON public.messages FOR UPDATE TO authenticated
           USING (organization_id IN (SELECT private.user_org_ids()))
           WITH CHECK (organization_id IN (SELECT private.user_org_ids()))`,
        UPDATE_COLUMNS_MESSAGE,
      ],
      ["GRANT DELETE ON public.messages TO service_role", SERVICE_ROLE_MESSAGE],
      [
        "GRANT UPDATE (content) ON public.messages TO service_role",
        SERVICE_ROLE_MESSAGE,
      ],
      ["ALTER TABLE public.messages DISABLE ROW LEVEL SECURITY", /RLS enabled/],
      [
        "GRANT UPDATE (last_activity_at) ON public.opportunities TO authenticated",
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
      const hito2a = await hito2aBase();
      await runMigrations(hito2a.migrationUrl);
      const rows = await hito2aSnapshot(hito2a.admin);
      const catalog = await catalogSnapshot(hito2a.admin);

      await runMigrations(hito2a.migrationUrl);

      expect(await history(hito2a.admin)).toBe(15);
      expect(await hito2aSnapshot(hito2a.admin)).toEqual(rows);
      expect(await catalogSnapshot(hito2a.admin)).toEqual(catalog);
    });

    it("volver a ejecutar su SQL fuera del historial falla entero y no deja nada a medias", async () => {
      const sql = await readFile(
        new URL("0011_conversations_and_activity_trigger.sql", MIGRATIONS_DIR),
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
        // La unique de opportunities ya existe: 42P07 en el primer statement.
        await expect(
          owner.begin(async (tx) => {
            for (const statement of statements) await tx.unsafe(statement);
          }),
        ).rejects.toMatchObject({ code: "42P07" });
      } finally {
        await owner.end();
      }
      expect(await catalogSnapshot(fresh.admin)).toEqual(afterMigration);
      expect(await history(fresh.admin)).toBe(15);
    });

    it("se revierte sola al catálogo del Hito 2A y se vuelve a aplicar idéntica", async () => {
      const reference = await server.createDatabase();
      await migrateUpTo(reference.migrationUrl, HITO_2A);
      const hito2aCatalog = await catalogSnapshot(reference.admin);

      const fresh = await server.createDatabase();
      await runMigrations(fresh.migrationUrl);
      const owner = postgres(fresh.migrationUrl, {
        max: 1,
        onnotice: () => {},
      });
      try {
        // La reversión corre con la credencial de migración, dueña de todo.
        await owner.begin(async (tx) => {
          // 0014, 0013 y 0012 se revierten antes: dependen de lo que deja
          // 0011.
          await tx.unsafe(REVERT_0014);
          await tx.unsafe(REVERT_0013);
          await tx.unsafe(REVERT_0012);
          await tx.unsafe(REVERT_0011);
          await tx.unsafe(await function0010());
          await tx.unsafe(`
            DELETE FROM drizzle.__drizzle_migrations
            WHERE created_at >= (
              SELECT created_at FROM drizzle.__drizzle_migrations
              ORDER BY created_at DESC OFFSET 3 LIMIT 1
            )
          `);
        });
      } finally {
        await owner.end();
      }
      expect(await catalogSnapshot(fresh.admin)).toEqual(hito2aCatalog);
      expect(await history(fresh.admin)).toBe(11);

      await runMigrations(fresh.migrationUrl);
      expect(await history(fresh.admin)).toBe(15);
      expect(await catalogSnapshot(fresh.admin)).toEqual(afterMigration);
    });
  });
});

/*
 * Una base en el Hito 5 (0000 a 0011; el Hito 5 no tiene migración,
 * DEC-037) recibe 0012 (DEC-038): la moneda por defecto (PYG en las
 * organizaciones existentes), las escrituras de admin sobre organizations y
 * memberships, sus funciones de soporte y sus triggers de guarda, sin tocar
 * ninguna fila existente.
 */
describe("0012 sobre una base en el Hito 5", () => {
  const HITO_5 = "0011_conversations_and_activity_trigger";

  /*
   * Esta suite crea más de cien bases: las de este bloque se borran al
   * terminar cada caso para no agotar max_connections (100 por defecto,
   * también en CI).
   */
  const created: TestDatabase[] = [];
  async function createDatabase(): Promise<TestDatabase> {
    const database = await server.createDatabase();
    created.push(database);
    return database;
  }
  afterEach(async () => {
    for (const database of created.splice(0)) {
      await server.dropDatabase(database);
    }
  });

  async function history(sql: TestDatabase["admin"]): Promise<number> {
    const [row] = await sql<{ count: number }[]>`
      SELECT count(*)::int AS count FROM drizzle.__drizzle_migrations
    `;
    return row?.count ?? 0;
  }

  /** Organizaciones, perfiles y memberships tal como están, fila por fila. */
  async function teamSnapshot(sql: TestDatabase["admin"]) {
    const [snapshot] = await sql<{ data: unknown }[]>`
      SELECT jsonb_build_object(
        'organizations', (SELECT jsonb_agg(to_jsonb(o) - 'default_currency' ORDER BY o.id) FROM public.organizations o),
        'profiles', (SELECT jsonb_agg(p ORDER BY p.id) FROM public.profiles p),
        'memberships', (SELECT jsonb_agg(m ORDER BY m.id) FROM public.memberships m)
      ) AS data
    `;
    return snapshot?.data;
  }

  /** Si existen las funciones y los triggers de 0012. */
  async function hito6Objects(sql: TestDatabase["admin"]) {
    const [row] = await sql<{ functions: number; triggers: number }[]>`
      SELECT
        (SELECT count(*)::int FROM pg_proc
          WHERE pronamespace = 'private'::regnamespace
            AND proname IN ('user_admin_org_ids', 'find_member_candidate',
              'organization_members', 'enforce_membership_change',
              'enforce_organization_update')) AS functions,
        (SELECT count(*)::int FROM pg_trigger
          WHERE tgname IN ('memberships_change_guard', 'organizations_update_guard')) AS triggers
    `;
    return row;
  }

  async function hito5Base(): Promise<TestDatabase> {
    const base = await createDatabase();
    await migrateUpTo(base.migrationUrl, HITO_5);
    await seedTenants(base.admin);
    return base;
  }

  it("pnpm db:migrate aplica 0012 a 0014, conserva los datos (las organizaciones existentes quedan en PYG) y deja el mismo catálogo", async () => {
    const hito5 = await hito5Base();
    const before = await teamSnapshot(hito5.admin);
    expect(await history(hito5.admin)).toBe(12);
    expect(await hito6Objects(hito5.admin)).toEqual({
      functions: 0,
      triggers: 0,
    });

    await runMigrations(hito5.migrationUrl);

    expect(await history(hito5.admin)).toBe(15);
    // Ninguna fila cambia: ni nombres, ni roles, ni timestamps.
    expect(await teamSnapshot(hito5.admin)).toEqual(before);
    const currencies = await hito5.admin<{ currency: string }[]>`
      SELECT DISTINCT default_currency AS currency FROM public.organizations
    `;
    expect(currencies).toEqual([{ currency: "PYG" }]);
    expect(await catalogSnapshot(hito5.admin)).toEqual(afterMigration);
  });

  it("un nombre de organización fuera del CHECK detiene 0012 en vez de reescribirlo, y no aplica nada", async () => {
    const hito5 = await hito5Base();
    await hito5.admin`UPDATE public.organizations SET name = ' Con espacios ' WHERE id = ${ORG_1}`;

    await expect(runMigrations(hito5.migrationUrl)).rejects.toThrow(
      "pnpm db:migrate failed",
    );
    await expect(
      migrateReportingErrors(hito5.migrationUrl),
    ).rejects.toMatchObject({
      cause: { code: "23514", constraint_name: "organizations_name_check" },
    });
    expect(await history(hito5.admin)).toBe(12);
    expect(await hito6Objects(hito5.admin)).toEqual({
      functions: 0,
      triggers: 0,
    });

    // Corregido a mano (decisión humana, no de la migración), se aplica.
    await hito5.admin`UPDATE public.organizations SET name = 'Con espacios' WHERE id = ${ORG_1}`;
    await runMigrations(hito5.migrationUrl);
    expect(await history(hito5.admin)).toBe(15);
  });

  /*
   * Postcondiciones de 0012: las de 0011, con memberships entre las altas
   * aprobadas y organizations (name, default_currency, updated_at) y
   * memberships (role, active, updated_at) entre las ediciones aprobadas. Si
   * la base no las cumple, 0012 falla y no aplica nada.
   */
  const INSERT_0012 =
    /may only insert into contacts, opportunities, vehicles, opportunity_demand_facts \(H1\.4\), opportunity_notes \(Hito 2\), messages \(Hito 4\) and memberships \(Hito 6\)/;
  const UPDATE_0012 =
    /may only update vehicles\.status, vehicles\.updated_at \(H1\.3C\), opportunities\.stage, loss_reason, vehicle_id, updated_at and the closure metadata \(H1\.6, Hito 2, DEC-034\), organizations\.name, default_currency, updated_at and memberships\.role, active, updated_at \(Hito 6, DEC-038\)/;
  const SERVICE_ROLE_0012 =
    /service_role must not update, delete or truncate opportunity_demand_facts, opportunity_notes or messages/;
  const unsafeStates: [string, string, string, RegExp][] = [
    [
      "authenticated con UPDATE sobre organizations.created_at",
      "GRANT UPDATE (created_at) ON public.organizations TO authenticated",
      "REVOKE UPDATE (created_at) ON public.organizations FROM authenticated",
      UPDATE_0012,
    ],
    [
      "authenticated con INSERT sobre profiles (aun con policy y WITH CHECK)",
      `GRANT INSERT ON public.profiles TO authenticated;
       CREATE POLICY probe_insert ON public.profiles FOR INSERT TO authenticated
         WITH CHECK (id = (SELECT auth.uid()))`,
      `DROP POLICY probe_insert ON public.profiles;
       REVOKE INSERT ON public.profiles FROM authenticated`,
      INSERT_0012,
    ],
    [
      "service_role con DELETE sobre los mensajes",
      "GRANT DELETE ON public.messages TO service_role",
      "REVOKE DELETE ON public.messages FROM service_role",
      SERVICE_ROLE_0012,
    ],
  ];

  it.each(unsafeStates)(
    "0012 falla cerrada ante %s",
    async (_, unsafe, restore, reason) => {
      const hito5 = await createDatabase();
      await migrateUpTo(hito5.migrationUrl, HITO_5);
      await hito5.admin.unsafe(unsafe);
      try {
        await expect(runMigrations(hito5.migrationUrl)).rejects.toThrow(
          "pnpm db:migrate failed",
        );
        await expect(
          migrateReportingErrors(hito5.migrationUrl),
        ).rejects.toMatchObject({
          cause: { message: expect.stringMatching(reason) },
        });
        // Nada se aplicó: ni la columna, ni las funciones, ni los triggers.
        expect(await history(hito5.admin)).toBe(12);
        expect(await hito6Objects(hito5.admin)).toEqual({
          functions: 0,
          triggers: 0,
        });
      } finally {
        await hito5.admin.unsafe(restore);
      }
      // Corregido el estado, 0012 se aplica.
      await runMigrations(hito5.migrationUrl);
      expect(await catalogSnapshot(hito5.admin)).toEqual(afterMigration);
    },
  );

  /*
   * Las postcondiciones que dependen de lo que crea la misma migración (las
   * funciones de equipo y los triggers de guarda) se corren contra una base
   * ya migrada: pasan sobre el catálogo real y fallan cerradas ante cada
   * mutación.
   */
  it("la postcondición de 0012 exige los triggers de guarda y las funciones de equipo SECURITY DEFINER con EXECUTE solo para authenticated", async () => {
    const sql = await readFile(
      new URL("0012_team_settings.sql", MIGRATIONS_DIR),
      "utf8",
    );
    const block = sql.split("--> statement-breakpoint").at(-1)!.trim();
    expect(block).toMatch(/^-- Custom SQL · postcondiciones[\s\S]*DO \$\$/);

    const fresh = await createDatabase();
    await runMigrations(fresh.migrationUrl);
    // Control: sobre el catálogo real, la postcondición pasa.
    await fresh.admin.begin(async (tx) => {
      await tx.unsafe(block);
    });

    const GUARD_TRIGGERS =
      /^DEC-038: memberships and organizations need their enabled BEFORE UPDATE guard triggers/;
    const GUARD_FUNCTION =
      /^DEC-038: private\.enforce_membership_change\(\) must be SECURITY DEFINER owned by postgres/;
    const TEAM_FUNCTIONS =
      /^DEC-038: private\.user_admin_org_ids\(\), find_member_candidate\(\) and organization_members\(\) must be SECURITY DEFINER/;
    const broken: [string, RegExp][] = [
      [
        "ALTER TABLE public.memberships DISABLE TRIGGER memberships_change_guard",
        GUARD_TRIGGERS,
      ],
      [
        "DROP TRIGGER organizations_update_guard ON public.organizations",
        GUARD_TRIGGERS,
      ],
      [
        "ALTER FUNCTION private.enforce_membership_change() SECURITY INVOKER",
        GUARD_FUNCTION,
      ],
      [
        "GRANT EXECUTE ON FUNCTION private.enforce_membership_change() TO authenticated",
        GUARD_FUNCTION,
      ],
      [
        "GRANT EXECUTE ON FUNCTION private.find_member_candidate(uuid, text) TO anon",
        TEAM_FUNCTIONS,
      ],
      [
        "GRANT EXECUTE ON FUNCTION private.organization_members(uuid) TO PUBLIC",
        TEAM_FUNCTIONS,
      ],
      [
        "GRANT EXECUTE ON FUNCTION private.user_admin_org_ids() TO app_runtime",
        TEAM_FUNCTIONS,
      ],
      [
        "ALTER FUNCTION private.user_admin_org_ids() SECURITY INVOKER",
        TEAM_FUNCTIONS,
      ],
      [
        "ALTER FUNCTION private.organization_members(uuid) RESET search_path",
        TEAM_FUNCTIONS,
      ],
      [
        "REVOKE EXECUTE ON FUNCTION private.find_member_candidate(uuid, text) FROM authenticated",
        TEAM_FUNCTIONS,
      ],
      [
        "GRANT UPDATE (user_id) ON public.memberships TO authenticated",
        UPDATE_0012,
      ],
      [
        "GRANT UPDATE (id) ON public.organizations TO authenticated",
        UPDATE_0012,
      ],
      [
        "GRANT DELETE ON public.memberships TO authenticated",
        /must be covered by a policy|must not delete or truncate/,
      ],
      [
        "ALTER TABLE public.organizations DISABLE ROW LEVEL SECURITY",
        /RLS enabled/,
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
      const hito5 = await hito5Base();
      await runMigrations(hito5.migrationUrl);
      const rows = await teamSnapshot(hito5.admin);
      const catalog = await catalogSnapshot(hito5.admin);

      await runMigrations(hito5.migrationUrl);

      expect(await history(hito5.admin)).toBe(15);
      expect(await teamSnapshot(hito5.admin)).toEqual(rows);
      expect(await catalogSnapshot(hito5.admin)).toEqual(catalog);
    });

    it("volver a ejecutar su SQL fuera del historial falla entero y no deja nada a medias", async () => {
      const sql = await readFile(
        new URL("0012_team_settings.sql", MIGRATIONS_DIR),
        "utf8",
      );
      const statements = sql.split("--> statement-breakpoint");
      const fresh = await createDatabase();
      await runMigrations(fresh.migrationUrl);
      const owner = postgres(fresh.migrationUrl, {
        max: 1,
        onnotice: () => {},
      });
      try {
        // private.user_admin_org_ids() ya existe: 42723 en el primer statement.
        await expect(
          owner.begin(async (tx) => {
            for (const statement of statements) await tx.unsafe(statement);
          }),
        ).rejects.toMatchObject({ code: "42723" });
      } finally {
        await owner.end();
      }
      expect(await catalogSnapshot(fresh.admin)).toEqual(afterMigration);
      expect(await history(fresh.admin)).toBe(15);
    });

    it("se revierte sola al catálogo del Hito 5 y se vuelve a aplicar idéntica", async () => {
      const reference = await createDatabase();
      await migrateUpTo(reference.migrationUrl, HITO_5);
      const hito5Catalog = await catalogSnapshot(reference.admin);

      const fresh = await createDatabase();
      await runMigrations(fresh.migrationUrl);
      const owner = postgres(fresh.migrationUrl, {
        max: 1,
        onnotice: () => {},
      });
      try {
        // La reversión corre con la credencial de migración, dueña de todo.
        await owner.begin(async (tx) => {
          // 0014 y 0013 se revierten antes: son posteriores a 0012
          // (DEC-039, DEC-040).
          await tx.unsafe(REVERT_0014);
          await tx.unsafe(REVERT_0013);
          await tx.unsafe(REVERT_0012);
          await tx.unsafe(`
            DELETE FROM drizzle.__drizzle_migrations
            WHERE created_at >= (
              SELECT created_at FROM drizzle.__drizzle_migrations
              ORDER BY created_at DESC OFFSET 2 LIMIT 1
            )
          `);
        });
      } finally {
        await owner.end();
      }
      expect(await catalogSnapshot(fresh.admin)).toEqual(hito5Catalog);
      expect(await history(fresh.admin)).toBe(12);

      await runMigrations(fresh.migrationUrl);
      expect(await history(fresh.admin)).toBe(15);
      expect(await catalogSnapshot(fresh.admin)).toEqual(afterMigration);
    });
  });
});

/*
 * Una base en el Hito 6 (0000 a 0012, DEC-038; staging hoy) recibe 0013
 * (DEC-039): las líneas de WhatsApp, las conversaciones, las columnas de la
 * ingesta en messages y la función de ingesta, sin roles nuevos y sin tocar
 * ninguna fila: los mensajes que registraron los miembros cumplen el CHECK
 * de origen tal como están.
 */
describe("0013 sobre una base en el Hito 6", () => {
  const HITO_6 = "0012_team_settings";
  const INGEST_FUNCTION =
    "private.ingest_whatsapp_message(text, text, text, text, text, text, text, timestamp with time zone)";

  // Como en el bloque de 0012: cada caso borra sus bases (max_connections).
  const created: TestDatabase[] = [];
  async function createDatabase(): Promise<TestDatabase> {
    const database = await server.createDatabase();
    created.push(database);
    return database;
  }
  afterEach(async () => {
    for (const database of created.splice(0)) {
      await server.dropDatabase(database);
    }
  });

  async function history(sql: TestDatabase["admin"]): Promise<number> {
    const [row] = await sql<{ count: number }[]>`
      SELECT count(*)::int AS count FROM drizzle.__drizzle_migrations
    `;
    return row?.count ?? 0;
  }

  /*
   * Todo lo que puede tener staging, fila por fila. Los mensajes se comparan
   * sin las columnas que agrega 0013, que nacen NULL en toda fila existente.
   */
  async function hito6Snapshot(sql: TestDatabase["admin"]) {
    const [snapshot] = await sql<{ data: unknown }[]>`
      SELECT jsonb_build_object(
        'organizations', (SELECT jsonb_agg(o ORDER BY o.id) FROM public.organizations o),
        'profiles', (SELECT jsonb_agg(p ORDER BY p.id) FROM public.profiles p),
        'memberships', (SELECT jsonb_agg(m ORDER BY m.id) FROM public.memberships m),
        'contacts', (SELECT jsonb_agg(c ORDER BY c.id) FROM public.contacts c),
        'opportunities', (SELECT jsonb_agg(op ORDER BY op.id) FROM public.opportunities op),
        'vehicles', (SELECT jsonb_agg(v ORDER BY v.id) FROM public.vehicles v),
        'notes', (SELECT jsonb_agg(n ORDER BY n.id) FROM public.opportunity_notes n),
        'messages', (SELECT jsonb_agg(to_jsonb(me) - 'conversation_id' - 'external_id' - 'sent_at' ORDER BY me.id) FROM public.messages me)
      ) AS data
    `;
    return snapshot?.data;
  }

  /** Si existen las tablas y la función de 0013. */
  async function hito7Objects(sql: TestDatabase["admin"]) {
    const [row] = await sql<
      { lines: boolean; conversations: boolean; ingest: boolean }[]
    >`
      SELECT
        to_regclass('public.whatsapp_lines') IS NOT NULL AS lines,
        to_regclass('public.conversations') IS NOT NULL AS conversations,
        to_regprocedure(${INGEST_FUNCTION}) IS NOT NULL AS ingest
    `;
    return row;
  }

  /** Una base en el Hito 6 con datos y un mensaje registrado por un miembro. */
  async function hito6Base(): Promise<TestDatabase> {
    const base = await createDatabase();
    await migrateUpTo(base.migrationUrl, HITO_6);
    await seedTenants(base.admin);
    await seedOpportunities(base.admin);
    await seedVehicles(base.admin);
    const [first] = OPPORTUNITIES;
    await base.admin`
      INSERT INTO public.messages (organization_id, contact_id, opportunity_id,
        channel, direction, content, recorded_by)
      VALUES (${first!.organizationId}, ${first!.contact.id}, ${first!.id},
        'whatsapp', 'inbound', 'Mensaje del Hito 4', ${USER_A})
    `;
    return base;
  }

  it("pnpm db:migrate aplica 0013 y 0014, conserva los datos (los mensajes de los miembros cumplen el CHECK de origen) y deja el mismo catálogo", async () => {
    const hito6 = await hito6Base();
    const before = await hito6Snapshot(hito6.admin);
    expect(await history(hito6.admin)).toBe(13);
    expect(await hito7Objects(hito6.admin)).toEqual({
      lines: false,
      conversations: false,
      ingest: false,
    });

    await runMigrations(hito6.migrationUrl);

    expect(await history(hito6.admin)).toBe(15);
    expect(await hito6Snapshot(hito6.admin)).toEqual(before);
    // Las columnas nuevas nacen NULL: el mensaje sigue siendo de su autor.
    const messages = await hito6.admin`
      SELECT recorded_by, conversation_id, external_id, sent_at
      FROM public.messages
    `;
    expect(messages).toEqual([
      {
        recorded_by: USER_A,
        conversation_id: null,
        external_id: null,
        sent_at: null,
      },
    ]);
    const [empty] = await hito6.admin<
      { lines: number; conversations: number }[]
    >`
      SELECT
        (SELECT count(*)::int FROM public.whatsapp_lines) AS lines,
        (SELECT count(*)::int FROM public.conversations) AS conversations
    `;
    expect(empty).toEqual({ lines: 0, conversations: 0 });
    expect(await catalogSnapshot(hito6.admin)).toEqual(afterMigration);
  });

  /*
   * Postcondiciones de 0013: las de 0012 más las de DEC-039. Si la base no
   * las cumple, 0013 falla y no aplica nada.
   */
  const RUNTIME_0013 =
    /app_runtime must be LOGIN NOINHERIT NOBYPASSRLS and only a member of authenticated/;
  const SERVICE_ROLE_0013 =
    /service_role must not update, delete or truncate opportunity_demand_facts, opportunity_notes or messages/;
  const COVERAGE_0013 =
    /every privilege of authenticated on public tables must be covered by a policy/;
  const unsafeStates: [string, string, string, RegExp][] = [
    [
      "app_runtime miembro de service_role (la ingesta no agrega roles)",
      "GRANT service_role TO app_runtime WITH INHERIT FALSE, SET TRUE",
      "REVOKE service_role FROM app_runtime",
      RUNTIME_0013,
    ],
    [
      "service_role con DELETE sobre los mensajes",
      "GRANT DELETE ON public.messages TO service_role",
      "REVOKE DELETE ON public.messages FROM service_role",
      SERVICE_ROLE_0013,
    ],
    [
      "authenticated con UPDATE sobre messages.content (sin policy: append-only)",
      "GRANT UPDATE (content) ON public.messages TO authenticated",
      "REVOKE UPDATE (content) ON public.messages FROM authenticated",
      COVERAGE_0013,
    ],
  ];

  it.each(unsafeStates)(
    "0013 falla cerrada ante %s",
    async (_, unsafe, restore, reason) => {
      const hito6 = await createDatabase();
      await migrateUpTo(hito6.migrationUrl, HITO_6);
      await hito6.admin.unsafe(unsafe);
      try {
        await expect(runMigrations(hito6.migrationUrl)).rejects.toThrow(
          "pnpm db:migrate failed",
        );
        await expect(
          migrateReportingErrors(hito6.migrationUrl),
        ).rejects.toMatchObject({
          cause: { message: expect.stringMatching(reason) },
        });
        // Nada se aplicó: ni las tablas ni la función.
        expect(await history(hito6.admin)).toBe(13);
        expect(await hito7Objects(hito6.admin)).toEqual({
          lines: false,
          conversations: false,
          ingest: false,
        });
      } finally {
        await hito6.admin.unsafe(restore);
      }
      // Corregido el estado, 0013 se aplica.
      await runMigrations(hito6.migrationUrl);
      expect(await catalogSnapshot(hito6.admin)).toEqual(afterMigration);
    },
  );

  /*
   * Las postcondiciones que dependen de lo que crea la misma migración (la
   * función de ingesta, las tablas, el CHECK de origen y las uniques) se
   * corren contra una base ya migrada: pasan sobre el catálogo real y fallan
   * cerradas ante cada mutación.
   */
  it("la postcondición de 0013 exige la función de ingesta SECURITY DEFINER con EXECUTE solo para authenticated y la regla sin claims, las líneas de provisioning, el CHECK de origen, la FK de la conversación y las uniques", async () => {
    const sql = await readFile(
      new URL("0013_whatsapp_ingestion.sql", MIGRATIONS_DIR),
      "utf8",
    );
    const block = sql.split("--> statement-breakpoint").at(-1)!.trim();
    expect(block).toMatch(/^-- Custom SQL · postcondiciones[\s\S]*DO \$\$/);

    // Sobre el catálogo que deja 0013: 0014 abre la lectura de las líneas
    // (DEC-040 §4) y tiene sus propias postcondiciones.
    const fresh = await createDatabase();
    await migrateUpTo(fresh.migrationUrl, "0013_whatsapp_ingestion");
    // Control: sobre el catálogo real, la postcondición pasa.
    await fresh.admin.begin(async (tx) => {
      await tx.unsafe(block);
    });

    const FUNCTION =
      /^DEC-039: private\.ingest_whatsapp_message\(\) must be SECURITY DEFINER owned by postgres, with an empty search_path, EXECUTE only for authenticated and the rule that rejects calls with claims/;
    const LINES = /^DEC-039: whatsapp_lines is provisioning-only/;
    const SOURCE =
      /^DEC-039: messages need the validated source CHECK and conversations the composite contact foreign key/;
    const UNIQUES =
      /^DEC-039: messages need the unique external id index and conversations the unique open conversation index/;
    const FKS =
      /^DEC-039: messages need the composite contact, opportunity and conversation foreign keys/;
    // Una versión de la función sin la regla que rechaza las claims.
    const withoutGuard = sql
      .slice(
        sql.indexOf('CREATE FUNCTION "private"."ingest_whatsapp_message"'),
        sql.indexOf("$$;", sql.indexOf("AS $$")) + 3,
      )
      .replace("CREATE FUNCTION", "CREATE OR REPLACE FUNCTION")
      .replace(/ingestion_without_user/g, "no guard");
    const broken: [string, RegExp][] = [
      [`ALTER FUNCTION ${INGEST_FUNCTION} SECURITY INVOKER`, FUNCTION],
      [`ALTER FUNCTION ${INGEST_FUNCTION} RESET search_path`, FUNCTION],
      [`GRANT EXECUTE ON FUNCTION ${INGEST_FUNCTION} TO anon`, FUNCTION],
      [`GRANT EXECUTE ON FUNCTION ${INGEST_FUNCTION} TO PUBLIC`, FUNCTION],
      [`GRANT EXECUTE ON FUNCTION ${INGEST_FUNCTION} TO app_runtime`, FUNCTION],
      [
        `REVOKE EXECUTE ON FUNCTION ${INGEST_FUNCTION} FROM authenticated`,
        FUNCTION,
      ],
      [withoutGuard, FUNCTION],
      [
        "CREATE POLICY probe ON public.whatsapp_lines FOR SELECT TO authenticated USING (true)",
        LINES,
      ],
      [
        "GRANT SELECT ON public.whatsapp_lines TO authenticated",
        /must be covered by a policy/,
      ],
      [
        "GRANT INSERT ON public.conversations TO authenticated",
        /must be covered by a policy/,
      ],
      [
        "ALTER TABLE public.messages DROP CONSTRAINT messages_source_check",
        SOURCE,
      ],
      [
        "ALTER TABLE public.conversations DROP CONSTRAINT conversations_contact_fk",
        SOURCE,
      ],
      [
        "ALTER TABLE public.messages DROP CONSTRAINT messages_conversation_fk",
        FKS,
      ],
      ["DROP INDEX public.messages_organization_id_external_id_key", UNIQUES],
      ["DROP INDEX public.conversations_open_contact_channel_key", UNIQUES],
      ["GRANT anon TO app_runtime WITH INHERIT FALSE, SET TRUE", RUNTIME_0013],
      ["ALTER ROLE app_runtime BYPASSRLS", RUNTIME_0013],
      // Con herencia, app_runtime tendría los privilegios de authenticated:
      // falla antes, en la regla de privilegios directos.
      [
        "GRANT authenticated TO app_runtime WITH INHERIT TRUE",
        /anon and app_runtime must not have privileges on public tables/,
      ],
      [
        "ALTER TABLE public.conversations DISABLE ROW LEVEL SECURITY",
        /RLS enabled/,
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
      const hito6 = await hito6Base();
      await runMigrations(hito6.migrationUrl);
      const rows = await hito6Snapshot(hito6.admin);
      const catalog = await catalogSnapshot(hito6.admin);

      await runMigrations(hito6.migrationUrl);

      expect(await history(hito6.admin)).toBe(15);
      expect(await hito6Snapshot(hito6.admin)).toEqual(rows);
      expect(await catalogSnapshot(hito6.admin)).toEqual(catalog);
    });

    it("volver a ejecutar su SQL fuera del historial falla entero y no deja nada a medias", async () => {
      const sql = await readFile(
        new URL("0013_whatsapp_ingestion.sql", MIGRATIONS_DIR),
        "utf8",
      );
      const statements = sql.split("--> statement-breakpoint");
      const fresh = await createDatabase();
      await runMigrations(fresh.migrationUrl);
      const owner = postgres(fresh.migrationUrl, {
        max: 1,
        onnotice: () => {},
      });
      try {
        // whatsapp_lines ya existe: 42P07 en el primer statement.
        await expect(
          owner.begin(async (tx) => {
            for (const statement of statements) await tx.unsafe(statement);
          }),
        ).rejects.toMatchObject({ code: "42P07" });
      } finally {
        await owner.end();
      }
      expect(await catalogSnapshot(fresh.admin)).toEqual(afterMigration);
      expect(await history(fresh.admin)).toBe(15);
    });

    it("se revierte sola al catálogo del Hito 6 y se vuelve a aplicar idéntica", async () => {
      const reference = await createDatabase();
      await migrateUpTo(reference.migrationUrl, HITO_6);
      const hito6Catalog = await catalogSnapshot(reference.admin);

      const fresh = await createDatabase();
      await runMigrations(fresh.migrationUrl);
      const owner = postgres(fresh.migrationUrl, {
        max: 1,
        onnotice: () => {},
      });
      try {
        // La reversión corre con la credencial de migración, dueña de todo.
        await owner.begin(async (tx) => {
          // 0014 se revierte antes: es posterior a 0013 (DEC-040).
          await tx.unsafe(REVERT_0014);
          await tx.unsafe(REVERT_0013);
          await tx.unsafe(`
            DELETE FROM drizzle.__drizzle_migrations
            WHERE created_at >= (
              SELECT created_at FROM drizzle.__drizzle_migrations
              ORDER BY created_at DESC OFFSET 1 LIMIT 1
            )
          `);
        });
      } finally {
        await owner.end();
      }
      expect(await catalogSnapshot(fresh.admin)).toEqual(hito6Catalog);
      expect(await history(fresh.admin)).toBe(13);

      await runMigrations(fresh.migrationUrl);
      expect(await history(fresh.admin)).toBe(15);
      expect(await catalogSnapshot(fresh.admin)).toEqual(afterMigration);
    });
  });
});

/*
 * Una base en el Hito 7 (0000 a 0013, DEC-039) recibe 0014 (DEC-040): el
 * CHECK de origen con el envío de un miembro, la policy de alta de los
 * miembros sin conversación, la lectura de las líneas y la función de envío,
 * sin roles nuevos y sin tocar ninguna fila: los mensajes registrados y los
 * ingeridos cumplen el CHECK nuevo tal como están.
 */
describe("0014 sobre una base en el Hito 7", () => {
  const HITO_7 = "0013_whatsapp_ingestion";
  const OUTBOUND_FUNCTION =
    "private.record_outbound_whatsapp_message(uuid, uuid, text, text, text)";
  const LINE = "100000000000099";

  // Como en los bloques anteriores: cada caso borra sus bases.
  const created: TestDatabase[] = [];
  async function createDatabase(): Promise<TestDatabase> {
    const database = await server.createDatabase();
    created.push(database);
    return database;
  }
  afterEach(async () => {
    for (const database of created.splice(0)) {
      await server.dropDatabase(database);
    }
  });

  async function history(sql: TestDatabase["admin"]): Promise<number> {
    const [row] = await sql<{ count: number }[]>`
      SELECT count(*)::int AS count FROM drizzle.__drizzle_migrations
    `;
    return row?.count ?? 0;
  }

  /** Todo lo que puede tener staging, fila por fila. */
  async function hito7Snapshot(sql: TestDatabase["admin"]) {
    const [snapshot] = await sql<{ data: unknown }[]>`
      SELECT jsonb_build_object(
        'organizations', (SELECT jsonb_agg(o ORDER BY o.id) FROM public.organizations o),
        'profiles', (SELECT jsonb_agg(p ORDER BY p.id) FROM public.profiles p),
        'memberships', (SELECT jsonb_agg(m ORDER BY m.id) FROM public.memberships m),
        'contacts', (SELECT jsonb_agg(c ORDER BY c.id) FROM public.contacts c),
        'opportunities', (SELECT jsonb_agg(op ORDER BY op.id) FROM public.opportunities op),
        'vehicles', (SELECT jsonb_agg(v ORDER BY v.id) FROM public.vehicles v),
        'notes', (SELECT jsonb_agg(n ORDER BY n.id) FROM public.opportunity_notes n),
        'messages', (SELECT jsonb_agg(me ORDER BY me.id) FROM public.messages me),
        'conversations', (SELECT jsonb_agg(cv ORDER BY cv.id) FROM public.conversations cv),
        'lines', (SELECT jsonb_agg(l ORDER BY l.id) FROM public.whatsapp_lines l)
      ) AS data
    `;
    return snapshot?.data;
  }

  /** Si existen la función de envío y la policy de lectura de las líneas. */
  async function hito8Objects(sql: TestDatabase["admin"]) {
    const [row] = await sql<{ send: boolean; linesPolicy: boolean }[]>`
      SELECT
        to_regprocedure(${OUTBOUND_FUNCTION}) IS NOT NULL AS send,
        EXISTS (
          SELECT FROM pg_policies
          WHERE schemaname = 'public' AND tablename = 'whatsapp_lines'
        ) AS "linesPolicy"
    `;
    return row;
  }

  /**
   * Una base en el Hito 7 con datos: un mensaje registrado por un miembro y
   * uno ingerido por la función de ingesta (sin claims, como el webhook).
   */
  async function hito7Base(): Promise<TestDatabase> {
    const base = await createDatabase();
    await migrateUpTo(base.migrationUrl, HITO_7);
    await seedTenants(base.admin);
    await seedOpportunities(base.admin);
    await seedVehicles(base.admin);
    const [first] = OPPORTUNITIES;
    await base.admin`
      INSERT INTO public.messages (organization_id, contact_id, opportunity_id,
        channel, direction, content, recorded_by)
      VALUES (${first!.organizationId}, ${first!.contact.id}, ${first!.id},
        'whatsapp', 'inbound', 'Mensaje del Hito 4', ${USER_A})
    `;
    await base.admin`
      INSERT INTO public.whatsapp_lines (organization_id, phone_number_id)
      VALUES (${ORG_1}, ${LINE})
    `;
    await base.admin`
      SELECT * FROM private.ingest_whatsapp_message(${LINE}, 'wamid.HITO7',
        '+595981777001', '+595981777001', 'Cliente del Hito 7', 'Hola',
        'Hola', '2026-10-21T12:00:00Z')
    `;
    return base;
  }

  it("pnpm db:migrate aplica solo 0014, conserva los datos (los mensajes registrados e ingeridos cumplen el CHECK nuevo) y deja el mismo catálogo", async () => {
    const hito7 = await hito7Base();
    const before = await hito7Snapshot(hito7.admin);
    expect(await history(hito7.admin)).toBe(14);
    expect(await hito8Objects(hito7.admin)).toEqual({
      send: false,
      linesPolicy: false,
    });

    await runMigrations(hito7.migrationUrl);

    expect(await history(hito7.admin)).toBe(15);
    expect(await hito7Snapshot(hito7.admin)).toEqual(before);
    expect(await hito8Objects(hito7.admin)).toEqual({
      send: true,
      linesPolicy: true,
    });
    const messages = await hito7.admin`
      SELECT direction, recorded_by IS NOT NULL AS "byMember",
        conversation_id IS NOT NULL AS "inConversation"
      FROM public.messages ORDER BY created_at, id
    `;
    expect(messages).toEqual([
      { direction: "inbound", byMember: true, inConversation: false },
      { direction: "inbound", byMember: false, inConversation: true },
    ]);
    expect(await catalogSnapshot(hito7.admin)).toEqual(afterMigration);
  });

  /*
   * Postcondiciones de 0014: las de 0013 más las de DEC-040. Si la base no
   * las cumple, 0014 falla y no aplica nada.
   */
  const RUNTIME_0014 =
    /app_runtime must be LOGIN NOINHERIT NOBYPASSRLS and only a member of authenticated/;
  const COVERAGE_0014 =
    /every privilege of authenticated on public tables must be covered by a policy/;
  const unsafeStates: [string, string, string, RegExp][] = [
    [
      "app_runtime miembro de service_role (el envío no agrega roles)",
      "GRANT service_role TO app_runtime WITH INHERIT FALSE, SET TRUE",
      "REVOKE service_role FROM app_runtime",
      RUNTIME_0014,
    ],
    [
      "authenticated con INSERT sobre las líneas (sin policy: provisioning)",
      "GRANT INSERT ON public.whatsapp_lines TO authenticated",
      "REVOKE INSERT ON public.whatsapp_lines FROM authenticated",
      COVERAGE_0014,
    ],
  ];

  it.each(unsafeStates)(
    "0014 falla cerrada ante %s",
    async (_, unsafe, restore, reason) => {
      const hito7 = await createDatabase();
      await migrateUpTo(hito7.migrationUrl, HITO_7);
      await hito7.admin.unsafe(unsafe);
      try {
        await expect(runMigrations(hito7.migrationUrl)).rejects.toThrow(
          "pnpm db:migrate failed",
        );
        await expect(
          migrateReportingErrors(hito7.migrationUrl),
        ).rejects.toMatchObject({
          cause: { message: expect.stringMatching(reason) },
        });
        // Nada se aplicó: ni la función ni la policy de las líneas.
        expect(await history(hito7.admin)).toBe(14);
        expect(await hito8Objects(hito7.admin)).toEqual({
          send: false,
          linesPolicy: false,
        });
      } finally {
        await hito7.admin.unsafe(restore);
      }
      // Corregido el estado, 0014 se aplica.
      await runMigrations(hito7.migrationUrl);
      expect(await catalogSnapshot(hito7.admin)).toEqual(afterMigration);
    },
  );

  /*
   * Las postcondiciones que dependen de lo que crea la misma migración (la
   * función de envío, la policy de las líneas y la de alta de mensajes) se
   * corren contra una base ya migrada: pasan sobre el catálogo real y fallan
   * cerradas ante cada mutación.
   */
  it("la postcondición de 0014 exige la función de envío SECURITY DEFINER con EXECUTE solo para authenticated y sus reglas, las líneas de solo lectura para los miembros y el alta de mensajes sin conversación", async () => {
    const sql = await readFile(
      new URL("0014_whatsapp_outbound.sql", MIGRATIONS_DIR),
      "utf8",
    );
    const block = sql.split("--> statement-breakpoint").at(-1)!.trim();
    expect(block).toMatch(/^-- Custom SQL · postcondiciones[\s\S]*DO \$\$/);

    const fresh = await createDatabase();
    await runMigrations(fresh.migrationUrl);
    // Control: sobre el catálogo real, la postcondición pasa.
    await fresh.admin.begin(async (tx) => {
      await tx.unsafe(block);
    });

    const FUNCTION =
      /^DEC-040: private\.record_outbound_whatsapp_message\(\) must be SECURITY DEFINER owned by postgres, with an empty search_path, EXECUTE only for authenticated and the rules that require an active member/;
    const LINES = /^DEC-040: whatsapp_lines is read-only for members/;
    const INSERT_POLICY =
      /^DEC-040: the member insert policy on messages must require conversation_id IS NULL/;
    const SOURCE =
      /^DEC-039: messages need the validated source CHECK and conversations the composite contact foreign key/;
    // Versiones de la función sin cada una de sus reglas.
    const definition = sql
      .slice(
        sql.indexOf(
          'CREATE FUNCTION "private"."record_outbound_whatsapp_message"',
        ),
        sql.indexOf("$$;", sql.indexOf("AS $$")) + 3,
      )
      .replace("CREATE FUNCTION", "CREATE OR REPLACE FUNCTION");
    const broken: [string, RegExp][] = [
      [`ALTER FUNCTION ${OUTBOUND_FUNCTION} SECURITY INVOKER`, FUNCTION],
      [`ALTER FUNCTION ${OUTBOUND_FUNCTION} RESET search_path`, FUNCTION],
      [`GRANT EXECUTE ON FUNCTION ${OUTBOUND_FUNCTION} TO anon`, FUNCTION],
      [`GRANT EXECUTE ON FUNCTION ${OUTBOUND_FUNCTION} TO PUBLIC`, FUNCTION],
      [
        `GRANT EXECUTE ON FUNCTION ${OUTBOUND_FUNCTION} TO app_runtime`,
        FUNCTION,
      ],
      [
        `REVOKE EXECUTE ON FUNCTION ${OUTBOUND_FUNCTION} FROM authenticated`,
        FUNCTION,
      ],
      [definition.replace(/outbound_requires_user/g, "no guard"), FUNCTION],
      [definition.replace(/outbound_not_member/g, "no guard"), FUNCTION],
      [
        "CREATE POLICY probe ON public.whatsapp_lines FOR SELECT TO authenticated USING (true)",
        LINES,
      ],
      [
        "DROP POLICY whatsapp_lines_select_member ON public.whatsapp_lines; CREATE POLICY whatsapp_lines_select_member ON public.whatsapp_lines FOR SELECT TO authenticated USING (true)",
        LINES,
      ],
      [
        "GRANT UPDATE (active) ON public.whatsapp_lines TO authenticated",
        /must be covered by a policy/,
      ],
      [
        "CREATE POLICY probe ON public.whatsapp_lines FOR DELETE TO authenticated USING (true); GRANT DELETE ON public.whatsapp_lines TO authenticated",
        /authenticated must not delete or truncate public tables/,
      ],
      [
        "ALTER POLICY messages_insert_member ON public.messages TO authenticated WITH CHECK (organization_id IN (SELECT private.user_org_ids()) AND recorded_by = (SELECT auth.uid()) AND created_at = now())",
        INSERT_POLICY,
      ],
      [
        "ALTER TABLE public.messages DROP CONSTRAINT messages_source_check",
        SOURCE,
      ],
      ["ALTER ROLE app_runtime BYPASSRLS", RUNTIME_0014],
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
      const hito7 = await hito7Base();
      await runMigrations(hito7.migrationUrl);
      const rows = await hito7Snapshot(hito7.admin);
      const catalog = await catalogSnapshot(hito7.admin);

      await runMigrations(hito7.migrationUrl);

      expect(await history(hito7.admin)).toBe(15);
      expect(await hito7Snapshot(hito7.admin)).toEqual(rows);
      expect(await catalogSnapshot(hito7.admin)).toEqual(catalog);
    });

    it("volver a ejecutar su SQL fuera del historial falla entero y no deja nada a medias", async () => {
      const sql = await readFile(
        new URL("0014_whatsapp_outbound.sql", MIGRATIONS_DIR),
        "utf8",
      );
      const statements = sql.split("--> statement-breakpoint");
      const fresh = await createDatabase();
      await runMigrations(fresh.migrationUrl);
      const owner = postgres(fresh.migrationUrl, {
        max: 1,
        onnotice: () => {},
      });
      try {
        // El CHECK se reemplaza sin error, pero la policy de las líneas ya
        // existe: 42710 y la transacción entera se revierte.
        await expect(
          owner.begin(async (tx) => {
            for (const statement of statements) await tx.unsafe(statement);
          }),
        ).rejects.toMatchObject({ code: "42710" });
      } finally {
        await owner.end();
      }
      expect(await catalogSnapshot(fresh.admin)).toEqual(afterMigration);
      expect(await history(fresh.admin)).toBe(15);
    });

    it("se revierte sola al catálogo del Hito 7 y se vuelve a aplicar idéntica", async () => {
      const reference = await createDatabase();
      await migrateUpTo(reference.migrationUrl, HITO_7);
      const hito7Catalog = await catalogSnapshot(reference.admin);

      const fresh = await createDatabase();
      await runMigrations(fresh.migrationUrl);
      const owner = postgres(fresh.migrationUrl, {
        max: 1,
        onnotice: () => {},
      });
      try {
        // La reversión corre con la credencial de migración, dueña de todo.
        await owner.begin(async (tx) => {
          await tx.unsafe(REVERT_0014);
          await tx.unsafe(`
            DELETE FROM drizzle.__drizzle_migrations
            WHERE created_at = (SELECT max(created_at) FROM drizzle.__drizzle_migrations)
          `);
        });
      } finally {
        await owner.end();
      }
      expect(await catalogSnapshot(fresh.admin)).toEqual(hito7Catalog);
      expect(await history(fresh.admin)).toBe(14);

      await runMigrations(fresh.migrationUrl);
      expect(await history(fresh.admin)).toBe(15);
      expect(await catalogSnapshot(fresh.admin)).toEqual(afterMigration);
    });
  });
});
