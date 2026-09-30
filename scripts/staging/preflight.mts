import type { TransactionSql } from "postgres";

import {
  compareHistory,
  expectedFootprint,
  pendingMismatch,
  type AppliedMigration,
  type HistoryStatus,
  type RepoMigration,
} from "./migrations.mts";
import { finding, type Finding } from "./report.mts";
import { SYNTHETIC_EMAIL_DOMAIN, SYNTHETIC_ORG_PREFIX } from "./synthetic.mts";

/*
 * Preflight de staging (solo lectura). Antes de cualquier operación
 * verifica que la base sea la esperada y que su estado sea exactamente el
 * que dejan las migraciones oficiales ya aplicadas: ni residuos de
 * experimentos ni objetos ajenos que una migración pudiera pisar.
 *
 * No limpia nada ni usa CASCADE: si algo no coincide, aborta y lo nombra.
 * Los hechos se leen en una transacción READ ONLY (readFacts) y se evalúan
 * con una función pura (evaluatePreflight).
 */

export const OPERATIONS = [
  "preflight",
  "migrate",
  "provision-runtime",
  "verify",
  "runtime-acceptance",
  "auth-tenant-acceptance",
  "cleanup-synthetic",
] as const;

export type Operation = (typeof OPERATIONS)[number];

export function parseOperation(raw: string | undefined): Operation {
  const operation = OPERATIONS.find((candidate) => candidate === raw);
  if (!operation) {
    throw new Error(
      `Unknown operation. Expected one of: ${OPERATIONS.join(", ")}.`,
    );
  }
  return operation;
}

/** Roles que nunca pueden crear objetos (ADR-001 §3.6). */
const NON_CREATING_ROLES = ["anon", "authenticated", "app_runtime"];
/** Roles de Supabase de los que dependen las migraciones. */
const API_ROLES = ["anon", "authenticated", "service_role"];
/** Lo único que drizzle-kit crea en su schema. */
const DRIZZLE_OBJECTS = ["__drizzle_migrations", "__drizzle_migrations_id_seq"];

type NamedObject = { name: string; kind: string };

export type PreflightFacts = Readonly<{
  server: {
    versionNum: number;
    version: string;
    database: string;
    sessionUser: string;
    currentUser: string;
    currentSuper: boolean;
    authSchema: boolean;
    authUsers: boolean;
    authUid: boolean;
    apiRoles: string[];
    pgGraphql: boolean;
    appRuntime: boolean;
    privateSchema: boolean;
    drizzleSchema: boolean;
  };
  /** Relaciones del schema `drizzle` (si existe). */
  drizzleObjects: NamedObject[];
  /** Historial de drizzle, o null si la tabla no existe. */
  history: AppliedMigration[] | null;
  public: {
    relations: NamedObject[];
    types: NamedObject[];
    functions: { name: string; extension: string | null }[];
    policies: string[];
    extensions: string[];
  };
  createPrivileges: string[];
  /** Solo si se pidieron: datos sintéticos de corridas anteriores. */
  synthetic: { users: number; organizations: number } | null;
}>;

export async function readFacts(
  tx: TransactionSql,
  options: { synthetic: boolean },
): Promise<PreflightFacts> {
  const [server] = await tx<PreflightFacts["server"][]>`
    SELECT
      current_setting('server_version_num')::int AS "versionNum",
      current_setting('server_version') AS version,
      current_database() AS database,
      session_user AS "sessionUser",
      current_user AS "currentUser",
      (SELECT rolsuper FROM pg_roles WHERE rolname = current_user) AS "currentSuper",
      to_regnamespace('auth') IS NOT NULL AS "authSchema",
      to_regclass('auth.users') IS NOT NULL AS "authUsers",
      to_regprocedure('auth.uid()') IS NOT NULL AS "authUid",
      coalesce((
        SELECT array_agg(rolname::text ORDER BY rolname) FROM pg_roles
        WHERE rolname = ANY(${API_ROLES}::text[])
      ), '{}') AS "apiRoles",
      EXISTS (SELECT FROM pg_extension WHERE extname = 'pg_graphql') AS "pgGraphql",
      EXISTS (SELECT FROM pg_roles WHERE rolname = 'app_runtime') AS "appRuntime",
      to_regnamespace('private') IS NOT NULL AS "privateSchema",
      to_regnamespace('drizzle') IS NOT NULL AS "drizzleSchema"
  `;
  if (!server) throw new Error("preflight: no server facts");

  let drizzleObjects: NamedObject[] = [];
  let history: AppliedMigration[] | null = null;
  if (server.drizzleSchema) {
    drizzleObjects = await tx<NamedObject[]>`
      SELECT relname AS name, relkind::text AS kind FROM pg_class
      WHERE relnamespace = 'drizzle'::regnamespace AND relkind NOT IN ('i', 't')
      UNION ALL
      SELECT p.oid::regprocedure::text, 'function' FROM pg_proc p
      WHERE p.pronamespace = 'drizzle'::regnamespace
      UNION ALL
      SELECT t.typname, 'type' FROM pg_type t
      LEFT JOIN pg_class c ON c.oid = t.typrelid
      WHERE t.typnamespace = 'drizzle'::regnamespace
        AND NOT EXISTS (SELECT FROM pg_type e WHERE e.typarray = t.oid)
        AND (t.typrelid = 0 OR c.relkind = 'c')
      ORDER BY 1
    `;
    if (drizzleObjects.some((o) => o.name === "__drizzle_migrations")) {
      const rows = await tx<{ id: number; hash: string; createdAt: string }[]>`
        SELECT id, hash, created_at::text AS "createdAt"
        FROM drizzle.__drizzle_migrations ORDER BY created_at, id
      `;
      history = rows.map((row) => ({
        id: row.id,
        hash: row.hash,
        createdAt: Number(row.createdAt),
      }));
    }
  }

  const relations = await tx<NamedObject[]>`
    SELECT c.relname AS name, c.relkind::text AS kind
    FROM pg_class c
    WHERE c.relnamespace = 'public'::regnamespace
      AND c.relkind IN ('r', 'p', 'v', 'm', 'f', 'S')
      -- Una secuencia de una columna serial/identity es parte de su tabla.
      AND NOT (c.relkind = 'S' AND EXISTS (
        SELECT FROM pg_depend d
        WHERE d.classid = 'pg_class'::regclass AND d.objid = c.oid
          AND d.deptype IN ('a', 'i')
      ))
    ORDER BY 1
  `;
  const types = await tx<NamedObject[]>`
    SELECT t.typname AS name, t.typtype::text AS kind
    FROM pg_type t
    LEFT JOIN pg_class c ON c.oid = t.typrelid
    WHERE t.typnamespace = 'public'::regnamespace
      AND NOT EXISTS (SELECT FROM pg_type e WHERE e.typarray = t.oid)
      AND (t.typrelid = 0 OR c.relkind = 'c')
    ORDER BY 1
  `;
  const functions = await tx<{ name: string; extension: string | null }[]>`
    SELECT p.oid::regprocedure::text AS name, (
      SELECT e.extname FROM pg_depend d
      JOIN pg_extension e ON e.oid = d.refobjid
      WHERE d.classid = 'pg_proc'::regclass AND d.objid = p.oid AND d.deptype = 'e'
    ) AS extension
    FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace
    ORDER BY 1
  `;
  const policies = await tx<{ name: string }[]>`
    SELECT tablename || '.' || policyname AS name FROM pg_policies
    WHERE schemaname = 'public' ORDER BY 1
  `;
  const extensions = await tx<{ name: string }[]>`
    SELECT extname AS name FROM pg_extension
    WHERE extnamespace = 'public'::regnamespace ORDER BY 1
  `;
  const createPrivileges = await tx<{ grant: string }[]>`
    SELECT r.rolname || ' CREATE ' || t.target AS grant
    FROM pg_roles r
    CROSS JOIN (VALUES ('database'), ('public'), ('private'), ('drizzle')) AS t(target)
    WHERE r.rolname = ANY(${NON_CREATING_ROLES}::text[])
      AND CASE
        WHEN t.target = 'database'
          THEN has_database_privilege(r.oid, current_database(), 'CREATE')
        WHEN to_regnamespace(t.target) IS NULL THEN false
        ELSE has_schema_privilege(r.oid, to_regnamespace(t.target)::oid, 'CREATE')
      END
    ORDER BY 1
  `;

  let synthetic: PreflightFacts["synthetic"] = null;
  if (options.synthetic) {
    const [users] = await tx<{ count: number }[]>`
      SELECT count(*)::int AS count FROM auth.users
      WHERE email LIKE ${`%@${SYNTHETIC_EMAIL_DOMAIN}`}
    `;
    let organizations = 0;
    if ((await tx`SELECT to_regclass('public.organizations') AS t`)[0]?.t) {
      const [orgs] = await tx<{ count: number }[]>`
        SELECT count(*)::int AS count FROM public.organizations
        WHERE starts_with(name, ${SYNTHETIC_ORG_PREFIX})
      `;
      organizations = orgs?.count ?? 0;
    }
    synthetic = { users: users?.count ?? 0, organizations };
  }

  return {
    server,
    drizzleObjects,
    history,
    public: {
      relations,
      types,
      functions,
      policies: policies.map((p) => p.name),
      extensions: extensions.map((e) => e.name),
    },
    createPrivileges: createPrivileges.map((g) => g.grant),
    synthetic,
  };
}

export type PreflightResult = Readonly<{
  findings: Finding[];
  history: HistoryStatus;
}>;

function list(values: readonly string[]): string {
  return values.length === 0 ? "none" : values.join(", ");
}

function sameSet(a: readonly string[], b: readonly string[]): boolean {
  const left = [...a].sort();
  const right = [...b].sort();
  return left.length === right.length && left.every((v, i) => v === right[i]);
}

export function evaluatePreflight(
  facts: PreflightFacts,
  repo: readonly RepoMigration[],
  operation: Operation,
  expectedMigrations: readonly string[],
  folder?: URL,
): PreflightResult {
  const { server } = facts;
  const findings: Finding[] = [];

  findings.push(
    finding(
      "postgres.version",
      server.versionNum >= 170000 && server.versionNum < 180000,
      `PostgreSQL ${server.version}`,
    ),
    finding(
      "postgres.database",
      server.database === "postgres",
      `database ${server.database}`,
    ),
    finding(
      "postgres.identity",
      server.sessionUser === "postgres" && server.currentUser === "postgres",
      `session_user ${server.sessionUser}, current_user ${server.currentUser}`,
    ),
    // En Supabase, postgres no es superuser: si lo es, no es el entorno esperado.
    finding(
      "postgres.not-superuser",
      server.currentSuper === false,
      server.currentSuper
        ? "postgres is a superuser"
        : "postgres is not a superuser",
    ),
    finding(
      "supabase.auth",
      server.authSchema && server.authUsers && server.authUid,
      "auth schema, auth.users and auth.uid()",
    ),
    finding(
      "supabase.api-roles",
      sameSet(server.apiRoles, API_ROLES),
      `roles: ${list(server.apiRoles)}`,
    ),
    // ADR-001 §3.4: pg_graphql no se habilita en H0 (Hallazgo 1).
    finding(
      "adr-001.pg_graphql",
      !server.pgGraphql,
      server.pgGraphql ? "pg_graphql is installed" : "pg_graphql not installed",
    ),
  );

  // Historial de drizzle.
  const unexpectedDrizzle = facts.drizzleObjects
    .map((o) => o.name)
    .filter((name) => !DRIZZLE_OBJECTS.includes(name));
  let history: HistoryStatus;
  if (unexpectedDrizzle.length > 0) {
    history = {
      kind: "inconsistent",
      reason: `unexpected objects in schema drizzle: ${list(unexpectedDrizzle)}.`,
    };
  } else if (server.drizzleSchema && facts.history === null) {
    history = {
      kind: "inconsistent",
      reason: "schema drizzle exists without drizzle.__drizzle_migrations.",
    };
  } else {
    history = compareHistory(repo, facts.history ?? []);
  }
  if (history.kind === "consistent") {
    const emptyTable = server.drizzleSchema && history.applied.length === 0;
    findings.push(
      finding(
        "migrations.history",
        true,
        `applied: ${list(history.applied.map((m) => m.tag))}; pending: ${list(history.pending.map((m) => m.tag))}` +
          (emptyTable ? " (empty drizzle history table)" : ""),
      ),
    );
  } else {
    findings.push(finding("migrations.history", false, history.reason));
  }

  // Lo que hay en public tiene que ser exactamente lo que dejan las
  // migraciones aplicadas (snapshot de drizzle-kit de la última).
  if (history.kind === "consistent") {
    const expected = expectedFootprint(history.applied, folder);
    const relations = facts.public.relations.map((r) => r.name);
    const enums = facts.public.types
      .filter((t) => t.kind === "e")
      .map((t) => t.name);
    const otherTypes = facts.public.types
      .filter((t) => t.kind !== "e")
      .map((t) => `${t.name} (${t.kind})`);
    findings.push(
      finding(
        "public.relations",
        sameSet(relations, expected.tables),
        `found: ${list(relations)}; expected: ${list(expected.tables)}`,
      ),
      finding(
        "public.types",
        sameSet(enums, expected.enums) && otherTypes.length === 0,
        `found: ${list([...enums, ...otherTypes])}; expected: ${list(expected.enums)}`,
      ),
      finding(
        "public.functions",
        facts.public.functions.length === 0,
        `found: ${list(
          facts.public.functions.map((f) =>
            f.extension ? `${f.name} [extension ${f.extension}]` : f.name,
          ),
        )}; expected: none`,
      ),
      finding(
        "public.policies",
        sameSet(facts.public.policies, expected.policies),
        `found: ${list(facts.public.policies)}; expected: ${list(expected.policies)}`,
      ),
      finding(
        "public.extensions",
        facts.public.extensions.length === 0,
        `found: ${list(facts.public.extensions)}; expected: none`,
      ),
    );

    // Sin historial, tampoco puede quedar nada de 0001 (schema private,
    // rol app_runtime): serían residuos de un experimento anterior.
    if (history.applied.length === 0) {
      findings.push(
        finding(
          "residue.private-schema",
          !server.privateSchema,
          server.privateSchema
            ? "schema private exists without migration history"
            : "absent",
        ),
        finding(
          "residue.app_runtime",
          !server.appRuntime,
          server.appRuntime
            ? "role app_runtime exists without migration history"
            : "absent",
        ),
      );
    }
  }

  // 0001 rechaza la migración si alguno de estos roles puede crear objetos.
  findings.push(
    finding(
      "privileges.create",
      facts.createPrivileges.length === 0,
      `anon/authenticated/app_runtime CREATE: ${list(facts.createPrivileges)}`,
    ),
  );

  if (history.kind === "consistent") {
    if (operation === "migrate") {
      const mismatch = pendingMismatch(history.pending, expectedMigrations);
      findings.push(
        finding(
          "operation.pending",
          mismatch === null,
          mismatch ?? `will apply: ${list(history.pending.map((m) => m.tag))}`,
        ),
      );
    } else if (operation !== "preflight") {
      findings.push(
        finding(
          "operation.up-to-date",
          history.pending.length === 0,
          history.pending.length === 0
            ? "staging is at the repository head"
            : `pending migrations: ${list(history.pending.map((m) => m.tag))}. Run migrate first.`,
        ),
      );
    }
  }

  if (operation === "auth-tenant-acceptance") {
    const synthetic = facts.synthetic;
    findings.push(
      finding(
        "synthetic.leftovers",
        synthetic !== null &&
          synthetic.users === 0 &&
          synthetic.organizations === 0,
        synthetic === null
          ? "not checked"
          : `users: ${synthetic.users}, organizations: ${synthetic.organizations} (run cleanup-synthetic if > 0)`,
      ),
    );
  }

  return { findings, history };
}
