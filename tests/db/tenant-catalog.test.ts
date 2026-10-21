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
 * 0012_team_settings y 0013_whatsapp_ingestion, leídos del catálogo de
 * PostgreSQL 17 (ADR-001 §2, §3.6 y §4; criterios C2,
 * C3 y C9). El acceso a datos se prueba en tenant-isolation.test.ts,
 * opportunities.test.ts, vehicles.test.ts, demand-facts.test.ts y los tests
 * de cada escritura.
 */

/** Tablas que leen los miembros (todas salvo whatsapp_lines, DEC-039 §5). */
const TABLES = [
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
  it("lectura para authenticated, alta de contacts, opportunities, vehicles, opportunity_demand_facts, opportunity_notes, messages y memberships (admin, Hito 6) con WITH CHECK, y las ediciones de vehicles, opportunities, organizations y memberships (admin, Hito 6) con USING y WITH CHECK, con la forma de referencia", async () => {
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
        table: "messages",
        name: "messages_insert_member",
        permissive: "PERMISSIVE",
        roles: ["authenticated"],
        command: "INSERT",
        using: null,
        withCheck:
          "((organization_id IN ( SELECT private.user_org_ids() AS user_org_ids)) AND (recorded_by = ( SELECT auth.uid() AS uid)) AND (created_at = now()))",
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
        name: "vehicles_update_mark_available",
        permissive: "PERMISSIVE",
        roles: ["authenticated"],
        command: "UPDATE",
        using:
          "((organization_id IN ( SELECT private.user_org_ids() AS user_org_ids)) AND (status = 'in_preparation'::text))",
        withCheck:
          "((organization_id IN ( SELECT private.user_org_ids() AS user_org_ids)) AND (status = 'available'::text))",
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
  it("authenticated tiene SELECT sobre las tablas de la app, INSERT solo sobre contacts, opportunities, vehicles, opportunity_demand_facts, opportunity_notes, messages y memberships, y UPDATE solo sobre opportunities, vehicles, organizations y memberships", async () => {
    expect(await tablePrivileges(db.admin, ["authenticated"])).toEqual([
      "authenticated INSERT contacts",
      "authenticated INSERT memberships",
      "authenticated INSERT messages",
      "authenticated INSERT opportunities",
      "authenticated INSERT opportunity_demand_facts",
      "authenticated INSERT opportunity_notes",
      "authenticated INSERT vehicles",
      ...TABLES.map((table) => `authenticated SELECT ${table}`),
      "authenticated UPDATE memberships",
      "authenticated UPDATE opportunities",
      "authenticated UPDATE organizations",
      "authenticated UPDATE vehicles",
    ]);
  });

  it("authenticated no puede borrar ni vaciar ninguna tabla, y solo actualiza opportunities.stage, loss_reason, vehicle_id, updated_at y los metadatos del cierre (H1.6, Hito 2, DEC-034), vehicles.status y updated_at (H1.3C), organizations.name, default_currency y updated_at y memberships.role, active y updated_at (Hito 6), por columna, nunca la tabla", async () => {
    const writes = (await tablePrivileges(db.admin, ["authenticated"])).filter(
      (grant) => !/^authenticated (SELECT|INSERT) /.test(grant),
    );
    expect(writes).toEqual([
      "authenticated UPDATE memberships",
      "authenticated UPDATE opportunities",
      "authenticated UPDATE organizations",
      "authenticated UPDATE vehicles",
    ]);

    for (const name of [
      "memberships",
      "opportunities",
      "organizations",
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
      "memberships_insert_admin",
      "memberships_update_admin",
      "messages_insert_member",
      "opportunities_insert_member",
      "opportunities_update_stage",
      "opportunity_demand_facts_insert_member",
      "opportunity_notes_insert_member",
      "organizations_update_admin",
      "vehicles_insert_member",
      "vehicles_update_mark_available",
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

  it("vehicles (H1.3C): SELECT, INSERT y UPDATE por columna para authenticated; policies de lectura, alta y disponibilidad; sin DELETE", async () => {
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
      "vehicles_update_mark_available UPDATE",
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
    `;
    expect(triggers).toEqual([
      {
        name: "opportunities_stage_transition",
        definition:
          "CREATE TRIGGER opportunities_stage_transition BEFORE UPDATE ON public.opportunities FOR EACH ROW EXECUTE FUNCTION private.enforce_opportunity_stage_transition()",
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

  it("conversations y whatsapp_lines (Hito 7, DEC-039 §5 y §6): los miembros solo leen las conversaciones; las líneas no tienen policies ni privilegios de authenticated", async () => {
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
    ).toEqual(["authenticated SELECT conversations"]);
    expect(
      (await policies(db.admin))
        .filter((policy) =>
          ["conversations", "whatsapp_lines"].includes(policy.table),
        )
        .map((policy) => `${policy.table}.${policy.name} ${policy.command}`),
    ).toEqual(["conversations.conversations_select_member SELECT"]);
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
      "memberships.memberships_update_admin",
      "opportunities.opportunities_update_stage",
      "organizations.organizations_update_admin",
      "vehicles.vehicles_update_mark_available",
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
