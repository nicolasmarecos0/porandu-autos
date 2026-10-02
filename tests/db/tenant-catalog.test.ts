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
 * 0002_opportunities_persistence, 0003_contact_identity_opportunity_create y
 * 0004_vehicles_stock_persistence, leídos del catálogo de PostgreSQL 17
 * (ADR-001 §2, §3.6 y §4; criterios C2, C3 y C9). El acceso a datos se
 * prueba en tenant-isolation.test.ts y opportunities.test.ts.
 */

const TABLES = [
  "contacts",
  "memberships",
  "opportunities",
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
  it("lectura para authenticated y alta de contacts y opportunities con WITH CHECK, con la forma de referencia", async () => {
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
        table: "organizations",
        name: "organizations_select_member",
        permissive: "PERMISSIVE",
        roles: ["authenticated"],
        command: "SELECT",
        using: "(id IN ( SELECT private.user_org_ids() AS user_org_ids))",
        withCheck: null,
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
        name: "vehicles_select_member",
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
  it("authenticated tiene SELECT sobre las tablas de la app e INSERT solo sobre contacts y opportunities (vehicles: solo lectura)", async () => {
    expect(await tablePrivileges(db.admin, ["authenticated"])).toEqual([
      "authenticated INSERT contacts",
      "authenticated INSERT opportunities",
      ...TABLES.map((table) => `authenticated SELECT ${table}`),
    ]);
  });

  it("authenticated no puede modificar, borrar ni vaciar ninguna tabla", async () => {
    const writes = (await tablePrivileges(db.admin, ["authenticated"])).filter(
      (grant) => !/^authenticated (SELECT|INSERT) /.test(grant),
    );
    expect(writes).toEqual([]);
  });

  it("toda policy de escritura tiene WITH CHECK", async () => {
    const writePolicies = (await policies(db.admin)).filter((policy) =>
      ["INSERT", "UPDATE", "ALL"].includes(policy.command),
    );
    expect(writePolicies.map((policy) => policy.name)).toEqual([
      "contacts_insert_member",
      "opportunities_insert_member",
    ]);
    expect(writePolicies.every((policy) => policy.withCheck !== null)).toBe(
      true,
    );
  });

  it("vehicles es de solo lectura (H1.3A): SELECT para authenticated y una sola policy, de lectura", async () => {
    expect(
      (
        await tablePrivileges(db.admin, [
          "anon",
          "authenticated",
          "app_runtime",
        ])
      ).filter((grant) => grant.endsWith(" vehicles")),
    ).toEqual(["authenticated SELECT vehicles"]);
    expect(
      (await policies(db.admin))
        .filter((policy) => policy.table === "vehicles")
        .map((policy) => `${policy.name} ${policy.command}`),
    ).toEqual(["vehicles_select_member SELECT"]);
  });

  it("anon y app_runtime no tienen privilegios sobre las tablas de public", async () => {
    expect(await tablePrivileges(db.admin, ["anon", "app_runtime"])).toEqual(
      [],
    );
  });

  it("todo privilegio de authenticated sobre public está cubierto por una policy", async () => {
    const uncovered = await db.admin<{ grant: string }[]>`
      SELECT p.privilege || ' ' || c.relname AS grant
      FROM pg_class c
      CROSS JOIN unnest(ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE']) AS p(privilege)
      WHERE c.relnamespace = 'public'::regnamespace
        AND c.relkind IN ('r', 'p')
        AND has_table_privilege('authenticated', c.oid, p.privilege)
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
