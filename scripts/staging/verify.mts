import type { TransactionSql } from "postgres";

import { compareHistory, type RepoMigration } from "./migrations.mts";
import { finding, type Finding } from "./report.mts";

/*
 * Verificación post-migración de staging (solo lectura): lo que dejaron
 * 0000_saas_core_schema, 0001_tenant_isolation,
 * 0002_opportunities_persistence, 0003_contact_identity_opportunity_create y
 * 0004_vehicles_stock_persistence, leído del catálogo real (DEC-018, DEC-019, ADR-001 §2, §3.6 y §4). Espeja
 * tests/db/tenant-catalog y tests/db/schema: si una migración nueva cambia
 * lo esperado, se actualiza junto con esos tests.
 */

const APP_TABLES = [
  "contacts",
  "memberships",
  "opportunities",
  "organizations",
  "profiles",
  "vehicles",
];
const PRIVILEGES = [
  "SELECT",
  "INSERT",
  "UPDATE",
  "DELETE",
  "TRUNCATE",
  "REFERENCES",
  "TRIGGER",
  "MAINTAIN",
];

type Policy = {
  table: string;
  name: string;
  permissive: string;
  roles: string[];
  command: string;
  using: string | null;
  withCheck: string | null;
};

/**
 * Policies de lectura de H0 (DEC-019), de H1.1 (contacts, opportunities) y de
 * H1.3A (vehicles, solo lectura), y de alta de H1.2 (contacts, opportunities,
 * con WITH CHECK; la de opportunities exige además la etapa `new`), tal como
 * las deparsea PostgreSQL 17.
 */
export const EXPECTED_POLICIES: Policy[] = [
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
];

/** `contacts.phone_normalized` tal como lo deja 0003 (PostgreSQL 17). */
export const EXPECTED_PHONE_IDENTITY = {
  column: "text",
  index:
    "CREATE UNIQUE INDEX contacts_organization_id_phone_normalized_key ON public.contacts USING btree (organization_id, phone_normalized) WHERE (phone_normalized IS NOT NULL)",
  check:
    "CHECK (((phone_normalized IS NULL) OR ((phone IS NOT NULL) AND (phone_normalized ~ '^\\+[1-9][0-9]{1,14}$'::text))))",
};

/**
 * Privilegios de authenticated: lectura en todo y alta de H1.2 (vehicles es
 * de solo lectura en H1.3A).
 */
const AUTHENTICATED_PRIVILEGES = [
  "INSERT contacts",
  "INSERT opportunities",
  ...APP_TABLES.map((table) => `SELECT ${table}`),
];

function list(values: readonly string[]): string {
  return values.length === 0 ? "none" : values.join(", ");
}

function equal(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

async function tablePrivileges(
  tx: TransactionSql,
  role: string,
): Promise<string[]> {
  const rows = await tx<{ grant: string }[]>`
    SELECT p.privilege || ' ' || c.relname AS grant
    FROM pg_class c
    CROSS JOIN unnest(${PRIVILEGES}::text[]) AS p(privilege)
    WHERE c.relnamespace = 'public'::regnamespace
      AND c.relkind IN ('r', 'p', 'v', 'm', 'f')
      AND (
        has_table_privilege(${role}, c.oid, p.privilege)
        OR (
          p.privilege IN ('SELECT', 'INSERT', 'UPDATE', 'REFERENCES')
          AND has_any_column_privilege(${role}, c.oid, p.privilege)
        )
      )
    ORDER BY 1
  `;
  return rows.map((r) => r.grant);
}

export async function verifyCatalog(
  tx: TransactionSql,
  repo: readonly RepoMigration[],
): Promise<Finding[]> {
  const findings: Finding[] = [];

  // Historial: exactamente las migraciones oficiales del repositorio.
  const history = await tx<{ id: number; hash: string; createdAt: string }[]>`
    SELECT id, hash, created_at::text AS "createdAt"
    FROM drizzle.__drizzle_migrations ORDER BY created_at, id
  `;
  const status = compareHistory(
    repo,
    history.map((r) => ({
      id: r.id,
      hash: r.hash,
      createdAt: Number(r.createdAt),
    })),
  );
  findings.push(
    finding(
      "migrations.history",
      status.kind === "consistent" && status.pending.length === 0,
      status.kind === "consistent"
        ? `applied: ${list(status.applied.map((m) => m.tag))}; pending: ${list(status.pending.map((m) => m.tag))}`
        : status.reason,
    ),
  );

  // Tablas, RLS y enum (DEC-018).
  const tables = await tx<{ name: string; rls: boolean }[]>`
    SELECT relname AS name, relrowsecurity AS rls FROM pg_class
    WHERE relnamespace = 'public'::regnamespace AND relkind IN ('r', 'p')
    ORDER BY 1
  `;
  findings.push(
    finding(
      "schema.tables",
      equal(
        tables.map((t) => t.name),
        APP_TABLES,
      ),
      `public tables: ${list(tables.map((t) => t.name))}`,
    ),
    finding(
      "schema.rls",
      tables.every((t) => t.rls),
      `without RLS: ${list(tables.filter((t) => !t.rls).map((t) => t.name))}`,
    ),
  );
  const [roleEnum] = await tx<{ labels: string[] | null }[]>`
    SELECT (
      SELECT array_agg(e.enumlabel::text ORDER BY e.enumsortorder)
      FROM pg_enum e WHERE e.enumtypid = to_regtype('public.membership_role')
    ) AS labels
  `;
  findings.push(
    finding(
      "schema.membership_role",
      equal(roleEnum?.labels, ["admin", "seller"]),
      `membership_role = ${list(roleEnum?.labels ?? [])}`,
    ),
  );

  // Tablas tenant-scoped: organization_id NOT NULL, FK e índice líder.
  const tenancy = await tx<
    { table: string; notNull: boolean; fk: boolean; index: boolean }[]
  >`
    SELECT c.relname AS table, a.attnotnull AS "notNull",
      EXISTS (
        SELECT FROM pg_constraint k
        WHERE k.conrelid = c.oid AND k.contype = 'f'
          AND k.conkey = ARRAY[a.attnum]
          AND k.confrelid = 'public.organizations'::regclass
      ) AS fk,
      EXISTS (
        SELECT FROM pg_index i WHERE i.indrelid = c.oid AND i.indkey[0] = a.attnum
      ) AS index
    FROM pg_class c
    JOIN pg_attribute a ON a.attrelid = c.oid
      AND a.attname = 'organization_id' AND NOT a.attisdropped
    WHERE c.relnamespace = 'public'::regnamespace AND c.relkind IN ('r', 'p')
    ORDER BY 1
  `;
  const badTenancy = tenancy.filter((t) => !(t.notNull && t.fk && t.index));
  findings.push(
    finding(
      "schema.tenant-scoped",
      tenancy.length > 0 && badTenancy.length === 0,
      `tenant-scoped: ${list(tenancy.map((t) => t.table))}; invalid: ${list(badTenancy.map((t) => t.table))}`,
    ),
  );

  // Identidad del contacto por teléfono (H1.2): E.164 opcional, único por
  // organización (índice parcial) y con la forma canónica exigida por CHECK.
  const [phoneIdentity] = await tx<
    { column: string | null; index: string | null; check: string | null }[]
  >`
    SELECT
      (
        SELECT format_type(a.atttypid, a.atttypmod)
          || CASE WHEN a.attnotnull THEN ' NOT NULL' ELSE '' END
        FROM pg_attribute a
        WHERE a.attrelid = to_regclass('public.contacts')
          AND a.attname = 'phone_normalized' AND NOT a.attisdropped
      ) AS column,
      (
        SELECT indexdef FROM pg_indexes
        WHERE schemaname = 'public'
          AND indexname = 'contacts_organization_id_phone_normalized_key'
      ) AS index,
      (
        SELECT pg_get_constraintdef(oid) FROM pg_constraint
        WHERE conrelid = to_regclass('public.contacts')
          AND conname = 'contacts_phone_normalized_check'
      ) AS check
  `;
  findings.push(
    finding(
      "schema.contact-phone-identity",
      equal(phoneIdentity, EXPECTED_PHONE_IDENTITY),
      `phone_normalized: ${phoneIdentity?.column ?? "missing"}; unique index: ${phoneIdentity?.index ? "present" : "missing"}; check: ${phoneIdentity?.check ? "present" : "missing"}`,
    ),
  );

  // Policies (DEC-019, H1.1, H1.2, H1.3A): lectura y alta, con la forma de
  // referencia; ningún UPDATE ni DELETE, y ninguna alta de vehicles.
  const policies = await tx<Policy[]>`
    SELECT tablename AS table, policyname AS name, permissive,
      roles::text[] AS roles, cmd AS command, qual AS using,
      with_check AS "withCheck"
    FROM pg_policies WHERE schemaname = 'public'
    ORDER BY tablename, policyname
  `;
  findings.push(
    finding(
      "rls.policies",
      equal(policies, EXPECTED_POLICIES),
      `policies: ${list(policies.map((p) => `${p.table}.${p.name} ${p.command} TO ${p.roles.join("/")}`))}`,
    ),
  );

  // Schema private y private.user_org_ids() (ADR-001 §4).
  const [privateSchema] = await tx<
    {
      exists: boolean;
      owner: string | null;
      authenticated: boolean;
      anon: boolean;
      runtime: boolean;
    }[]
  >`
    SELECT n.oid IS NOT NULL AS exists, n.nspowner::regrole::text AS owner,
      coalesce(has_schema_privilege('authenticated', n.oid, 'USAGE'), false) AS authenticated,
      coalesce(has_schema_privilege('anon', n.oid, 'USAGE'), false) AS anon,
      coalesce(has_schema_privilege('app_runtime', n.oid, 'USAGE'), false) AS runtime
    FROM (SELECT 1) AS one
    LEFT JOIN pg_namespace n ON n.nspname = 'private'
  `;
  findings.push(
    finding(
      "private.schema",
      privateSchema?.exists === true &&
        privateSchema.owner === "postgres" &&
        privateSchema.authenticated &&
        !privateSchema.anon &&
        !privateSchema.runtime,
      privateSchema?.exists
        ? `owner ${privateSchema.owner}; USAGE authenticated=${privateSchema.authenticated}, anon=${privateSchema.anon}, app_runtime=${privateSchema.runtime}`
        : "schema private missing",
    ),
  );

  const [fn] = await tx<
    {
      exists: boolean;
      securityDefiner: boolean;
      volatility: string;
      config: string[] | null;
      owner: string;
      returns: string;
      returnsSet: boolean;
      publicExecute: boolean;
      authenticated: boolean;
      anon: boolean;
      runtime: boolean;
    }[]
  >`
    SELECT true AS exists, p.prosecdef AS "securityDefiner",
      p.provolatile::text AS volatility, p.proconfig AS config,
      p.proowner::regrole::text AS owner, p.prorettype::regtype::text AS returns,
      p.proretset AS "returnsSet",
      EXISTS (
        SELECT FROM aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
        WHERE a.grantee = 0 AND a.privilege_type = 'EXECUTE'
      ) AS "publicExecute",
      has_function_privilege('authenticated', p.oid, 'EXECUTE') AS authenticated,
      has_function_privilege('anon', p.oid, 'EXECUTE') AS anon,
      has_function_privilege('app_runtime', p.oid, 'EXECUTE') AS runtime
    FROM pg_proc p
    WHERE p.oid = to_regprocedure('private.user_org_ids()')
  `;
  findings.push(
    finding(
      "private.user_org_ids",
      fn?.exists === true &&
        fn.securityDefiner &&
        fn.volatility === "s" &&
        equal(fn.config, ['search_path=""']) &&
        fn.owner === "postgres" &&
        fn.returns === "uuid" &&
        fn.returnsSet &&
        !fn.publicExecute &&
        fn.authenticated &&
        !fn.anon &&
        !fn.runtime,
      fn
        ? `SECURITY DEFINER=${fn.securityDefiner}, volatility=${fn.volatility}, config=${list(fn.config ?? [])}, owner=${fn.owner}, EXECUTE PUBLIC=${fn.publicExecute} authenticated=${fn.authenticated} anon=${fn.anon} app_runtime=${fn.runtime}`
        : "private.user_org_ids() missing",
    ),
  );

  // app_runtime (ADR-001 §2, DEC-019).
  const [runtime] = await tx<
    {
      login: boolean;
      inherit: boolean;
      bypassRls: boolean;
      super: boolean;
      createRole: boolean;
      createDb: boolean;
      replication: boolean;
    }[]
  >`
    SELECT rolcanlogin AS login, rolinherit AS inherit, rolbypassrls AS "bypassRls",
      rolsuper AS super, rolcreaterole AS "createRole", rolcreatedb AS "createDb",
      rolreplication AS replication
    FROM pg_roles WHERE rolname = 'app_runtime'
  `;
  findings.push(
    finding(
      "app_runtime.attributes",
      equal(runtime, {
        login: true,
        inherit: false,
        bypassRls: false,
        super: false,
        createRole: false,
        createDb: false,
        replication: false,
      }),
      runtime
        ? `LOGIN=${runtime.login} INHERIT=${runtime.inherit} BYPASSRLS=${runtime.bypassRls} SUPERUSER=${runtime.super} CREATEROLE=${runtime.createRole} CREATEDB=${runtime.createDb} REPLICATION=${runtime.replication}`
        : "role app_runtime missing",
    ),
  );

  const memberships = await tx<
    { role: string; inherit: boolean; set: boolean; admin: boolean }[]
  >`
    SELECT m.roleid::regrole::text AS role, m.inherit_option AS inherit,
      m.set_option AS set, m.admin_option AS admin
    FROM pg_auth_members m
    WHERE m.member = (SELECT oid FROM pg_roles WHERE rolname = 'app_runtime')
    ORDER BY 1
  `;
  findings.push(
    finding(
      "app_runtime.membership",
      equal(memberships, [
        { role: "authenticated", inherit: false, set: true, admin: false },
      ]),
      `member of: ${list(memberships.map((m) => `${m.role} (INHERIT ${m.inherit}, SET ${m.set}, ADMIN ${m.admin})`))}`,
    ),
  );

  // Qué roles puede asumir o heredar app_runtime, por cualquier cadena.
  const reachable = await tx<{ role: string; set: boolean; usage: boolean }[]>`
    SELECT r.rolname AS role,
      pg_has_role('app_runtime', r.oid, 'SET') AS set,
      pg_has_role('app_runtime', r.oid, 'USAGE') AS usage
    FROM pg_roles r
    WHERE r.rolname <> 'app_runtime'
      AND EXISTS (SELECT FROM pg_roles WHERE rolname = 'app_runtime')
      AND (pg_has_role('app_runtime', r.oid, 'SET')
        OR pg_has_role('app_runtime', r.oid, 'USAGE'))
    ORDER BY 1
  `;
  findings.push(
    finding(
      "app_runtime.assumable-roles",
      equal(reachable, [{ role: "authenticated", set: true, usage: false }]),
      `SET: ${list(reachable.filter((r) => r.set).map((r) => r.role))}; inherited: ${list(reachable.filter((r) => r.usage).map((r) => r.role))}`,
    ),
  );

  // Privilegios sobre las tablas de public (ADR-001 §3.6).
  const runtimePrivileges = await tablePrivileges(tx, "app_runtime");
  const anonPrivileges = await tablePrivileges(tx, "anon");
  const authenticatedPrivileges = await tablePrivileges(tx, "authenticated");
  findings.push(
    finding(
      "privileges.app_runtime",
      runtimePrivileges.length === 0,
      `app_runtime on public tables: ${list(runtimePrivileges)}`,
    ),
    finding(
      "privileges.anon",
      anonPrivileges.length === 0,
      `anon on public tables: ${list(anonPrivileges)}`,
    ),
    finding(
      "privileges.authenticated",
      equal(authenticatedPrivileges, AUTHENTICATED_PRIVILEGES),
      `authenticated on public tables: ${list(authenticatedPrivileges)} (expected: SELECT on every table, INSERT on contacts and opportunities only; no UPDATE or DELETE)`,
    ),
  );

  const uncovered = await tx<{ grant: string }[]>`
    SELECT p.privilege || ' ' || c.relname AS grant
    FROM pg_class c
    CROSS JOIN unnest(ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE']) AS p(privilege)
    WHERE c.relnamespace = 'public'::regnamespace
      AND c.relkind IN ('r', 'p')
      AND has_table_privilege('authenticated', c.oid, p.privilege)
      AND NOT EXISTS (
        SELECT FROM pg_policies pol
        WHERE pol.schemaname = 'public' AND pol.tablename = c.relname
          AND pol.cmd IN (p.privilege, 'ALL')
          AND pol.roles && ARRAY['authenticated', 'public']::name[]
      )
    ORDER BY 1
  `;
  findings.push(
    finding(
      "privileges.policy-coverage",
      uncovered.length === 0,
      `authenticated privileges without policy: ${list(uncovered.map((u) => u.grant))}`,
    ),
  );

  const create = await tx<{ grant: string }[]>`
    SELECT r.rolname || ' CREATE ' || t.target AS grant
    FROM pg_roles r
    CROSS JOIN (VALUES ('database'), ('public'), ('private'), ('drizzle')) AS t(target)
    WHERE r.rolname IN ('anon', 'authenticated', 'app_runtime')
      AND CASE
        WHEN t.target = 'database'
          THEN has_database_privilege(r.oid, current_database(), 'CREATE')
        WHEN to_regnamespace(t.target) IS NULL THEN false
        ELSE has_schema_privilege(r.oid, to_regnamespace(t.target)::oid, 'CREATE')
      END
    ORDER BY 1
  `;
  findings.push(
    finding(
      "privileges.create",
      create.length === 0,
      `CREATE for anon/authenticated/app_runtime: ${list(create.map((c) => c.grant))}`,
    ),
  );

  const [securityDefiner] = await tx<{ functions: string[] | null }[]>`
    SELECT array_agg(oid::regprocedure::text ORDER BY 1) AS functions FROM pg_proc
    WHERE pronamespace = 'public'::regnamespace AND prosecdef
  `;
  findings.push(
    finding(
      "public.security-definer",
      (securityDefiner?.functions ?? []).length === 0,
      `SECURITY DEFINER functions in public: ${list(securityDefiner?.functions ?? [])}`,
    ),
  );

  // Objetos nuevos de postgres en public: sin grants por defecto para la
  // Data API (ADR-001 §3.6), ni por schema ni globales.
  const defaults = await tx<{ entry: string }[]>`
    SELECT CASE WHEN d.defaclnamespace = 0 THEN '*'
        ELSE d.defaclnamespace::regnamespace::text END || ' '
      || d.defaclobjtype::text || ' ' || e.grantee::regrole::text || '='
      || e.privilege_type AS entry
    FROM pg_default_acl d
    CROSS JOIN LATERAL aclexplode(d.defaclacl) e
    WHERE d.defaclrole = 'postgres'::regrole
      AND (d.defaclnamespace = 0 OR d.defaclnamespace = 'public'::regnamespace)
      AND e.grantee IN ('anon'::regrole, 'authenticated'::regrole)
    ORDER BY 1
  `;
  findings.push(
    finding(
      "privileges.default-acl",
      defaults.length === 0,
      `postgres default privileges for anon/authenticated in public: ${list(defaults.map((d) => d.entry))}`,
    ),
  );

  const [graphql] = await tx<{ installed: boolean }[]>`
    SELECT EXISTS (SELECT FROM pg_extension WHERE extname = 'pg_graphql') AS installed
  `;
  findings.push(
    finding(
      "adr-001.pg_graphql",
      graphql?.installed === false,
      graphql?.installed
        ? "pg_graphql is installed"
        : "pg_graphql not installed",
    ),
  );

  return findings;
}

/**
 * Informativo (no falla): privilegios de service_role sobre las tablas de
 * la app. Los otorgan los default privileges de Supabase; app_runtime no
 * puede asumir service_role (app_runtime.assumable-roles).
 */
export async function serviceRolePrivileges(
  tx: TransactionSql,
): Promise<string[]> {
  return tablePrivileges(tx, "service_role");
}

/*
 * Data API (ADR-001 §3.3 y §3.4, DEC-022). El contrato no es un status
 * concreto: cómo responde una Data API deshabilitada, no disponible o no
 * autorizada depende de Supabase (E2 vio 503 PGRST002). El contrato es que
 * ninguna respuesta exitosa exponga tablas, datos o schema de Porandú. Solo
 * se registran status y categoría: nunca el cuerpo.
 */

/** Tablas de la app; pg_graphql las expone como `<tabla>Collection`. */
const DATA_API_TABLES = [
  "organizations",
  "profiles",
  "memberships",
  "contacts",
  "opportunities",
  "vehicles",
];
/** Nombres que pg_graphql daría a los tipos de la app. */
const GRAPHQL_APP_TYPES = [
  "Organizations",
  "Profiles",
  "Memberships",
  "MembershipRole",
  "Contacts",
  "Opportunities",
  "Vehicles",
];

export type DataApiProbeKind =
  "rest-table" | "rest-root" | "graphql-collection" | "graphql-schema";

export function responseCategory(status: number): string {
  if (status >= 200 && status < 300) return "success";
  if (status >= 300 && status < 400) return "redirect";
  if (status === 401 || status === 403) return "unauthorized";
  if (status === 404) return "not found";
  if (status >= 400 && status < 500) return "rejected";
  return "unavailable";
}

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

/**
 * ¿La respuesta expone algo de Porandú? Solo una respuesta exitosa puede:
 * - REST por tabla: cualquier éxito (aun vacío, confirma la tabla expuesta);
 * - REST raíz (OpenAPI): si menciona una tabla de la app;
 * - GraphQL por colección: si `data.<tabla>Collection` no es null;
 * - GraphQL introspección: si aparece un tipo de la app.
 */
export function exposesPoranduData(
  kind: DataApiProbeKind,
  status: number,
  body: string,
  table?: string,
): boolean {
  if (status < 200 || status >= 300) return false;
  if (kind === "rest-table") return true;
  if (kind === "rest-root") {
    return DATA_API_TABLES.some((name) => body.includes(name));
  }
  let data: Record<string, unknown> | null = null;
  try {
    data = record(record(JSON.parse(body))?.data);
  } catch {
    return false;
  }
  if (kind === "graphql-collection") {
    return data?.[`${table}Collection`] != null;
  }
  const schema = record(data?.__schema);
  const types = Array.isArray(schema?.types) ? schema.types : [];
  return types.some((type) => {
    const name = record(type)?.name;
    return typeof name === "string" && GRAPHQL_APP_TYPES.includes(name);
  });
}

type ProbeResult = { label: string; status: number; exposed: boolean };

async function probe(
  label: string,
  kind: DataApiProbeKind,
  url: string,
  init: RequestInit,
  table?: string,
): Promise<ProbeResult> {
  const response = await fetch(url, {
    ...init,
    redirect: "manual",
    signal: AbortSignal.timeout(15_000),
  });
  const body = await response.text();
  return {
    label,
    status: response.status,
    exposed: exposesPoranduData(kind, response.status, body, table),
  };
}

function surfaceFinding(check: string, results: ProbeResult[]): Finding {
  const exposed = results.filter((r) => r.exposed);
  return finding(
    check,
    exposed.length === 0,
    results
      .map(
        (r) =>
          `${r.label}: ${r.status} ${responseCategory(r.status)}${r.exposed ? " (EXPOSES PORANDÚ DATA)" : ""}`,
      )
      .join(" · "),
  );
}

/**
 * La Data API no es una ruta lateral a las tablas de la app: ni con la
 * publishable key (anon) ni, si se pasa, con el access token de un usuario
 * sintético. Falla solo si una respuesta expone tablas, datos o schema.
 */
export async function probeDataApi(
  supabaseUrl: string,
  publishableKey: string,
  accessToken?: string,
): Promise<Finding[]> {
  const headers: Record<string, string> = { apikey: publishableKey };
  if (accessToken) headers.Authorization = `Bearer ${accessToken}`;
  const who = accessToken ? "authenticated" : "anon";
  const graphql = (query: string): RequestInit => ({
    method: "POST",
    headers: { ...headers, "Content-Type": "application/json" },
    body: JSON.stringify({ query }),
  });
  const rest: RequestInit = {
    headers: { ...headers, Accept: "application/json" },
  };

  const restResults = [
    await probe("root", "rest-root", `${supabaseUrl}/rest/v1/`, rest),
  ];
  const graphqlResults = [
    await probe(
      "schema",
      "graphql-schema",
      `${supabaseUrl}/graphql/v1`,
      graphql("{ __schema { types { name } } }"),
    ),
  ];
  for (const table of DATA_API_TABLES) {
    restResults.push(
      await probe(
        table,
        "rest-table",
        `${supabaseUrl}/rest/v1/${table}?select=*&limit=1`,
        rest,
      ),
    );
    graphqlResults.push(
      await probe(
        table,
        "graphql-collection",
        `${supabaseUrl}/graphql/v1`,
        graphql(
          `{ ${table}Collection(first: 1) { edges { node { __typename } } } }`,
        ),
        table,
      ),
    );
  }
  return [
    surfaceFinding(`data-api.rest (${who})`, restResults),
    surfaceFinding(`data-api.graphql (${who})`, graphqlResults),
  ];
}
