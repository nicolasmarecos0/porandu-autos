import postgres, { type Sql } from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createPrivileges, policies, tablePrivileges } from "./support/catalog";
import {
  asRole,
  inRolledBackTransaction,
  runMigrations,
  startTestServer,
  type TestDatabase,
  type TestServer,
} from "./support/postgres";

/*
 * Roles, grants, función y policies que dejan 0001_tenant_isolation,
 * 0002_opportunities_persistence, 0003_contact_identity_opportunity_create,
 * 0004_vehicles_stock_persistence, 0005_vehicle_quick_create,
 * 0006_vehicle_availability, 0007_opportunity_demand_facts,
 * 0008_opportunity_stages, 0009_opportunity_notes_vehicle_link,
 * 0010_opportunity_closure_metadata, 0011_conversations_and_activity_trigger,
 * 0012_team_settings, 0013_whatsapp_ingestion, 0014_whatsapp_outbound,
 * 0015_test_drives, 0016_quotes, 0018_conversation_reads,
 * 0019_whatsapp_delivery_status, 0021_trade_ins y 0022_deliveries,
 * leídos del catálogo de
 * PostgreSQL 17 (ADR-001 §2, §3.6 y §4; criterios C2,
 * C3 y C9). El acceso a datos se prueba en tenant-isolation.test.ts,
 * opportunities.test.ts, vehicles.test.ts, demand-facts.test.ts y los tests
 * de cada escritura.
 */

/**
 * Tablas que leen los miembros: todas, también whatsapp_lines desde el Hito 8
 * (DEC-040 §4), conversation_reads (solo las filas propias) desde el Hito
 * 12B (DEC-044 §2.9) y message_statuses desde el Hito 12C (DEC-044 §3.3).
 */
const TABLES = [
  "contacts",
  "conversation_reads",
  "conversations",
  "deliveries",
  "memberships",
  "message_statuses",
  "messages",
  "opportunities",
  "opportunity_demand_facts",
  "opportunity_notes",
  "organizations",
  "profiles",
  "quotes",
  "test_drives",
  "trade_ins",
  "vehicles",
  "whatsapp_lines",
];

let server: TestServer;
let db: TestDatabase;
/** Conexión propia como app_runtime (sesión de runtime sin el boundary). */
let runtime: Sql;
let runtimeHadPassword: boolean | undefined;
let adminRole: string;

beforeAll(async () => {
  server = await startTestServer();
  db = await server.createDatabase();
  await runMigrations(db.migrationUrl);

  // Antes de que el harness le fije una password: la migración no la versiona.
  const [role] = await db.admin<{ hasPassword: boolean }[]>`
    SELECT rolpassword IS NOT NULL AS "hasPassword"
    FROM pg_authid WHERE rolname = 'app_runtime'
  `;
  runtimeHadPassword = role?.hasPassword;

  const [admin] = await db.admin<
    { name: string }[]
  >`SELECT current_user AS name`;
  adminRole = admin?.name ?? "";

  runtime = postgres(await db.runtimeUrl(), { max: 1, onnotice: () => {} });
});

afterAll(async () => {
  await runtime?.end();
  await server?.close();
});

async function expectDenied(run: () => Promise<unknown>): Promise<void> {
  await expect(run()).rejects.toMatchObject({ code: "42501" });
}

describe("rol de runtime app_runtime (ADR-001 §2)", () => {
  it("LOGIN NOINHERIT NOBYPASSRLS, sin superuser ni otros atributos", async () => {
    const [role] = await db.admin`
      SELECT rolcanlogin AS login, rolinherit AS inherit, rolbypassrls AS "bypassRls",
        rolsuper AS super, rolcreaterole AS "createRole", rolcreatedb AS "createDb",
        rolreplication AS replication
      FROM pg_roles WHERE rolname = 'app_runtime'
    `;
    expect(role).toEqual({
      login: true,
      inherit: false,
      bypassRls: false,
      super: false,
      createRole: false,
      createDb: false,
      replication: false,
    });
  });

  it("la migración lo crea sin password", () => {
    expect(runtimeHadPassword).toBe(false);
  });

  it("es miembro solo de authenticated, WITH INHERIT FALSE, SET TRUE (C9)", async () => {
    const grants = await db.admin`
      SELECT roleid::regrole::text AS role, inherit_option AS inherit,
        set_option AS set, admin_option AS admin
      FROM pg_auth_members WHERE member = 'app_runtime'::regrole
    `;
    expect(grants).toEqual([
      { role: "authenticated", inherit: false, set: true, admin: false },
    ]);
  });

  it("no hereda privilegios de ningún rol y solo puede asumir authenticated", async () => {
    const roles = await db.admin<
      { role: string; usage: boolean; member: boolean }[]
    >`
      SELECT rolname AS role,
        pg_has_role('app_runtime', oid, 'USAGE') AS usage,
        pg_has_role('app_runtime', oid, 'MEMBER') AS member
      FROM pg_roles
      WHERE rolname <> 'app_runtime'
        AND (pg_has_role('app_runtime', oid, 'USAGE')
          OR pg_has_role('app_runtime', oid, 'MEMBER'))
    `;
    expect(roles).toEqual([
      { role: "authenticated", usage: false, member: true },
    ]);
  });

  it("no puede asumir postgres, service_role, anon ni roles administrativos (C2)", async () => {
    const forbidden = [
      "postgres",
      "service_role",
      "anon",
      adminRole,
      "pg_read_all_data",
      "pg_write_all_data",
      "pg_execute_server_program",
      "pg_read_server_files",
      "pg_write_server_files",
      "pg_signal_backend",
      "pg_create_subscription",
    ];
    for (const role of forbidden) {
      await expectDenied(
        () => runtime`SELECT set_config('role', ${role}, false)`,
      );
      await expectDenied(() =>
        runtime.begin((tx) => tx`SELECT set_config('role', ${role}, true)`),
      );
      await expectDenied(() =>
        runtime.begin(async (tx) => {
          await tx`SELECT set_config('role', 'authenticated', true)`;
          await tx`SELECT set_config('role', ${role}, true)`;
        }),
      );
    }
    const [session] = await runtime`SELECT current_user AS role`;
    expect(session?.role).toBe("app_runtime");
  });

  it("sin asumir authenticated no tiene privilegios directos", async () => {
    expect(await tablePrivileges(db.admin, ["app_runtime"])).toEqual([]);
    const [privileges] = await db.admin`
      SELECT
        has_schema_privilege('app_runtime', 'private', 'USAGE') AS private,
        has_schema_privilege('app_runtime', 'drizzle', 'USAGE') AS drizzle,
        has_function_privilege('app_runtime', 'private.user_org_ids()', 'EXECUTE') AS "userOrgIds"
    `;
    expect(privileges).toEqual({
      private: false,
      drizzle: false,
      userOrgIds: false,
    });
  });
});

describe("policies (ADR-001 §4)", () => {
  it("lectura para authenticated, alta de contacts, opportunities, vehicles, opportunity_demand_facts, opportunity_notes, messages, memberships (admin, Hito 6), test_drives (Hito 9), quotes (Hito 10), trade_ins (Hito 20) y deliveries (Hito 21) con WITH CHECK, y las ediciones de vehicles, opportunities, organizations, memberships (admin, Hito 6), test_drives (Hito 9), quotes (Hito 10), trade_ins (Hito 20) y deliveries (Hito 21) con USING y WITH CHECK, con la forma de referencia", async () => {
    expect(await policies(db.admin)).toEqual([
      {
        table: "contacts",
        name: "contacts_insert_member",
        permissive: "PERMISSIVE",
        roles: ["authenticated"],
        command: "INSERT",
        using: null,
        withCheck:
          "(organization_id IN ( SELECT private.user_org_ids() AS user_org_ids))",
      },
      {
        table: "contacts",
        name: "contacts_select_member",
        permissive: "PERMISSIVE",
        roles: ["authenticated"],
        command: "SELECT",
        using:
          "(organization_id IN ( SELECT private.user_org_ids() AS user_org_ids))",
        withCheck: null,
      },
      {
        // Hito 12B (DEC-044 §2.9): solo las filas propias.
        table: "conversation_reads",
        name: "conversation_reads_select_own",
        permissive: "PERMISSIVE",
        roles: ["authenticated"],
        command: "SELECT",
        using:
          "((organization_id IN ( SELECT private.user_org_ids() AS user_org_ids)) AND (user_id = ( SELECT auth.uid() AS uid)))",
        withCheck: null,
      },
      {
        table: "conversations",
        name: "conversations_select_member",
        permissive: "PERMISSIVE",
        roles: ["authenticated"],
        command: "SELECT",
        using:
          "(organization_id IN ( SELECT private.user_org_ids() AS user_org_ids))",
        withCheck: null,
      },
      {
        table: "deliveries",
        name: "deliveries_delete_admin",
        permissive: "PERMISSIVE",
        roles: ["authenticated"],
        command: "DELETE",
        using:
          "((organization_id IN ( SELECT private.user_admin_org_ids() AS user_admin_org_ids)) AND (status = 'pending'::text))",
        withCheck: null,
      },
      {
        table: "deliveries",
        name: "deliveries_insert_member",
        permissive: "PERMISSIVE",
        roles: ["authenticated"],
        command: "INSERT",
        using: null,
        withCheck:
          '((organization_id IN ( SELECT private.user_org_ids() AS user_org_ids)) AND (created_by = ( SELECT auth.uid() AS uid)) AND (status = \'pending\'::text) AND (completed_at IS NULL) AND (completed_by IS NULL) AND (checklist = \'{"keys": false, "manuals": false, "cleaning": false, "documents": false, "spare_tire": false}\'::jsonb) AND (created_at = now()) AND (updated_at = now()) AND (EXISTS ( SELECT\n   FROM opportunities\n  WHERE ((opportunities.organization_id = deliveries.organization_id) AND (opportunities.id = deliveries.opportunity_id) AND (opportunities.stage = \'won\'::text) AND (opportunities.vehicle_id = deliveries.vehicle_id)))) AND (EXISTS ( SELECT\n   FROM vehicles\n  WHERE ((vehicles.organization_id = deliveries.organization_id) AND (vehicles.id = deliveries.vehicle_id) AND (vehicles.status = \'sold\'::text)))))',
      },
      {
        table: "deliveries",
        name: "deliveries_select_member",
        permissive: "PERMISSIVE",
        roles: ["authenticated"],
        command: "SELECT",
        using:
          "(organization_id IN ( SELECT private.user_org_ids() AS user_org_ids))",
        withCheck: null,
      },
      {
        table: "deliveries",
        name: "deliveries_update_member",
        permissive: "PERMISSIVE",
        roles: ["authenticated"],
        command: "UPDATE",
        using:
          "(organization_id IN ( SELECT private.user_org_ids() AS user_org_ids))",
        withCheck:
          "(organization_id IN ( SELECT private.user_org_ids() AS user_org_ids))",
      },
      {
        table: "memberships",
        name: "memberships_insert_admin",
        permissive: "PERMISSIVE",
        roles: ["authenticated"],
        command: "INSERT",
        using: null,
        withCheck:
          "((organization_id IN ( SELECT private.user_admin_org_ids() AS user_admin_org_ids)) AND active AND (created_at = now()) AND (updated_at = now()))",
      },
      {
        table: "memberships",
        name: "memberships_select_member",
        permissive: "PERMISSIVE",
        roles: ["authenticated"],
        command: "SELECT",
        using:
          "(organization_id IN ( SELECT private.user_org_ids() AS user_org_ids))",
        withCheck: null,
      },
      {
        table: "memberships",
        name: "memberships_update_admin",
        permissive: "PERMISSIVE",
        roles: ["authenticated"],
        command: "UPDATE",
        using:
          "(organization_id IN ( SELECT private.user_admin_org_ids() AS user_admin_org_ids))",
        withCheck:
          "(organization_id IN ( SELECT private.user_admin_org_ids() AS user_admin_org_ids))",
      },
      {
        // Hito 12C (DEC-044 §3.3): lectura de los miembros.
        table: "message_statuses",
        name: "message_statuses_select_member",
        permissive: "PERMISSIVE",
        roles: ["authenticated"],
        command: "SELECT",
        using:
          "(organization_id IN ( SELECT private.user_org_ids() AS user_org_ids))",
        withCheck: null,
      },
      {
        table: "messages",
        name: "messages_insert_member",
        permissive: "PERMISSIVE",
        roles: ["authenticated"],
        command: "INSERT",
        using: null,
        withCheck:
          "((organization_id IN ( SELECT private.user_org_ids() AS user_org_ids)) AND (recorded_by = ( SELECT auth.uid() AS uid)) AND (created_at = now()) AND (conversation_id IS NULL))",
      },
      {
        table: "messages",
        name: "messages_select_member",
        permissive: "PERMISSIVE",
        roles: ["authenticated"],
        command: "SELECT",
        using:
          "(organization_id IN ( SELECT private.user_org_ids() AS user_org_ids))",
        withCheck: null,
      },
      {
        table: "opportunities",
        name: "opportunities_insert_member",
        permissive: "PERMISSIVE",
        roles: ["authenticated"],
        command: "INSERT",
        using: null,
        withCheck:
          "((organization_id IN ( SELECT private.user_org_ids() AS user_org_ids)) AND (stage = 'new'::text))",
      },
      {
        table: "opportunities",
        name: "opportunities_select_member",
        permissive: "PERMISSIVE",
        roles: ["authenticated"],
        command: "SELECT",
        using:
          "(organization_id IN ( SELECT private.user_org_ids() AS user_org_ids))",
        withCheck: null,
      },
      {
        table: "opportunities",
        name: "opportunities_update_stage",
        permissive: "PERMISSIVE",
        roles: ["authenticated"],
        command: "UPDATE",
        using:
          "(organization_id IN ( SELECT private.user_org_ids() AS user_org_ids))",
        withCheck:
          "(organization_id IN ( SELECT private.user_org_ids() AS user_org_ids))",
      },
      {
        table: "opportunity_demand_facts",
        name: "opportunity_demand_facts_insert_member",
        permissive: "PERMISSIVE",
        roles: ["authenticated"],
        command: "INSERT",
        using: null,
        withCheck:
          "((organization_id IN ( SELECT private.user_org_ids() AS user_org_ids)) AND (source_kind = 'member'::text) AND (status = ANY (ARRAY['confirmed'::text, 'corrected'::text, 'rejected'::text])) AND (recorded_by = ( SELECT auth.uid() AS uid)) AND (recorded_at = now()))",
      },
      {
        table: "opportunity_demand_facts",
        name: "opportunity_demand_facts_select_member",
        permissive: "PERMISSIVE",
        roles: ["authenticated"],
        command: "SELECT",
        using:
          "(organization_id IN ( SELECT private.user_org_ids() AS user_org_ids))",
        withCheck: null,
      },
      {
        table: "opportunity_notes",
        name: "opportunity_notes_insert_member",
        permissive: "PERMISSIVE",
        roles: ["authenticated"],
        command: "INSERT",
        using: null,
        withCheck:
          "((organization_id IN ( SELECT private.user_org_ids() AS user_org_ids)) AND (recorded_by = ( SELECT auth.uid() AS uid)) AND (recorded_at = now()))",
      },
      {
        table: "opportunity_notes",
        name: "opportunity_notes_select_member",
        permissive: "PERMISSIVE",
        roles: ["authenticated"],
        command: "SELECT",
        using:
          "(organization_id IN ( SELECT private.user_org_ids() AS user_org_ids))",
        withCheck: null,
      },
      {
        table: "organizations",
        name: "organizations_select_member",
        permissive: "PERMISSIVE",
        roles: ["authenticated"],
        command: "SELECT",
        using: "(id IN ( SELECT private.user_org_ids() AS user_org_ids))",
        withCheck: null,
      },
      {
        table: "organizations",
        name: "organizations_update_admin",
        permissive: "PERMISSIVE",
        roles: ["authenticated"],
        command: "UPDATE",
        using:
          "(id IN ( SELECT private.user_admin_org_ids() AS user_admin_org_ids))",
        withCheck:
          "(id IN ( SELECT private.user_admin_org_ids() AS user_admin_org_ids))",
      },
      {
        table: "profiles",
        name: "profiles_select_own",
        permissive: "PERMISSIVE",
        roles: ["authenticated"],
        command: "SELECT",
        using: "(id = ( SELECT auth.uid() AS uid))",
        withCheck: null,
      },
      {
        table: "quotes",
        name: "quotes_insert_member",
        permissive: "PERMISSIVE",
        roles: ["authenticated"],
        command: "INSERT",
        using: null,
        withCheck:
          "((organization_id IN ( SELECT private.user_org_ids() AS user_org_ids)) AND (created_by = ( SELECT auth.uid() AS uid)) AND (status = 'draft'::text) AND (approved_by IS NULL) AND (approved_at IS NULL) AND (sent_at IS NULL) AND (decided_at IS NULL) AND (created_at = now()) AND (updated_at = now()) AND (EXISTS ( SELECT\n   FROM opportunities\n  WHERE ((opportunities.organization_id = quotes.organization_id) AND (opportunities.id = quotes.opportunity_id) AND (opportunities.stage = ANY (ARRAY['qualifying'::text, 'negotiating'::text]))))) AND (EXISTS ( SELECT\n   FROM vehicles\n  WHERE ((vehicles.organization_id = quotes.organization_id) AND (vehicles.id = quotes.vehicle_id) AND (vehicles.status = ANY (ARRAY['available'::text, 'reserved'::text])) AND (vehicles.price = quotes.list_price) AND (vehicles.currency = quotes.currency)))))",
      },
      {
        table: "quotes",
        name: "quotes_select_member",
        permissive: "PERMISSIVE",
        roles: ["authenticated"],
        command: "SELECT",
        using:
          "(organization_id IN ( SELECT private.user_org_ids() AS user_org_ids))",
        withCheck: null,
      },
      {
        table: "quotes",
        name: "quotes_update_member",
        permissive: "PERMISSIVE",
        roles: ["authenticated"],
        command: "UPDATE",
        using:
          "(organization_id IN ( SELECT private.user_org_ids() AS user_org_ids))",
        withCheck:
          "(organization_id IN ( SELECT private.user_org_ids() AS user_org_ids))",
      },
      {
        table: "test_drives",
        name: "test_drives_insert_member",
        permissive: "PERMISSIVE",
        roles: ["authenticated"],
        command: "INSERT",
        using: null,
        withCheck:
          "((organization_id IN ( SELECT private.user_org_ids() AS user_org_ids)) AND (created_by = ( SELECT auth.uid() AS uid)) AND (status = 'scheduled'::text) AND (created_at = now()) AND (updated_at = now()) AND (scheduled_at >= (now() - '00:05:00'::interval)))",
      },
      {
        table: "test_drives",
        name: "test_drives_select_member",
        permissive: "PERMISSIVE",
        roles: ["authenticated"],
        command: "SELECT",
        using:
          "(organization_id IN ( SELECT private.user_org_ids() AS user_org_ids))",
        withCheck: null,
      },
      {
        table: "test_drives",
        name: "test_drives_update_member",
        permissive: "PERMISSIVE",
        roles: ["authenticated"],
        command: "UPDATE",
        using:
          "(organization_id IN ( SELECT private.user_org_ids() AS user_org_ids))",
        withCheck:
          "(organization_id IN ( SELECT private.user_org_ids() AS user_org_ids))",
      },
      {
        table: "trade_ins",
        name: "trade_ins_insert_member",
        permissive: "PERMISSIVE",
        roles: ["authenticated"],
        command: "INSERT",
        using: null,
        withCheck:
          "((organization_id IN ( SELECT private.user_org_ids() AS user_org_ids)) AND (created_by = ( SELECT auth.uid() AS uid)) AND (status = 'pending'::text) AND (currency IS NULL) AND (estimated_repair_cost IS NULL) AND (offer_price IS NULL) AND (appraised_by IS NULL) AND (appraised_at IS NULL) AND (converted_vehicle_id IS NULL) AND (created_at = now()) AND (updated_at = now()) AND (EXISTS ( SELECT\n   FROM opportunities\n  WHERE ((opportunities.organization_id = trade_ins.organization_id) AND (opportunities.id = trade_ins.opportunity_id) AND (opportunities.stage = ANY (ARRAY['new'::text, 'qualifying'::text, 'negotiating'::text]))))))",
      },
      {
        table: "trade_ins",
        name: "trade_ins_select_member",
        permissive: "PERMISSIVE",
        roles: ["authenticated"],
        command: "SELECT",
        using:
          "(organization_id IN ( SELECT private.user_org_ids() AS user_org_ids))",
        withCheck: null,
      },
      {
        table: "trade_ins",
        name: "trade_ins_update_member",
        permissive: "PERMISSIVE",
        roles: ["authenticated"],
        command: "UPDATE",
        using:
          "(organization_id IN ( SELECT private.user_org_ids() AS user_org_ids))",
        withCheck:
          "(organization_id IN ( SELECT private.user_org_ids() AS user_org_ids))",
      },
      {
        table: "vehicles",
        name: "vehicles_insert_member",
        permissive: "PERMISSIVE",
        roles: ["authenticated"],
        command: "INSERT",
        using: null,
        withCheck:
          "((organization_id IN ( SELECT private.user_org_ids() AS user_org_ids)) AND (status = 'in_preparation'::text))",
      },
      {
        table: "vehicles",
        name: "vehicles_select_member",
        permissive: "PERMISSIVE",
        roles: ["authenticated"],
        command: "SELECT",
        using:
          "(organization_id IN ( SELECT private.user_org_ids() AS user_org_ids))",
        withCheck: null,
      },
      {
        table: "vehicles",
        name: "vehicles_update_status",
        permissive: "PERMISSIVE",
        roles: ["authenticated"],
        command: "UPDATE",
        using:
          "(organization_id IN ( SELECT private.user_org_ids() AS user_org_ids))",
        withCheck:
          "(organization_id IN ( SELECT private.user_org_ids() AS user_org_ids))",
      },
      {
        table: "whatsapp_lines",
        name: "whatsapp_lines_select_member",
        permissive: "PERMISSIVE",
        roles: ["authenticated"],
        command: "SELECT",
        using:
          "(organization_id IN ( SELECT private.user_org_ids() AS user_org_ids))",
        withCheck: null,
      },
    ]);
  });

  it("toda tabla de public tiene RLS habilitado", async () => {
    const rows = await db.admin<{ table: string }[]>`
      SELECT relname AS table FROM pg_class
      WHERE relnamespace = 'public'::regnamespace AND relkind IN ('r', 'p')
        AND NOT relrowsecurity
    `;
    expect(rows).toEqual([]);
  });
});

describe("grants (ADR-001 §3.6)", () => {
  it("authenticated tiene SELECT sobre las tablas de la app, INSERT solo sobre contacts, opportunities, vehicles, opportunity_demand_facts, opportunity_notes, messages, memberships, test_drives, quotes, trade_ins y deliveries, y UPDATE solo sobre opportunities, vehicles, organizations, memberships, test_drives, quotes, trade_ins y deliveries", async () => {
    expect(await tablePrivileges(db.admin, ["authenticated"])).toEqual([
      // El único borrado: anular una entrega pendiente (Hito 22, DEC-054 §4).
      "authenticated DELETE deliveries",
      "authenticated INSERT contacts",
      "authenticated INSERT deliveries",
      "authenticated INSERT memberships",
      "authenticated INSERT messages",
      "authenticated INSERT opportunities",
      "authenticated INSERT opportunity_demand_facts",
      "authenticated INSERT opportunity_notes",
      "authenticated INSERT quotes",
      "authenticated INSERT test_drives",
      "authenticated INSERT trade_ins",
      "authenticated INSERT vehicles",
      ...TABLES.map((table) => `authenticated SELECT ${table}`),
      "authenticated UPDATE deliveries",
      "authenticated UPDATE memberships",
      "authenticated UPDATE opportunities",
      "authenticated UPDATE organizations",
      "authenticated UPDATE quotes",
      "authenticated UPDATE test_drives",
      "authenticated UPDATE trade_ins",
      "authenticated UPDATE vehicles",
    ]);
  });

  it("authenticated solo borra entregas (pendientes, como admin: DEC-054 §4), no vacía ninguna tabla, y solo actualiza opportunities.stage, loss_reason, vehicle_id, updated_at y los metadatos del cierre (H1.6, Hito 2, DEC-034), vehicles.status y updated_at (H1.3C), organizations.name, default_currency y updated_at memberships.role, active y updated_at (Hito 6), test_drives.status y updated_at (Hito 9), quotes.status y updated_at (Hito 10) la tasación, el estado, el ingreso al stock y updated_at de trade_ins (Hito 20) y el checklist, la fecha pactada, el estado y updated_at de deliveries (Hito 21) y el precio publicado de vehicles (Hito 22), por columna, nunca la tabla", async () => {
    const writes = (await tablePrivileges(db.admin, ["authenticated"])).filter(
      (grant) => !/^authenticated (SELECT|INSERT) /.test(grant),
    );
    expect(writes).toEqual([
      "authenticated DELETE deliveries",
      "authenticated UPDATE deliveries",
      "authenticated UPDATE memberships",
      "authenticated UPDATE opportunities",
      "authenticated UPDATE organizations",
      "authenticated UPDATE quotes",
      "authenticated UPDATE test_drives",
      "authenticated UPDATE trade_ins",
      "authenticated UPDATE vehicles",
    ]);

    for (const name of [
      "deliveries",
      "memberships",
      "opportunities",
      "organizations",
      "quotes",
      "test_drives",
      "trade_ins",
      "vehicles",
    ]) {
      const [table] = await db.admin<{ update: boolean }[]>`
        SELECT has_table_privilege('authenticated', ${`public.${name}`}, 'UPDATE') AS update
      `;
      expect(table?.update, name).toBe(false);
    }
    const columns = await db.admin<{ column: string }[]>`
      SELECT c.relname || '.' || a.attname AS column
      FROM pg_class c
      JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped
      WHERE c.relnamespace = 'public'::regnamespace AND c.relkind IN ('r', 'p')
        AND has_column_privilege('authenticated', c.oid, a.attnum, 'UPDATE')
      ORDER BY 1
    `;
    expect(columns.map((row) => row.column)).toEqual([
      "deliveries.checklist",
      "deliveries.scheduled_at",
      "deliveries.status",
      "deliveries.updated_at",
      "memberships.active",
      "memberships.role",
      "memberships.updated_at",
      "opportunities.delivery_date",
      "opportunities.delivery_status",
      "opportunities.loss_notes",
      "opportunities.loss_reason",
      "opportunities.payment_method",
      "opportunities.sale_currency",
      "opportunities.sale_price",
      "opportunities.stage",
      "opportunities.updated_at",
      "opportunities.vehicle_id",
      "organizations.default_currency",
      "organizations.name",
      "organizations.updated_at",
      "quotes.status",
      "quotes.updated_at",
      "test_drives.status",
      "test_drives.updated_at",
      "trade_ins.converted_vehicle_id",
      "trade_ins.currency",
      "trade_ins.estimated_repair_cost",
      "trade_ins.offer_price",
      "trade_ins.status",
      "trade_ins.updated_at",
      "vehicles.currency",
      "vehicles.price",
      "vehicles.status",
      "vehicles.updated_at",
    ]);
  });

  it("toda policy de escritura tiene WITH CHECK, y la de UPDATE también USING", async () => {
    const writePolicies = (await policies(db.admin)).filter((policy) =>
      ["INSERT", "UPDATE", "ALL"].includes(policy.command),
    );
    expect(writePolicies.map((policy) => policy.name)).toEqual([
      "contacts_insert_member",
      "deliveries_insert_member",
      "deliveries_update_member",
      "memberships_insert_admin",
      "memberships_update_admin",
      "messages_insert_member",
      "opportunities_insert_member",
      "opportunities_update_stage",
      "opportunity_demand_facts_insert_member",
      "opportunity_notes_insert_member",
      "organizations_update_admin",
      "quotes_insert_member",
      "quotes_update_member",
      "test_drives_insert_member",
      "test_drives_update_member",
      "trade_ins_insert_member",
      "trade_ins_update_member",
      "vehicles_insert_member",
      "vehicles_update_status",
    ]);
    expect(writePolicies.every((policy) => policy.withCheck !== null)).toBe(
      true,
    );
    expect(
      writePolicies
        .filter((policy) => policy.command !== "INSERT")
        .every((policy) => policy.using !== null),
    ).toBe(true);
  });

  it("vehicles (H1.3C, Hito 19): SELECT, INSERT y UPDATE por columna para authenticated; policies de lectura, alta y la única de UPDATE del ciclo de vida; sin DELETE", async () => {
    expect(
      (
        await tablePrivileges(db.admin, [
          "anon",
          "authenticated",
          "app_runtime",
        ])
      ).filter((grant) => grant.endsWith(" vehicles")),
    ).toEqual([
      "authenticated INSERT vehicles",
      "authenticated SELECT vehicles",
      "authenticated UPDATE vehicles",
    ]);
    expect(
      (await policies(db.admin))
        .filter((policy) => policy.table === "vehicles")
        .map((policy) => `${policy.name} ${policy.command}`),
    ).toEqual([
      "vehicles_insert_member INSERT",
      "vehicles_select_member SELECT",
      "vehicles_update_status UPDATE",
    ]);
  });

  it("vehicles (Hito 19, DEC-051 §3): el par estado anterior → estado nuevo lo valida un trigger BEFORE UPDATE de fila, habilitado, invoker y con search_path vacío", async () => {
    const triggers = await db.admin<
      { name: string; definition: string; enabled: string }[]
    >`
      SELECT t.tgname AS name, pg_get_triggerdef(t.oid) AS definition,
        t.tgenabled::text AS enabled
      FROM pg_trigger t
      WHERE t.tgrelid = 'public.vehicles'::regclass AND NOT t.tgisinternal
    `;
    expect(triggers).toEqual([
      {
        name: "vehicles_status_transition",
        definition:
          "CREATE TRIGGER vehicles_status_transition BEFORE UPDATE ON public.vehicles FOR EACH ROW EXECUTE FUNCTION private.enforce_vehicle_status_transition()",
        enabled: "O",
      },
    ]);
    const functions = await db.admin<
      {
        name: string;
        securityDefiner: boolean;
        config: string[] | null;
        owner: string;
        returns: string;
        authenticatedExecute: boolean;
        anonExecute: boolean;
        runtimeExecute: boolean;
        publicExecute: boolean;
      }[]
    >`
      SELECT p.proname AS name, p.prosecdef AS "securityDefiner",
        p.proconfig AS config, p.proowner::regrole::text AS owner,
        p.prorettype::regtype::text AS returns,
        has_function_privilege('authenticated', p.oid, 'EXECUTE') AS "authenticatedExecute",
        has_function_privilege('anon', p.oid, 'EXECUTE') AS "anonExecute",
        has_function_privilege('app_runtime', p.oid, 'EXECUTE') AS "runtimeExecute",
        EXISTS (
          SELECT FROM aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
          WHERE a.grantee = 0 AND a.privilege_type = 'EXECUTE'
        ) AS "publicExecute"
      FROM pg_proc p
      WHERE p.oid IN (
        to_regprocedure('private.enforce_vehicle_status_transition()'),
        to_regprocedure('private.enforce_won_vehicle_sold()')
      )
      ORDER BY p.proname
    `;
    const invoker = {
      securityDefiner: false,
      config: ['search_path=""'],
      owner: "postgres",
      returns: "trigger",
      authenticatedExecute: false,
      anonExecute: false,
      runtimeExecute: false,
      publicExecute: false,
    };
    expect(functions).toEqual([
      { name: "enforce_vehicle_status_transition", ...invoker },
      { name: "enforce_won_vehicle_sold", ...invoker },
    ]);
  });

  it("test_drives (Hito 9, DEC-041): SELECT, INSERT y UPDATE de status por columna para authenticated; policies de lectura, alta y edición; sin DELETE; trigger de estados BEFORE UPDATE de fila, habilitado, invoker y con search_path vacío", async () => {
    expect(
      (
        await tablePrivileges(db.admin, [
          "anon",
          "authenticated",
          "app_runtime",
        ])
      ).filter((grant) => grant.endsWith(" test_drives")),
    ).toEqual([
      "authenticated INSERT test_drives",
      "authenticated SELECT test_drives",
      "authenticated UPDATE test_drives",
    ]);
    expect(
      (await policies(db.admin))
        .filter((policy) => policy.table === "test_drives")
        .map((policy) => `${policy.name} ${policy.command}`),
    ).toEqual([
      "test_drives_insert_member INSERT",
      "test_drives_select_member SELECT",
      "test_drives_update_member UPDATE",
    ]);
    const [trigger] = await db.admin<
      {
        enabled: string;
        type: number;
        securityDefiner: boolean;
        config: string[] | null;
        authenticatedExecute: boolean;
      }[]
    >`
      SELECT t.tgenabled AS enabled, t.tgtype AS type,
        p.prosecdef AS "securityDefiner", p.proconfig AS config,
        has_function_privilege('authenticated', p.oid, 'EXECUTE') AS "authenticatedExecute"
      FROM pg_trigger t JOIN pg_proc p ON p.oid = t.tgfoid
      WHERE t.tgrelid = 'public.test_drives'::regclass
        AND t.tgname = 'test_drives_status_transition'
    `;
    expect(trigger).toEqual({
      enabled: "O",
      type: 19,
      securityDefiner: false,
      config: ['search_path=""'],
      authenticatedExecute: false,
    });
  });

  it("quotes (Hito 10, DEC-042): SELECT, INSERT y UPDATE de status por columna para authenticated; policies de lectura, alta y edición; sin DELETE; triggers de número (BEFORE INSERT) y de estados (BEFORE UPDATE) de fila, habilitados, invoker y con search_path vacío", async () => {
    expect(
      (
        await tablePrivileges(db.admin, [
          "anon",
          "authenticated",
          "app_runtime",
        ])
      ).filter((grant) => grant.endsWith(" quotes")),
    ).toEqual([
      "authenticated INSERT quotes",
      "authenticated SELECT quotes",
      "authenticated UPDATE quotes",
    ]);
    expect(
      (await policies(db.admin))
        .filter((policy) => policy.table === "quotes")
        .map((policy) => `${policy.name} ${policy.command}`),
    ).toEqual([
      "quotes_insert_member INSERT",
      "quotes_select_member SELECT",
      "quotes_update_member UPDATE",
    ]);
    const triggers = await db.admin<
      {
        name: string;
        enabled: string;
        type: number;
        securityDefiner: boolean;
        config: string[] | null;
        authenticatedExecute: boolean;
      }[]
    >`
      SELECT t.tgname AS name, t.tgenabled AS enabled, t.tgtype AS type,
        p.prosecdef AS "securityDefiner", p.proconfig AS config,
        has_function_privilege('authenticated', p.oid, 'EXECUTE') AS "authenticatedExecute"
      FROM pg_trigger t JOIN pg_proc p ON p.oid = t.tgfoid
      WHERE t.tgrelid = 'public.quotes'::regclass AND NOT t.tgisinternal
      ORDER BY t.tgname
    `;
    const invoker = {
      enabled: "O",
      securityDefiner: false,
      config: ['search_path=""'],
      authenticatedExecute: false,
    };
    expect(triggers).toEqual([
      { name: "quotes_assign_number", type: 7, ...invoker },
      { name: "quotes_status_transition", type: 19, ...invoker },
    ]);
  });

  it("trade_ins (Hito 20, DEC-052): SELECT, INSERT y UPDATE de la tasación, el estado y el ingreso por columna para authenticated; policies de lectura, alta y edición; sin DELETE; trigger de cambios BEFORE UPDATE de fila y constraint trigger diferido de opportunities, habilitados, invoker y con search_path vacío", async () => {
    expect(
      (
        await tablePrivileges(db.admin, [
          "anon",
          "authenticated",
          "app_runtime",
        ])
      ).filter((grant) => grant.endsWith(" trade_ins")),
    ).toEqual([
      "authenticated INSERT trade_ins",
      "authenticated SELECT trade_ins",
      "authenticated UPDATE trade_ins",
    ]);
    expect(
      (await policies(db.admin))
        .filter((policy) => policy.table === "trade_ins")
        .map((policy) => `${policy.name} ${policy.command}`),
    ).toEqual([
      "trade_ins_insert_member INSERT",
      "trade_ins_select_member SELECT",
      "trade_ins_update_member UPDATE",
    ]);
    const triggers = await db.admin<
      {
        table: string;
        name: string;
        enabled: string;
        type: number;
        deferred: boolean;
        securityDefiner: boolean;
        config: string[] | null;
        authenticatedExecute: boolean;
        publicExecute: boolean;
      }[]
    >`
      SELECT t.tgrelid::regclass::text AS table, t.tgname AS name,
        t.tgenabled AS enabled, t.tgtype AS type,
        (t.tgdeferrable AND t.tginitdeferred) AS deferred,
        p.prosecdef AS "securityDefiner", p.proconfig AS config,
        has_function_privilege('authenticated', p.oid, 'EXECUTE') AS "authenticatedExecute",
        EXISTS (
          SELECT FROM aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
          WHERE a.grantee = 0 AND a.privilege_type = 'EXECUTE'
        ) AS "publicExecute"
      FROM pg_trigger t JOIN pg_proc p ON p.oid = t.tgfoid
      WHERE p.oid IN (
          to_regprocedure('private.enforce_trade_in_change()'),
          to_regprocedure('private.enforce_won_trade_in_stocked()')
        )
        AND NOT t.tgisinternal
      ORDER BY t.tgname
    `;
    const invoker = {
      enabled: "O",
      securityDefiner: false,
      config: ['search_path=""'],
      authenticatedExecute: false,
      publicExecute: false,
    };
    expect(triggers).toEqual([
      {
        table: "opportunities",
        name: "opportunities_won_trade_in_stocked",
        type: 17,
        deferred: true,
        ...invoker,
      },
      {
        table: "trade_ins",
        name: "trade_ins_change_guard",
        type: 19,
        deferred: false,
        ...invoker,
      },
    ]);
  });

  it("deliveries (Hito 21, DEC-053; Hito 22, DEC-054): SELECT, INSERT y UPDATE del checklist, la fecha pactada y el estado por columna para authenticated; policies de lectura, alta, edición y la de anular del admin; DELETE solo por esa policy; trigger de cambios BEFORE UPDATE de fila y constraint trigger diferido de la salida, habilitados, invoker y con search_path vacío", async () => {
    expect(
      (
        await tablePrivileges(db.admin, [
          "anon",
          "authenticated",
          "app_runtime",
        ])
      ).filter((grant) => grant.endsWith(" deliveries")),
    ).toEqual([
      "authenticated DELETE deliveries",
      "authenticated INSERT deliveries",
      "authenticated SELECT deliveries",
      "authenticated UPDATE deliveries",
    ]);
    expect(
      (await policies(db.admin))
        .filter((policy) => policy.table === "deliveries")
        .map((policy) => `${policy.name} ${policy.command}`),
    ).toEqual([
      "deliveries_delete_admin DELETE",
      "deliveries_insert_member INSERT",
      "deliveries_select_member SELECT",
      "deliveries_update_member UPDATE",
    ]);
    const triggers = await db.admin<
      {
        table: string;
        name: string;
        enabled: string;
        type: number;
        deferred: boolean;
        securityDefiner: boolean;
        config: string[] | null;
        authenticatedExecute: boolean;
        publicExecute: boolean;
      }[]
    >`
      SELECT t.tgrelid::regclass::text AS table, t.tgname AS name,
        t.tgenabled AS enabled, t.tgtype AS type,
        (t.tgdeferrable AND t.tginitdeferred) AS deferred,
        p.prosecdef AS "securityDefiner", p.proconfig AS config,
        has_function_privilege('authenticated', p.oid, 'EXECUTE') AS "authenticatedExecute",
        EXISTS (
          SELECT FROM aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
          WHERE a.grantee = 0 AND a.privilege_type = 'EXECUTE'
        ) AS "publicExecute"
      FROM pg_trigger t JOIN pg_proc p ON p.oid = t.tgfoid
      WHERE p.oid IN (
          to_regprocedure('private.enforce_delivery_change()'),
          to_regprocedure('private.enforce_completed_delivery_vehicle_delivered()'),
          to_regprocedure('private.enforce_delivery_delete()')
        )
        AND NOT t.tgisinternal
      ORDER BY t.tgname
    `;
    const invoker = {
      enabled: "O",
      securityDefiner: false,
      config: ['search_path=""'],
      authenticatedExecute: false,
      publicExecute: false,
    };
    expect(triggers).toEqual([
      {
        table: "deliveries",
        name: "deliveries_change_guard",
        type: 19,
        deferred: false,
        ...invoker,
      },
      {
        table: "deliveries",
        name: "deliveries_completed_vehicle_delivered",
        type: 17,
        deferred: true,
        ...invoker,
      },
      // Hito 22 (DEC-054 §4): BEFORE DELETE de fila, conserva las completadas.
      {
        table: "deliveries",
        name: "deliveries_delete_guard",
        type: 11,
        deferred: false,
        ...invoker,
      },
    ]);
  });

  it("opportunities (H1.6): SELECT, INSERT y UPDATE por columna para authenticated; policies de lectura, alta y cambio de etapa; sin DELETE", async () => {
    expect(
      (
        await tablePrivileges(db.admin, [
          "anon",
          "authenticated",
          "app_runtime",
        ])
      ).filter((grant) => grant.endsWith(" opportunities")),
    ).toEqual([
      "authenticated INSERT opportunities",
      "authenticated SELECT opportunities",
      "authenticated UPDATE opportunities",
    ]);
    expect(
      (await policies(db.admin))
        .filter((policy) => policy.table === "opportunities")
        .map((policy) => `${policy.name} ${policy.command}`),
    ).toEqual([
      "opportunities_insert_member INSERT",
      "opportunities_select_member SELECT",
      "opportunities_update_stage UPDATE",
    ]);
  });

  it("opportunities (H1.6, DEC-032 §4): el par etapa anterior → etapa nueva lo valida un trigger BEFORE UPDATE de fila, habilitado, invoker y con search_path vacío", async () => {
    const triggers = await db.admin<
      { name: string; definition: string; enabled: string }[]
    >`
      SELECT t.tgname AS name, pg_get_triggerdef(t.oid) AS definition,
        t.tgenabled::text AS enabled
      FROM pg_trigger t
      WHERE t.tgrelid = 'public.opportunities'::regclass AND NOT t.tgisinternal
      ORDER BY t.tgname
    `;
    expect(triggers).toEqual([
      {
        name: "opportunities_stage_transition",
        definition:
          "CREATE TRIGGER opportunities_stage_transition BEFORE UPDATE ON public.opportunities FOR EACH ROW EXECUTE FUNCTION private.enforce_opportunity_stage_transition()",
        enabled: "O",
      },
      // DEC-052 §5: ganar con una toma aceptada la hace entrar al stock en
      // la misma transacción; el constraint trigger lo exige al COMMIT.
      {
        name: "opportunities_won_trade_in_stocked",
        definition:
          "CREATE CONSTRAINT TRIGGER opportunities_won_trade_in_stocked AFTER UPDATE ON public.opportunities DEFERRABLE INITIALLY DEFERRED FOR EACH ROW WHEN (((new.stage = 'won'::text) AND (old.stage IS DISTINCT FROM 'won'::text))) EXECUTE FUNCTION private.enforce_won_trade_in_stocked()",
        enabled: "O",
      },
      // DEC-051 §4: ganar vende la unidad vinculada en la misma
      // transacción; el constraint trigger lo exige al COMMIT.
      {
        name: "opportunities_won_vehicle_sold",
        definition:
          "CREATE CONSTRAINT TRIGGER opportunities_won_vehicle_sold AFTER UPDATE ON public.opportunities DEFERRABLE INITIALLY DEFERRED FOR EACH ROW WHEN (((new.stage = 'won'::text) AND (old.stage IS DISTINCT FROM 'won'::text))) EXECUTE FUNCTION private.enforce_won_vehicle_sold()",
        enabled: "O",
      },
    ]);
    const [fn] = await db.admin<
      {
        securityDefiner: boolean;
        config: string[] | null;
        owner: string;
        returns: string;
        authenticatedExecute: boolean;
        publicExecute: boolean;
      }[]
    >`
      SELECT p.prosecdef AS "securityDefiner", p.proconfig AS config,
        p.proowner::regrole::text AS owner, p.prorettype::regtype::text AS returns,
        has_function_privilege('authenticated', p.oid, 'EXECUTE') AS "authenticatedExecute",
        EXISTS (
          SELECT FROM aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
          WHERE a.grantee = 0 AND a.privilege_type = 'EXECUTE'
        ) AS "publicExecute"
      FROM pg_proc p
      WHERE p.oid = to_regprocedure('private.enforce_opportunity_stage_transition()')
    `;
    expect(fn).toEqual({
      securityDefiner: false,
      config: ['search_path=""'],
      owner: "postgres",
      returns: "trigger",
      authenticatedExecute: false,
      publicExecute: false,
    });
  });

  it("opportunity_demand_facts (H1.4): append-only. SELECT e INSERT de tabla para authenticated (diseño A), policies de lectura y alta; sin UPDATE ni DELETE para nadie de la app, tampoco service_role (C-11)", async () => {
    expect(
      (
        await tablePrivileges(db.admin, [
          "anon",
          "authenticated",
          "app_runtime",
          "service_role",
        ])
      ).filter((grant) => grant.endsWith(" opportunity_demand_facts")),
    ).toEqual([
      "authenticated INSERT opportunity_demand_facts",
      "authenticated SELECT opportunity_demand_facts",
      "service_role INSERT opportunity_demand_facts",
      // MAINTAIN (PostgreSQL 17): VACUUM, ANALYZE, REINDEX; no cambia filas.
      "service_role MAINTAIN opportunity_demand_facts",
      "service_role REFERENCES opportunity_demand_facts",
      "service_role SELECT opportunity_demand_facts",
      "service_role TRIGGER opportunity_demand_facts",
    ]);
    // INSERT de tabla, no por columna: el INSERT de Drizzle lista todas las
    // columnas (demand-facts.test.ts, P0 a P2).
    const [insert] = await db.admin<{ table: boolean }[]>`
      SELECT has_table_privilege('authenticated', 'public.opportunity_demand_facts', 'INSERT') AS table
    `;
    expect(insert?.table).toBe(true);
    expect(
      (await policies(db.admin))
        .filter((policy) => policy.table === "opportunity_demand_facts")
        .map((policy) => `${policy.name} ${policy.command}`),
    ).toEqual([
      "opportunity_demand_facts_insert_member INSERT",
      "opportunity_demand_facts_select_member SELECT",
    ]);
  });

  it("opportunity_notes (Hito 2): append-only. SELECT e INSERT de tabla para authenticated (diseño A), policies de lectura y alta; sin UPDATE ni DELETE para nadie de la app, tampoco service_role", async () => {
    expect(
      (
        await tablePrivileges(db.admin, [
          "anon",
          "authenticated",
          "app_runtime",
          "service_role",
        ])
      ).filter((grant) => grant.endsWith(" opportunity_notes")),
    ).toEqual([
      "authenticated INSERT opportunity_notes",
      "authenticated SELECT opportunity_notes",
      "service_role INSERT opportunity_notes",
      "service_role MAINTAIN opportunity_notes",
      "service_role REFERENCES opportunity_notes",
      "service_role SELECT opportunity_notes",
      "service_role TRIGGER opportunity_notes",
    ]);
    const [insert] = await db.admin<{ table: boolean }[]>`
      SELECT has_table_privilege('authenticated', 'public.opportunity_notes', 'INSERT') AS table
    `;
    expect(insert?.table).toBe(true);
    expect(
      (await policies(db.admin))
        .filter((policy) => policy.table === "opportunity_notes")
        .map((policy) => `${policy.name} ${policy.command}`),
    ).toEqual([
      "opportunity_notes_insert_member INSERT",
      "opportunity_notes_select_member SELECT",
    ]);
  });

  it("opportunities (Hito 2): la unidad vinculada es de la misma organización (FK compuesta a vehicles), solo existe desde la negociación (CHECK) y la valida el mismo trigger", async () => {
    const constraints = await db.admin<{ definition: string }[]>`
      SELECT conname || ' ' || pg_get_constraintdef(oid) AS definition
      FROM pg_constraint
      WHERE conrelid = 'public.opportunities'::regclass
        AND conname IN ('opportunities_vehicle_fk', 'opportunities_vehicle_stage_check')
      ORDER BY conname
    `;
    expect(constraints.map((c) => c.definition)).toEqual([
      "opportunities_vehicle_fk FOREIGN KEY (organization_id, vehicle_id) REFERENCES vehicles(organization_id, id) ON DELETE RESTRICT",
      "opportunities_vehicle_stage_check CHECK (((vehicle_id IS NULL) OR (stage = ANY (ARRAY['negotiating'::text, 'won'::text, 'lost'::text]))))",
    ]);
    const [unique] = await db.admin<{ definition: string }[]>`
      SELECT pg_get_constraintdef(oid) AS definition FROM pg_constraint
      WHERE conrelid = 'public.vehicles'::regclass
        AND conname = 'vehicles_organization_id_id_key'
    `;
    expect(unique?.definition).toBe("UNIQUE (organization_id, id)");
    // La función sigue siendo la del trigger de 0008, ahora con la regla de
    // la unidad (DEC-033 §3).
    const [fn] = await db.admin<{ source: string }[]>`
      SELECT prosrc AS source FROM pg_proc
      WHERE oid = 'private.enforce_opportunity_stage_transition()'::regprocedure
    `;
    expect(fn?.source).toContain("opportunities_vehicle_link");
    expect(fn?.source).toContain("opportunities_stage_transition");
    // Y desde 0011, la del toque de actividad (DEC-036 §3).
    expect(fn?.source).toContain("opportunities_activity_touch");
    expect(fn?.source).toContain("pg_trigger_depth()");
  });

  it("messages (Hito 4): append-only. SELECT e INSERT de tabla para authenticated (diseño A), policies de lectura y alta; sin UPDATE ni DELETE para nadie de la app, tampoco service_role", async () => {
    expect(
      (
        await tablePrivileges(db.admin, [
          "anon",
          "authenticated",
          "app_runtime",
          "service_role",
        ])
      ).filter((grant) => grant.endsWith(" messages")),
    ).toEqual([
      "authenticated INSERT messages",
      "authenticated SELECT messages",
      "service_role INSERT messages",
      "service_role MAINTAIN messages",
      "service_role REFERENCES messages",
      "service_role SELECT messages",
      "service_role TRIGGER messages",
    ]);
    const [insert] = await db.admin<{ table: boolean }[]>`
      SELECT has_table_privilege('authenticated', 'public.messages', 'INSERT') AS table
    `;
    expect(insert?.table).toBe(true);
    expect(
      (await policies(db.admin))
        .filter((policy) => policy.table === "messages")
        .map((policy) => `${policy.name} ${policy.command}`),
    ).toEqual([
      "messages_insert_member INSERT",
      "messages_select_member SELECT",
    ]);
  });

  it("conversations y whatsapp_lines (Hito 7, DEC-039 §6; Hito 8, DEC-040 §4): los miembros solo leen las conversaciones y las líneas de su organización", async () => {
    expect(
      (
        await tablePrivileges(db.admin, [
          "anon",
          "authenticated",
          "app_runtime",
        ])
      ).filter(
        (grant) =>
          grant.endsWith(" conversations") || grant.endsWith(" whatsapp_lines"),
      ),
    ).toEqual([
      "authenticated SELECT conversations",
      "authenticated SELECT whatsapp_lines",
    ]);
    expect(
      (await policies(db.admin))
        .filter((policy) =>
          ["conversations", "whatsapp_lines"].includes(policy.table),
        )
        .map((policy) => `${policy.table}.${policy.name} ${policy.command}`),
    ).toEqual([
      "conversations.conversations_select_member SELECT",
      "whatsapp_lines.whatsapp_lines_select_member SELECT",
    ]);
  });

  it("message_statuses (Hito 12C, DEC-044 §3.3): append-only. Los miembros solo leen los estados de su organización; nadie de la app los escribe directo, y service_role no los edita ni borra", async () => {
    expect(
      (
        await tablePrivileges(db.admin, [
          "anon",
          "authenticated",
          "app_runtime",
          "service_role",
        ])
      ).filter((grant) => grant.endsWith(" message_statuses")),
    ).toEqual([
      "authenticated SELECT message_statuses",
      "service_role INSERT message_statuses",
      "service_role MAINTAIN message_statuses",
      "service_role REFERENCES message_statuses",
      "service_role SELECT message_statuses",
      "service_role TRIGGER message_statuses",
    ]);
    expect(
      (await policies(db.admin))
        .filter((policy) => policy.table === "message_statuses")
        .map((policy) => `${policy.table}.${policy.name} ${policy.command}`),
    ).toEqual(["message_statuses.message_statuses_select_member SELECT"]);
  });

  it("estados de entrega (Hito 12C, DEC-044 §3.3): private.ingest_whatsapp_status() es SECURITY DEFINER de postgres, de search_path vacío, con EXECUTE solo para authenticated, la regla que rechaza las claims y la búsqueda solo entre los salientes", async () => {
    const signature =
      "private.ingest_whatsapp_status(text,text,text,timestamp with time zone)";
    const [fn] = await db.admin<
      {
        securityDefiner: boolean;
        volatility: string;
        config: string[] | null;
        owner: string;
        acl: string[] | null;
        guards: boolean;
      }[]
    >`
      SELECT p.prosecdef AS "securityDefiner", p.provolatile::text AS volatility,
        p.proconfig AS config, p.proowner::regrole::text AS owner,
        p.proacl::text[] AS acl,
        position('ingestion_without_user' in p.prosrc) > 0
          AND position('m.direction = ''outbound''' in p.prosrc) > 0 AS guards
      FROM pg_proc p
      WHERE p.oid = to_regprocedure(${signature})
    `;
    expect(fn).toEqual({
      securityDefiner: true,
      volatility: "v",
      config: ['search_path=""'],
      owner: "postgres",
      acl: ["postgres=X/postgres", "authenticated=X/postgres"],
      guards: true,
    });
    const executors = await db.admin<{ role: string }[]>`
      SELECT rolname AS role FROM pg_roles
      WHERE has_function_privilege(oid, to_regprocedure(${signature}), 'EXECUTE')
        AND NOT rolsuper
      ORDER BY 1
    `;
    expect(executors.map((r) => r.role)).toEqual(["authenticated", "postgres"]);
  });

  it("conversation_reads (Hito 12B, DEC-044 §2.9): cada miembro solo lee sus cursores; nadie de la app los escribe directo", async () => {
    expect(
      (
        await tablePrivileges(db.admin, [
          "anon",
          "authenticated",
          "app_runtime",
        ])
      ).filter((grant) => grant.endsWith(" conversation_reads")),
    ).toEqual(["authenticated SELECT conversation_reads"]);
    expect(
      (await policies(db.admin))
        .filter((policy) => policy.table === "conversation_reads")
        .map((policy) => `${policy.table}.${policy.name} ${policy.command}`),
    ).toEqual(["conversation_reads.conversation_reads_select_own SELECT"]);
  });

  it("marcar visto (Hito 12B, DEC-044 §2): private.mark_conversation_read() es SECURITY DEFINER de postgres, de search_path vacío, con EXECUTE solo para authenticated, las reglas que exigen un miembro activo y el cursor que solo avanza", async () => {
    const signature = "private.mark_conversation_read(uuid,uuid,uuid)";
    const [fn] = await db.admin<
      {
        securityDefiner: boolean;
        volatility: string;
        config: string[] | null;
        owner: string;
        acl: string[] | null;
        guards: boolean;
      }[]
    >`
      SELECT p.prosecdef AS "securityDefiner", p.provolatile::text AS volatility,
        p.proconfig AS config, p.proowner::regrole::text AS owner,
        p.proacl::text[] AS acl,
        position('read_requires_user' in p.prosrc) > 0
          AND position('read_not_member' in p.prosrc) > 0
          AND position('GREATEST(r.read_up_to, EXCLUDED.read_up_to)' in p.prosrc) > 0 AS guards
      FROM pg_proc p
      WHERE p.oid = to_regprocedure(${signature})
    `;
    expect(fn).toEqual({
      securityDefiner: true,
      volatility: "v",
      config: ['search_path=""'],
      owner: "postgres",
      acl: ["postgres=X/postgres", "authenticated=X/postgres"],
      guards: true,
    });
    const executors = await db.admin<{ role: string }[]>`
      SELECT rolname AS role FROM pg_roles
      WHERE has_function_privilege(oid, to_regprocedure(${signature}), 'EXECUTE')
        AND NOT rolsuper
      ORDER BY 1
    `;
    expect(executors.map((r) => r.role)).toEqual(["authenticated", "postgres"]);
  });

  it("envío (Hito 8, DEC-040 §6): private.record_outbound_whatsapp_message() es SECURITY DEFINER de postgres, de search_path vacío, con EXECUTE solo para authenticated y las reglas que exigen un miembro activo", async () => {
    const signature =
      "private.record_outbound_whatsapp_message(uuid,uuid,text,text,text)";
    const [fn] = await db.admin<
      {
        securityDefiner: boolean;
        volatility: string;
        config: string[] | null;
        owner: string;
        acl: string[] | null;
        guards: boolean;
      }[]
    >`
      SELECT p.prosecdef AS "securityDefiner", p.provolatile::text AS volatility,
        p.proconfig AS config, p.proowner::regrole::text AS owner,
        p.proacl::text[] AS acl,
        position('outbound_requires_user' in p.prosrc) > 0
          AND position('outbound_not_member' in p.prosrc) > 0 AS guards
      FROM pg_proc p
      WHERE p.oid = to_regprocedure(${signature})
    `;
    expect(fn).toEqual({
      securityDefiner: true,
      volatility: "v",
      config: ['search_path=""'],
      owner: "postgres",
      acl: ["postgres=X/postgres", "authenticated=X/postgres"],
      guards: true,
    });
    const executors = await db.admin<{ role: string }[]>`
      SELECT rolname AS role FROM pg_roles
      WHERE has_function_privilege(oid, to_regprocedure(${signature}), 'EXECUTE')
        AND NOT rolsuper
      ORDER BY 1
    `;
    expect(executors.map((r) => r.role)).toEqual(["authenticated", "postgres"]);
  });

  it("ingesta (Hito 7, DEC-039 §4 y §7): private.ingest_whatsapp_message() es SECURITY DEFINER de postgres, de search_path vacío, con EXECUTE solo para authenticated y la regla que rechaza las claims; app_runtime sigue sin privilegios directos", async () => {
    const signature =
      "private.ingest_whatsapp_message(text,text,text,text,text,text,text,timestamp with time zone)";
    const [fn] = await db.admin<
      {
        securityDefiner: boolean;
        volatility: string;
        config: string[] | null;
        owner: string;
        acl: string[] | null;
        guard: boolean;
      }[]
    >`
      SELECT p.prosecdef AS "securityDefiner", p.provolatile::text AS volatility,
        p.proconfig AS config, p.proowner::regrole::text AS owner,
        p.proacl::text[] AS acl,
        position('ingestion_without_user' in p.prosrc) > 0 AS guard
      FROM pg_proc p
      WHERE p.oid = to_regprocedure(${signature})
    `;
    expect(fn).toEqual({
      securityDefiner: true,
      volatility: "v",
      config: ['search_path=""'],
      owner: "postgres",
      acl: ["postgres=X/postgres", "authenticated=X/postgres"],
      guard: true,
    });
    const executors = await db.admin<{ role: string }[]>`
      SELECT rolname AS role FROM pg_roles
      WHERE has_function_privilege(oid, to_regprocedure(${signature}), 'EXECUTE')
        AND NOT rolsuper
      ORDER BY 1
    `;
    expect(executors.map((r) => r.role)).toEqual(["authenticated", "postgres"]);
  });

  it("recencia (Hito 4, DEC-036 §1 y §2): una nota o un mensaje nuevos la mueven con un trigger AFTER INSERT de fila, habilitado, cuya función es SECURITY DEFINER de postgres, de search_path vacío y sin EXECUTE para nadie", async () => {
    const triggers = await db.admin<
      { table: string; definition: string; enabled: string }[]
    >`
      SELECT t.tgrelid::regclass::text AS table,
        pg_get_triggerdef(t.oid) AS definition, t.tgenabled::text AS enabled
      FROM pg_trigger t
      WHERE t.tgfoid = to_regprocedure('private.touch_opportunity_activity()')
        AND NOT t.tgisinternal
      ORDER BY 1
    `;
    expect(triggers).toEqual([
      {
        table: "messages",
        definition:
          "CREATE TRIGGER messages_touch_activity AFTER INSERT ON public.messages FOR EACH ROW EXECUTE FUNCTION private.touch_opportunity_activity()",
        enabled: "O",
      },
      {
        table: "opportunity_notes",
        definition:
          "CREATE TRIGGER opportunity_notes_touch_activity AFTER INSERT ON public.opportunity_notes FOR EACH ROW EXECUTE FUNCTION private.touch_opportunity_activity()",
        enabled: "O",
      },
    ]);
    const [fn] = await db.admin<
      {
        securityDefiner: boolean;
        config: string[] | null;
        owner: string;
        returns: string;
        acl: string[] | null;
      }[]
    >`
      SELECT p.prosecdef AS "securityDefiner", p.proconfig AS config,
        p.proowner::regrole::text AS owner, p.prorettype::regtype::text AS returns,
        p.proacl::text[] AS acl
      FROM pg_proc p
      WHERE p.oid = to_regprocedure('private.touch_opportunity_activity()')
    `;
    expect(fn).toEqual({
      securityDefiner: true,
      config: ['search_path=""'],
      owner: "postgres",
      returns: "trigger",
      // Solo su owner: ni PUBLIC, ni authenticated, ni anon, ni app_runtime.
      acl: ["postgres=X/postgres"],
    });
    const executors = await db.admin<{ role: string }[]>`
      SELECT rolname AS role FROM pg_roles
      WHERE has_function_privilege(oid, 'private.touch_opportunity_activity()', 'EXECUTE')
        AND NOT rolsuper
      ORDER BY 1
    `;
    expect(executors.map((r) => r.role)).toEqual(["postgres"]);
  });

  /*
   * PostgreSQL combina las policies permisivas de un mismo comando de una
   * misma tabla con OR, por separado para USING y para WITH CHECK: con dos
   * policies de UPDATE sobre una tabla, el origen de una y el destino de la
   * otra quedarían permitidos juntos. Por eso cada tabla con edición tiene
   * una sola policy de UPDATE: vehicles, el par exacto in_preparation →
   * available (DEC-028); opportunities, solo la organización, porque el par
   * etapa anterior → etapa nueva lo valida un trigger (DEC-032 §4, el
   * mecanismo que DEC-028 §6 pedía antes de una segunda transición);
   * organizations y memberships (Hito 6), solo la organización entre las del
   * usuario como admin, y qué cambio de membership vale lo valida su trigger
   * (DEC-038 §4). Otra transición no suma una policy: pasa por el trigger de
   * su tabla.
   */
  it("cada tabla con edición tiene una sola policy de UPDATE: el par origen → destino no se cruza por OR", async () => {
    const updates = (await policies(db.admin)).filter((policy) =>
      ["UPDATE", "ALL"].includes(policy.command),
    );
    expect(updates.map((policy) => `${policy.table}.${policy.name}`)).toEqual([
      "deliveries.deliveries_update_member",
      "memberships.memberships_update_admin",
      "opportunities.opportunities_update_stage",
      "organizations.organizations_update_admin",
      "quotes.quotes_update_member",
      "test_drives.test_drives_update_member",
      "trade_ins.trade_ins_update_member",
      "vehicles.vehicles_update_status",
    ]);
    expect(new Set(updates.map((policy) => policy.table)).size).toBe(
      updates.length,
    );
  });

  it("anon y app_runtime no tienen privilegios sobre las tablas de public", async () => {
    expect(await tablePrivileges(db.admin, ["anon", "app_runtime"])).toEqual(
      [],
    );
  });

  it("todo privilegio de authenticated sobre public está cubierto por una policy, también los de columna", async () => {
    const uncovered = await db.admin<{ grant: string }[]>`
      SELECT p.privilege || ' ' || c.relname AS grant
      FROM pg_class c
      CROSS JOIN unnest(ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE']) AS p(privilege)
      WHERE c.relnamespace = 'public'::regnamespace
        AND c.relkind IN ('r', 'p')
        AND (
          has_table_privilege('authenticated', c.oid, p.privilege)
          OR (
            p.privilege IN ('SELECT', 'INSERT', 'UPDATE')
            AND has_any_column_privilege('authenticated', c.oid, p.privilege)
          )
        )
        AND NOT EXISTS (
          SELECT 1 FROM pg_policies pol
          WHERE pol.schemaname = 'public'
            AND pol.tablename = c.relname
            AND pol.cmd IN (p.privilege, 'ALL')
            AND pol.roles && ARRAY['authenticated', 'public']::name[]
        )
    `;
    expect(uncovered).toEqual([]);
  });

  it("anon, authenticated y app_runtime no pueden crear objetos", async () => {
    expect(
      await createPrivileges(db.admin, [
        "anon",
        "authenticated",
        "app_runtime",
      ]),
    ).toEqual([]);

    await expectDenied(() => runtime`CREATE TABLE public.probe (id int)`);
    await expectDenied(() => runtime`CREATE SCHEMA probe`);
    await inRolledBackTransaction(db.admin, async (tx) => {
      for (const ddl of [
        "CREATE TABLE public.probe (id int)",
        "CREATE SCHEMA probe",
        "CREATE FUNCTION public.probe() RETURNS int LANGUAGE sql AS 'SELECT 1'",
        "CREATE FUNCTION private.probe() RETURNS int LANGUAGE sql AS 'SELECT 1'",
      ]) {
        await expect(
          tx.savepoint((sp) =>
            asRole(sp, "authenticated", (as) => as.unsafe(ddl)),
          ),
        ).rejects.toMatchObject({ code: "42501" });
      }
    });
  });
});

describe("private.user_org_ids() (ADR-001 §4)", () => {
  it("SECURITY DEFINER, STABLE, search_path vacío, owner postgres", async () => {
    const [fn] = await db.admin`
      SELECT
        p.oid::regprocedure::text AS signature,
        p.prorettype::regtype::text AS returns,
        p.proretset AS "returnsSet",
        l.lanname AS language,
        p.prosecdef AS "securityDefiner",
        p.provolatile::text AS volatility,
        p.proconfig AS config,
        p.proowner::regrole::text AS owner
      FROM pg_proc p JOIN pg_language l ON l.oid = p.prolang
      WHERE p.oid = 'private.user_org_ids()'::regprocedure
    `;
    expect(fn).toEqual({
      signature: "private.user_org_ids()",
      returns: "uuid",
      returnsSet: true,
      language: "sql",
      securityDefiner: true,
      volatility: "s",
      config: ['search_path=""'],
      owner: "postgres",
    });
  });

  it("EXECUTE solo para authenticated (y su owner), nunca PUBLIC", async () => {
    const [fn] = await db.admin<{ acl: string[] }[]>`
      SELECT proacl::text[] AS acl FROM pg_proc
      WHERE oid = 'private.user_org_ids()'::regprocedure
    `;
    expect(fn?.acl.sort()).toEqual([
      "authenticated=X/postgres",
      "postgres=X/postgres",
    ]);

    const executors = await db.admin<{ role: string }[]>`
      SELECT rolname AS role FROM pg_roles
      WHERE has_function_privilege(oid, 'private.user_org_ids()', 'EXECUTE')
        AND NOT rolsuper
      ORDER BY 1
    `;
    expect(executors.map((r) => r.role)).toEqual(["authenticated", "postgres"]);
  });

  it("vive en private: owner postgres, solo USAGE para authenticated", async () => {
    const [schema] = await db.admin<{ owner: string; acl: string[] }[]>`
      SELECT nspowner::regrole::text AS owner, nspacl::text[] AS acl
      FROM pg_namespace WHERE nspname = 'private'
    `;
    expect(schema?.owner).toBe("postgres");
    expect(schema?.acl.sort()).toEqual([
      "authenticated=U/postgres",
      "postgres=UC/postgres",
    ]);
  });

  it("no hay funciones (ni SECURITY DEFINER) en public", async () => {
    const [row] = await db.admin<{ functions: number }[]>`
      SELECT count(*)::int AS functions FROM pg_proc
      WHERE pronamespace = 'public'::regnamespace
    `;
    expect(row?.functions).toBe(0);
  });
});
