import type { Sql, TransactionSql } from "postgres";

/*
 * Consultas al catálogo de Postgres: lo que la migración dejó realmente en
 * la base, no lo que declara el schema de Drizzle.
 */

export type Column = {
  name: string;
  type: string;
  notNull: boolean;
  default: string | null;
};

export async function tableNames(sql: Sql, schema: string): Promise<string[]> {
  const rows = await sql<{ name: string }[]>`
    SELECT c.relname AS name
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = ${schema} AND c.relkind IN ('r', 'p')
    ORDER BY 1
  `;
  return rows.map((r) => r.name);
}

export async function columns(sql: Sql, table: string): Promise<Column[]> {
  return sql<Column[]>`
    SELECT
      a.attname AS name,
      format_type(a.atttypid, a.atttypmod) AS type,
      a.attnotnull AS "notNull",
      pg_get_expr(d.adbin, d.adrelid) AS default
    FROM pg_attribute a
    LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
    WHERE a.attrelid = ${`public.${table}`}::regclass
      AND a.attnum > 0
      AND NOT a.attisdropped
    ORDER BY a.attnum
  `;
}

/** Constraints de la tabla: `{ nombre: definición }`. */
export async function constraints(
  sql: Sql,
  table: string,
): Promise<Record<string, string>> {
  const rows = await sql<{ name: string; definition: string }[]>`
    SELECT conname AS name, pg_get_constraintdef(oid) AS definition
    FROM pg_constraint
    WHERE conrelid = ${`public.${table}`}::regclass
    ORDER BY 1
  `;
  return Object.fromEntries(rows.map((r) => [r.name, r.definition]));
}

/** Índices de la tabla: `{ nombre: definición }`. */
export async function indexes(
  sql: Sql,
  table: string,
): Promise<Record<string, string>> {
  const rows = await sql<{ name: string; definition: string }[]>`
    SELECT indexname AS name, indexdef AS definition
    FROM pg_indexes
    WHERE schemaname = 'public' AND tablename = ${table}
    ORDER BY 1
  `;
  return Object.fromEntries(rows.map((r) => [r.name, r.definition]));
}

export type TableTenancy = {
  table: string;
  rls: boolean;
  hasOrganizationId: boolean;
  organizationIdNotNull: boolean;
  organizationIdFk: boolean;
  organizationIdLeadingIndex: boolean;
};

/*
 * Estado de tenancy de cada tabla de public, para las invariantes de
 * ADR-001 §3.6: RLS en toda tabla y, si tiene `organization_id`, NOT NULL,
 * FK a organizations(id) e índice que empieza por `organization_id`.
 */
export async function tenancy(sql: Sql): Promise<TableTenancy[]> {
  return sql<TableTenancy[]>`
    SELECT
      c.relname AS table,
      c.relrowsecurity AS rls,
      org.attnum IS NOT NULL AS "hasOrganizationId",
      COALESCE(org.attnotnull, false) AS "organizationIdNotNull",
      EXISTS (
        SELECT 1 FROM pg_constraint k
        WHERE k.conrelid = c.oid
          AND k.contype = 'f'
          AND k.conkey = ARRAY[org.attnum]
          AND k.confrelid = 'public.organizations'::regclass
          AND k.confkey = ARRAY[(
            SELECT attnum FROM pg_attribute
            WHERE attrelid = 'public.organizations'::regclass AND attname = 'id'
          )]
      ) AS "organizationIdFk",
      EXISTS (
        SELECT 1 FROM pg_index i
        WHERE i.indrelid = c.oid AND i.indkey[0] = org.attnum
      ) AS "organizationIdLeadingIndex"
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    LEFT JOIN pg_attribute org
      ON org.attrelid = c.oid
      AND org.attname = 'organization_id'
      AND NOT org.attisdropped
    WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p')
    ORDER BY 1
  `;
}

/** Privilegios de tabla o de columna de `roles` sobre las tablas de public. */
export async function tablePrivileges(
  sql: Sql | TransactionSql,
  roles: string[],
): Promise<string[]> {
  const rows = await sql<{ grant: string }[]>`
    SELECT r.role || ' ' || p.privilege || ' ' || c.relname AS grant
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    CROSS JOIN unnest(${roles}::text[]) AS r(role)
    CROSS JOIN unnest(ARRAY[
      'SELECT', 'INSERT', 'UPDATE', 'DELETE',
      'TRUNCATE', 'REFERENCES', 'TRIGGER', 'MAINTAIN'
    ]) AS p(privilege)
    WHERE n.nspname = 'public'
      AND c.relkind IN ('r', 'p')
      AND (
        has_table_privilege(r.role, c.oid, p.privilege)
        OR (
          p.privilege IN ('SELECT', 'INSERT', 'UPDATE', 'REFERENCES')
          AND has_any_column_privilege(r.role, c.oid, p.privilege)
        )
      )
    ORDER BY 1
  `;
  return rows.map((r) => r.grant);
}

/** Default privileges de `postgres` en public: `tipo grantee=privilegios`. */
export async function publicDefaultPrivileges(sql: Sql): Promise<string[]> {
  const rows = await sql<{ entry: string }[]>`
    SELECT d.defaclobjtype::text || ' ' || e.grantee::regrole::text || '=' || e.privilege_type AS entry
    FROM pg_default_acl d
    CROSS JOIN LATERAL aclexplode(d.defaclacl) e
    WHERE d.defaclrole = 'postgres'::regrole
      AND d.defaclnamespace = 'public'::regnamespace
    ORDER BY 1
  `;
  return rows.map((r) => r.entry);
}

/*
 * Foto normalizada de todo lo que una migración puede tocar: roles del
 * cluster y sus memberships, schemas (con owner y ACL), relaciones (con RLS
 * y ACL), columnas, constraints, índices, tipos, funciones (con seguridad,
 * volatilidad, config y ACL), policies y default privileges. Dos fotos
 * iguales = mismo estado de catálogo.
 */
export async function catalogSnapshot(sql: Sql): Promise<unknown> {
  const [snapshot] = await sql<{ snapshot: unknown }[]>`
    WITH app_schemas AS (
      SELECT oid, nspname, nspowner, nspacl FROM pg_namespace
      WHERE NOT starts_with(nspname, 'pg_') AND nspname <> 'information_schema'
    ),
    app_roles AS (
      SELECT * FROM pg_roles WHERE NOT starts_with(rolname, 'pg_')
    )
    SELECT jsonb_build_object(
      'roles', (
        SELECT jsonb_agg(jsonb_build_object(
          'name', rolname,
          'super', rolsuper,
          'inherit', rolinherit,
          'createRole', rolcreaterole,
          'createDb', rolcreatedb,
          'login', rolcanlogin,
          'replication', rolreplication,
          'bypassRls', rolbypassrls
        ) ORDER BY rolname)
        FROM app_roles
      ),
      'roleMemberships', (
        SELECT jsonb_agg(
          m.member::regrole::text || ' in ' || m.roleid::regrole::text
            || ' admin=' || m.admin_option
            || ' inherit=' || m.inherit_option
            || ' set=' || m.set_option
          ORDER BY 1
        )
        FROM pg_auth_members m
        WHERE m.member IN (SELECT oid FROM app_roles)
      ),
      'schemas', (
        SELECT jsonb_agg(jsonb_build_object(
          'name', nspname,
          'owner', nspowner::regrole::text,
          'acl', (SELECT jsonb_agg(a::text ORDER BY a::text) FROM unnest(nspacl) a)
        ) ORDER BY nspname)
        FROM app_schemas
      ),
      'relations', (
        SELECT jsonb_agg(jsonb_build_object(
          'name', s.nspname || '.' || c.relname,
          'kind', c.relkind::text,
          'owner', c.relowner::regrole::text,
          'rls', c.relrowsecurity,
          'forceRls', c.relforcerowsecurity,
          'acl', (SELECT jsonb_agg(a::text ORDER BY a::text) FROM unnest(c.relacl) a)
        ) ORDER BY s.nspname, c.relname)
        FROM pg_class c JOIN app_schemas s ON s.oid = c.relnamespace
      ),
      'columns', (
        SELECT jsonb_agg(jsonb_build_object(
          'column', s.nspname || '.' || c.relname || '.' || a.attname,
          'type', format_type(a.atttypid, a.atttypmod),
          'notNull', a.attnotnull,
          'default', pg_get_expr(d.adbin, d.adrelid)
        ) ORDER BY s.nspname, c.relname, a.attnum)
        FROM pg_attribute a
        JOIN pg_class c ON c.oid = a.attrelid
        JOIN app_schemas s ON s.oid = c.relnamespace
        LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
        WHERE a.attnum > 0 AND NOT a.attisdropped AND c.relkind IN ('r', 'p', 'v')
      ),
      'constraints', (
        SELECT jsonb_agg(
          s.nspname || '.' || k.conname || ': ' || pg_get_constraintdef(k.oid)
          ORDER BY s.nspname, k.conname
        )
        FROM pg_constraint k JOIN app_schemas s ON s.oid = k.connamespace
      ),
      'indexes', (
        SELECT jsonb_agg(indexdef ORDER BY schemaname, indexname)
        FROM pg_indexes
        WHERE schemaname IN (SELECT nspname FROM app_schemas)
      ),
      'types', (
        SELECT jsonb_agg(jsonb_build_object(
          'type', s.nspname || '.' || t.typname,
          'labels', (
            SELECT jsonb_agg(e.enumlabel ORDER BY e.enumsortorder)
            FROM pg_enum e WHERE e.enumtypid = t.oid
          )
        ) ORDER BY s.nspname, t.typname)
        FROM pg_type t JOIN app_schemas s ON s.oid = t.typnamespace
        WHERE t.typtype IN ('e', 'd', 'c') AND t.typrelid = 0
      ),
      'functions', (
        SELECT jsonb_agg(jsonb_build_object(
          'function', p.oid::regprocedure::text,
          'owner', p.proowner::regrole::text,
          'securityDefiner', p.prosecdef,
          'volatility', p.provolatile::text,
          'config', p.proconfig,
          'acl', (SELECT jsonb_agg(a::text ORDER BY a::text) FROM unnest(p.proacl) a),
          'body', p.prosrc
        ) ORDER BY p.oid::regprocedure::text)
        FROM pg_proc p JOIN app_schemas s ON s.oid = p.pronamespace
      ),
      'policies', (
        SELECT jsonb_agg(jsonb_build_object(
          'policy', schemaname || '.' || tablename || '.' || policyname,
          'permissive', permissive,
          'roles', roles,
          'cmd', cmd,
          'using', qual,
          'withCheck', with_check
        ) ORDER BY schemaname, tablename, policyname)
        FROM pg_policies
      ),
      'defaultPrivileges', (
        SELECT jsonb_agg(entry ORDER BY entry) FROM (
          SELECT d.defaclrole::regrole::text || ' '
            || coalesce(d.defaclnamespace::regnamespace::text, '*') || ' '
            || d.defaclobjtype::text || ' '
            || e.grantee::regrole::text || '=' || e.privilege_type AS entry
          FROM pg_default_acl d CROSS JOIN LATERAL aclexplode(d.defaclacl) e
        ) acl
      )
    ) AS snapshot
  `;
  return snapshot?.snapshot;
}

export type Policy = {
  table: string;
  name: string;
  permissive: string;
  roles: string[];
  command: string;
  using: string | null;
  withCheck: string | null;
};

/** Policies de public tal como quedaron en el catálogo (deparseadas). */
export async function policies(sql: Sql): Promise<Policy[]> {
  return sql<Policy[]>`
    SELECT
      tablename AS table,
      policyname AS name,
      permissive,
      roles::text[] AS roles,
      cmd AS command,
      qual AS using,
      with_check AS "withCheck"
    FROM pg_policies
    WHERE schemaname = 'public'
    ORDER BY tablename, policyname
  `;
}

/*
 * Privilegios de `roles` que permiten crear objetos persistentes: CREATE en
 * la base (schemas) y en los schemas de la aplicación.
 */
export async function createPrivileges(
  sql: Sql,
  roles: string[],
): Promise<string[]> {
  const rows = await sql<{ grant: string }[]>`
    SELECT r.role || ' CREATE ' || t.target AS grant
    FROM unnest(${roles}::text[]) AS r(role)
    CROSS JOIN (VALUES ('database'), ('public'), ('private'), ('drizzle')) AS t(target)
    WHERE CASE t.target
      WHEN 'database' THEN has_database_privilege(r.role, current_database(), 'CREATE')
      ELSE has_schema_privilege(r.role, t.target, 'CREATE')
    END
    ORDER BY 1
  `;
  return rows.map((r) => r.grant);
}
