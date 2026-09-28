import { afterAll, describe, expect, inject, it } from "vitest";
import { openSql } from "./support/db";
import { env, isE1 } from "./support/env";

/*
 * C3 (catálogo) y C9 (Q1). Se consulta con la credencial de migración porque
 * es inspección del catálogo, no acceso de runtime.
 */

const fixtures = inject("fixtures");
const sql = openSql(env.migrationUrl, "catalog", 2);
afterAll(() => sql.end({ timeout: 5 }));

/** Tablas de `public` con organization_id cubiertas por la matriz de aislamiento. */
const COVERED_TENANT_TABLES = ["memberships", "tenant_probe"];

describe("C3 · catálogo de seguridad", () => {
  it("S-60 · toda tabla de public tiene RLS habilitado", async () => {
    const rows = await sql<{ table: string }[]>`
      select c.relname as table from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relkind in ('r', 'p') and not c.relrowsecurity`;
    expect(rows.map((r) => r.table)).toEqual([]);
  });

  it("S-61a · todo privilegio de authenticated sobre public está cubierto por una policy", async () => {
    const rows = await sql<{ table: string; cmd: string }[]>`
      with privs as (
        select c.relname as table, p.cmd
        from pg_class c
        join pg_namespace n on n.oid = c.relnamespace
        cross join (values ('SELECT'), ('INSERT'), ('UPDATE'), ('DELETE')) as p(cmd)
        where n.nspname = 'public' and c.relkind in ('r', 'p')
          and has_table_privilege('authenticated', c.oid, p.cmd)
      )
      select privs.table, privs.cmd from privs
      where not exists (
        select 1 from pg_policies pol
        where pol.schemaname = 'public' and pol.tablename = privs.table
          and (pol.cmd = privs.cmd or pol.cmd = 'ALL')
          and ('authenticated' = any(pol.roles) or 'public' = any(pol.roles))
      )`;
    expect(rows).toEqual([]);
  });

  it("S-61b · toda tabla con organization_id: NOT NULL, FK a organizations e índice que empieza por organization_id", async () => {
    const rows = await sql<
      {
        table: string;
        not_null: boolean;
        has_fk: boolean;
        has_index: boolean;
      }[]
    >`
      select c.relname as table,
             a.attnotnull as not_null,
             exists (
               select 1 from pg_constraint k
               where k.conrelid = c.oid and k.contype = 'f'
                 and k.confrelid = 'public.organizations'::regclass
                 and k.conkey[1] = a.attnum
             ) as has_fk,
             exists (
               select 1 from pg_index i
               where i.indrelid = c.oid and i.indkey[0] = a.attnum
             ) as has_index
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      join pg_attribute a on a.attrelid = c.oid and a.attname = 'organization_id'
      where n.nspname = 'public' and c.relkind in ('r', 'p')
      order by 1`;
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(row, row.table).toMatchObject({
        not_null: true,
        has_fk: true,
        has_index: true,
      });
    }
  });

  it("S-62 · atributos de roles: app_runtime sin super/bypassrls/herencia y sin tablas propias", async () => {
    const [runtime] = await sql<
      {
        rolsuper: boolean;
        rolbypassrls: boolean;
        rolinherit: boolean;
        rolcreaterole: boolean;
        rolcanlogin: boolean;
      }[]
    >`select rolsuper, rolbypassrls, rolinherit, rolcreaterole, rolcanlogin
      from pg_roles where rolname = 'app_runtime'`;
    expect(runtime).toEqual({
      rolsuper: false,
      rolbypassrls: false,
      rolinherit: false,
      rolcreaterole: false,
      rolcanlogin: true,
    });
    const owned = await sql`
      select c.relname from pg_class c
      where c.relowner = (select oid from pg_roles where rolname = 'app_runtime')`;
    expect(owned).toHaveLength(0);
    const apiRoles = await sql<{ rolname: string; rolbypassrls: boolean }[]>`
      select rolname, rolbypassrls from pg_roles
      where rolname in ('anon', 'authenticated') order by rolname`;
    expect(apiRoles).toEqual([
      { rolname: "anon", rolbypassrls: false },
      { rolname: "authenticated", rolbypassrls: false },
    ]);
  });

  it("S-63 · grants: anon y app_runtime sin privilegios sobre public; sin security definer en public", async () => {
    const leaked = await sql<{ table: string; grantee: string }[]>`
      select c.relname as table, g.grantee
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      cross join (values ('anon'), ('app_runtime')) as g(grantee)
      where n.nspname = 'public' and c.relkind in ('r', 'p')
        and has_table_privilege(g.grantee, c.oid, 'SELECT, INSERT, UPDATE, DELETE')`;
    expect(leaked).toEqual([]);
    const definers = await sql`
      select p.proname from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.prosecdef`;
    expect(definers).toHaveLength(0);
  });

  it("S-64 · meta-cobertura: toda tabla con organization_id está en la matriz", async () => {
    const rows = await sql<{ table: string }[]>`
      select c.relname as table from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      join pg_attribute a on a.attrelid = c.oid and a.attname = 'organization_id'
      where n.nspname = 'public' and c.relkind in ('r', 'p')
      order by 1`;
    expect(rows.map((r) => r.table)).toEqual(COVERED_TENANT_TABLES);
  });

  it.runIf(isE1)(
    "S-65 · hecho R1: en Supabase `postgres` tiene BYPASSRLS y es owner de las tablas",
    () => {
      expect(fixtures.meta.postgresRole.rolbypassrls).toBe(true);
      expect(fixtures.meta.appTableOwner).toBe("postgres");
    },
  );
});

describe("C9 · Q1: grant de authenticated a un rol custom", () => {
  it("Q1 · app_runtime es miembro de authenticated con SET TRUE e INHERIT FALSE", () => {
    expect(fixtures.meta.q1Grant).toEqual({
      exists: true,
      inherit: false,
      set: true,
      admin: false,
    });
  });
});
