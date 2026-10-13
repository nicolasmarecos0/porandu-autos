import { randomBytes, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import {
  migrateCommand,
  preflightCommand,
  provisionRuntimeCommand,
  type CommandContext,
} from "../../scripts/staging/commands.mts";
import { connect, readOnly } from "../../scripts/staging/connect.mts";
import { runOfficialMigrations } from "../../scripts/staging/migrate.mts";
import { readRepoMigrations } from "../../scripts/staging/migrations.mts";
import {
  evaluatePreflight,
  readFacts,
  type Operation,
  type PreflightResult,
} from "../../scripts/staging/preflight.mts";
import {
  checkRuntimeLogin,
  provisionRuntimePassword,
} from "../../scripts/staging/provision.mts";
import {
  parseScramVerifier,
  SCRAM_VERIFIER,
  scramSha256Verifier,
} from "../../scripts/staging/scram.mts";
import {
  cleanupSynthetic,
  listSyntheticUsers,
  syntheticAppMetadata,
  syntheticEmail,
  syntheticOrganizationName,
  type SyntheticUserAdmin,
} from "../../scripts/staging/synthetic.mts";
import { verifyCatalog } from "../../scripts/staging/verify.mts";
import { describeRuntimeAcceptance } from "../staging/support/runtime-spec";
import {
  migrateUpTo,
  startTestServer,
  type TestDatabase,
  type TestServer,
} from "./support/postgres";
import { closeRuntimePool } from "./support/runtime";

// `server-only` lo resuelve Next; en Vitest (entorno node) es un no-op.
vi.mock("server-only", () => ({}));

/*
 * Tooling de staging (scripts/staging/) contra el PostgreSQL 17 desechable:
 * el preflight frente a residuos, la migración oficial con `pnpm db:migrate`,
 * la verificación post-migración, el provisioning de app_runtime, el spec
 * del acceptance del runtime y la limpieza de datos sintéticos. Nunca
 * staging: acá se valida el mismo código que el workflow corre allá.
 */

const REPO = readRepoMigrations();
const ALL_TAGS = REPO.map((migration) => migration.tag);
// La base del harness no se llama `postgres`: es lo único que difiere de
// Supabase en el preflight.
const HARNESS_ONLY = ["postgres.database"];

let server: TestServer;
/** Base con las migraciones oficiales aplicadas por el tooling. */
let migrated: TestDatabase;
let runtimePassword = "";

beforeAll(async () => {
  server = await startTestServer();
});

afterAll(async () => {
  await closeRuntimePool();
  vi.unstubAllEnvs();
  await server?.close();
});

async function preflightOf(
  db: TestDatabase,
  operation: Operation,
  expected: string[] = [],
  synthetic = false,
): Promise<PreflightResult> {
  const sql = connect(db.migrationUrl);
  try {
    const facts = await readOnly(sql, (tx) => readFacts(tx, { synthetic }));
    return evaluatePreflight(facts, REPO, operation, expected);
  } finally {
    await sql.end({ timeout: 5 });
  }
}

function failures(result: PreflightResult): string[] {
  return result.findings.filter((f) => !f.ok).map((f) => f.check);
}

function runtimeUrl(db: TestDatabase, password: string): string {
  const url = new URL(db.migrationUrl);
  url.username = "app_runtime";
  url.password = password;
  return url.toString();
}

async function storedPassword(db: TestDatabase): Promise<string | null> {
  const [row] = await db.admin<{ password: string | null }[]>`
    SELECT rolpassword AS password FROM pg_authid WHERE rolname = 'app_runtime'
  `;
  return row?.password ?? null;
}

describe("preflight del primer rollout (base sin migraciones)", () => {
  it("base limpia: pasa y quedan pendientes todas las migraciones oficiales", async () => {
    const db = await server.createDatabase();
    const result = await preflightOf(db, "migrate", ALL_TAGS);
    expect(failures(result)).toEqual(HARNESS_ONLY);
    expect(result.history).toEqual({
      kind: "consistent",
      applied: [],
      pending: REPO,
    });
    expect(ALL_TAGS).toEqual([
      "0000_saas_core_schema",
      "0001_tenant_isolation",
      "0002_opportunities_persistence",
      "0003_contact_identity_opportunity_create",
      "0004_vehicles_stock_persistence",
      "0005_vehicle_quick_create",
      "0006_vehicle_availability",
      "0007_opportunity_demand_facts",
      "0008_opportunity_stages",
      "0009_opportunity_notes_vehicle_link",
      "0010_opportunity_closure_metadata",
      "0011_conversations_and_activity_trigger",
    ]);
  });

  it("migrate exige declarar exactamente las migraciones pendientes", async () => {
    const db = await server.createDatabase();
    for (const expected of [
      [],
      ["0000_saas_core_schema"],
      [...ALL_TAGS].reverse(),
    ]) {
      expect(failures(await preflightOf(db, "migrate", expected))).toEqual([
        ...HARNESS_ONLY,
        "operation.pending",
      ]);
    }
  });

  it("las demás operaciones exigen staging al día con el repositorio", async () => {
    const db = await server.createDatabase();
    for (const operation of [
      "provision-runtime",
      "verify",
      "runtime-acceptance",
    ] as const) {
      expect(failures(await preflightOf(db, operation))).toEqual([
        ...HARNESS_ONLY,
        "operation.up-to-date",
      ]);
    }
  });

  it.each([
    [
      "tabla en public",
      "CREATE TABLE public.organizations (id uuid)",
      "public.relations",
    ],
    [
      "vista en public",
      "CREATE VIEW public.probe AS SELECT 1 AS x",
      "public.relations",
    ],
    [
      "secuencia suelta en public",
      "CREATE SEQUENCE public.probe_seq",
      "public.relations",
    ],
    [
      "enum en public",
      "CREATE TYPE public.membership_role AS ENUM ('admin')",
      "public.types",
    ],
    [
      "función en public",
      "CREATE FUNCTION public.probe() RETURNS int LANGUAGE sql AS 'SELECT 1'",
      "public.functions",
    ],
    ["schema private", "CREATE SCHEMA private", "residue.private-schema"],
    [
      "historial de otro experimento",
      `SET LOCAL ROLE postgres;
       CREATE SCHEMA drizzle;
       CREATE TABLE drizzle.__drizzle_migrations (id serial PRIMARY KEY, hash text NOT NULL, created_at bigint);
       INSERT INTO drizzle.__drizzle_migrations (hash, created_at) VALUES ('spike', 1)`,
      "migrations.history",
    ],
    [
      "objetos ajenos en drizzle",
      `SET LOCAL ROLE postgres;
       CREATE SCHEMA drizzle;
       CREATE TABLE drizzle.probe (id int)`,
      "migrations.history",
    ],
    [
      "anon puede crear en public",
      "GRANT CREATE ON SCHEMA public TO anon",
      "privileges.create",
    ],
  ])("aborta ante un estado inesperado: %s", async (_, ddl, check) => {
    const db = await server.createDatabase();
    await db.admin.begin((tx) => tx.unsafe(ddl));
    const result = await preflightOf(db, "migrate", ALL_TAGS);
    expect(failures(result)).toContain(check);
  });

  it("un historial de drizzle vacío (migración que falló antes) cuenta como sin historial", async () => {
    const db = await server.createDatabase();
    // Lo que drizzle-kit crea antes de la transacción de las migraciones.
    await db.admin.begin((tx) =>
      tx.unsafe(`
        SET LOCAL ROLE postgres;
        CREATE SCHEMA drizzle;
        CREATE TABLE drizzle.__drizzle_migrations (id serial PRIMARY KEY, hash text NOT NULL, created_at bigint);
      `),
    );
    const result = await preflightOf(db, "migrate", ALL_TAGS);
    expect(failures(result)).toEqual(HARNESS_ONLY);
    expect(
      result.findings.find((f) => f.check === "migrations.history")?.detail,
    ).toContain("empty drizzle history table");
  });
});

describe("migración que falla", () => {
  it("es atómica y su salida no incluye credenciales", async () => {
    const db = await server.createDatabase();
    // Un objeto que choca con 0000 (el preflight lo habría frenado antes).
    await db.admin`CREATE TABLE public.profiles (id uuid)`;
    const password = new URL(db.migrationUrl).password;
    const error = await runOfficialMigrations(db.migrationUrl, [password]).then(
      () => null,
      (e: unknown) => e as Error,
    );
    expect(error?.message).toMatch(/pnpm db:migrate failed/);
    expect(error?.message).not.toContain(password);

    const [state] = await db.admin<
      { organizations: string | null; history: number }[]
    >`
      SELECT to_regclass('public.organizations')::text AS organizations,
        (SELECT count(*)::int FROM drizzle.__drizzle_migrations) AS history
    `;
    expect(state).toEqual({ organizations: null, history: 0 });
  });
});

describe("comandos del workflow (scripts/staging/commands.mts)", () => {
  let db: TestDatabase;
  const lines: string[] = [];
  let ctx: CommandContext;

  beforeAll(async () => {
    db = await server.createDatabase();
    const password = new URL(db.migrationUrl).password;
    ctx = {
      migrationUrl: db.migrationUrl,
      supabaseUrl: "http://127.0.0.1:9",
      secrets: [password],
      log: (line) => lines.push(line),
    };
  });

  it("migrate no aplica nada si lo pendiente no es exactamente lo declarado", async () => {
    // La base del harness no se llama `postgres`: el preflight ya falla por
    // eso. Acá importa que no se aplique nada.
    expect(
      await migrateCommand({
        ...ctx,
        expectedMigrations: ["0001_tenant_isolation"],
      }),
    ).toBe(false);
    const [row] = await db.admin<{ drizzle: boolean }[]>`
      SELECT to_regnamespace('drizzle') IS NOT NULL AS drizzle
    `;
    expect(row?.drizzle).toBe(false);
    expect(lines.join("\n")).toContain("✗ operation.pending");
  });

  it("el preflight imprime cada verificación, sin credenciales", async () => {
    lines.length = 0;
    expect(await preflightCommand(ctx, "preflight")).toBe(false);
    const output = lines.join("\n");
    expect(output).toContain("✗ postgres.database");
    expect(output).toContain(
      "✓ migrations.history — applied: none; pending: 0000_saas_core_schema, 0001_tenant_isolation, 0002_opportunities_persistence, 0003_contact_identity_opportunity_create, 0004_vehicles_stock_persistence, 0005_vehicle_quick_create, 0006_vehicle_availability, 0007_opportunity_demand_facts, 0008_opportunity_stages, 0009_opportunity_notes_vehicle_link, 0010_opportunity_closure_metadata",
    );
    expect(output).not.toContain(ctx.secrets[0]!);
    expect(output).not.toMatch(/postgres(ql)?:\/\//);
  });

  it("provision-runtime exige staging al día y no toca app_runtime si no lo está", async () => {
    await expect(provisionRuntimeCommand(ctx)).rejects.toThrow(
      /requires the runtime credential/,
    );
    expect(
      await provisionRuntimeCommand({
        ...ctx,
        runtimePassword: randomBytes(32).toString("hex"),
        runtimeUrl: runtimeUrl(db, "unused"),
      }),
    ).toBe(false);
  });
});

describe("migración oficial y verificación post-migración", () => {
  beforeAll(async () => {
    migrated = await server.createDatabase();
  });

  it("aplica las migraciones oficiales con pnpm db:migrate y deja el historial exacto", async () => {
    const password = new URL(migrated.migrationUrl).password;
    const output = await runOfficialMigrations(migrated.migrationUrl, [
      password,
    ]);
    expect(output).not.toContain(password);
    expect(output).not.toMatch(/postgres(ql)?:\/\/[^*]/);

    const result = await preflightOf(migrated, "verify");
    expect(failures(result)).toEqual(HARNESS_ONLY);
    expect(result.history).toEqual({
      kind: "consistent",
      applied: REPO,
      pending: [],
    });
  });

  it("todas las verificaciones de catálogo pasan", async () => {
    const sql = connect(migrated.migrationUrl);
    try {
      const findings = await readOnly(sql, (tx) => verifyCatalog(tx, REPO));
      expect(findings.filter((f) => !f.ok)).toEqual([]);
      expect(findings.map((f) => f.check)).toEqual([
        "migrations.history",
        "schema.tables",
        "schema.rls",
        "schema.membership_role",
        "schema.tenant-scoped",
        "schema.contact-phone-identity",
        "rls.policies",
        "schema.demand-facts-chain",
        "schema.opportunity-stages",
        "schema.opportunity-notes",
        "schema.messages",
        "schema.activity-touch",
        "private.schema",
        "private.user_org_ids",
        "app_runtime.attributes",
        "app_runtime.membership",
        "app_runtime.assumable-roles",
        "privileges.app_runtime",
        "privileges.anon",
        "privileges.authenticated",
        "privileges.authenticated-update-columns",
        "privileges.policy-coverage",
        "privileges.service_role-demand-facts",
        "privileges.service_role-opportunity-notes",
        "privileges.service_role-messages",
        "privileges.create",
        "public.security-definer",
        "privileges.default-acl",
        "adr-001.pg_graphql",
      ]);
    } finally {
      await sql.end({ timeout: 5 });
    }
  });

  it("sin nada pendiente, migrate no tiene nada que aplicar y aborta", async () => {
    expect(
      failures(await preflightOf(migrated, "migrate", ALL_TAGS)),
    ).toContain("operation.pending");
  });

  it("detecta un historial que no coincide con los archivos del repositorio", async () => {
    await migrated.admin`
      UPDATE drizzle.__drizzle_migrations SET hash = 'edited' WHERE created_at = ${REPO[0]!.when}
    `;
    try {
      expect(failures(await preflightOf(migrated, "verify"))).toContain(
        "migrations.history",
      );
    } finally {
      await migrated.admin`
        UPDATE drizzle.__drizzle_migrations SET hash = ${REPO[0]!.hash}
        WHERE created_at = ${REPO[0]!.when}
      `;
    }
  });

  it("detecta objetos ajenos a las migraciones", async () => {
    await migrated.admin`CREATE TABLE public.extra (id int)`;
    try {
      expect(failures(await preflightOf(migrated, "verify"))).toEqual([
        ...HARNESS_ONLY,
        "public.relations",
      ]);
    } finally {
      await migrated.admin`DROP TABLE public.extra`;
    }
  });

  it("la verificación detecta grants de escritura y roles asumibles de más", async () => {
    await migrated.admin.unsafe(`
      GRANT INSERT ON public.organizations TO authenticated;
      GRANT UPDATE ON public.contacts TO authenticated;
      GRANT anon TO app_runtime;
    `);
    try {
      const sql = connect(migrated.migrationUrl);
      const findings = await readOnly(sql, (tx) => verifyCatalog(tx, REPO));
      await sql.end({ timeout: 5 });
      expect(findings.filter((f) => !f.ok).map((f) => f.check)).toEqual([
        "app_runtime.membership",
        "app_runtime.assumable-roles",
        "privileges.authenticated",
        "privileges.authenticated-update-columns",
        "privileges.policy-coverage",
      ]);
    } finally {
      await migrated.admin.unsafe(`
        REVOKE INSERT ON public.organizations FROM authenticated;
        REVOKE UPDATE ON public.contacts FROM authenticated;
        REVOKE anon FROM app_runtime;
      `);
    }
  });

  it("la verificación detecta una identidad telefónica sin unicidad o una alta sin WITH CHECK", async () => {
    await migrated.admin.unsafe(`
      DROP INDEX public.contacts_organization_id_phone_normalized_key;
      ALTER POLICY opportunities_insert_member ON public.opportunities WITH CHECK (true);
    `);
    try {
      const sql = connect(migrated.migrationUrl);
      const findings = await readOnly(sql, (tx) => verifyCatalog(tx, REPO));
      await sql.end({ timeout: 5 });
      expect(findings.filter((f) => !f.ok).map((f) => f.check)).toEqual([
        "schema.contact-phone-identity",
        "rls.policies",
      ]);
    } finally {
      await migrated.admin.unsafe(`
        CREATE UNIQUE INDEX contacts_organization_id_phone_normalized_key
          ON public.contacts USING btree (organization_id, phone_normalized)
          WHERE phone_normalized IS NOT NULL;
        ALTER POLICY opportunities_insert_member ON public.opportunities
          WITH CHECK (organization_id IN (SELECT private.user_org_ids()) AND stage = 'new');
      `);
    }
    const sql = connect(migrated.migrationUrl);
    try {
      const findings = await readOnly(sql, (tx) => verifyCatalog(tx, REPO));
      expect(findings.filter((f) => !f.ok)).toEqual([]);
    } finally {
      await sql.end({ timeout: 5 });
    }
  });

  it("la verificación detecta un alta de vehicles fuera de preparación y una edición de vehicles más allá de status (H1.3C)", async () => {
    await migrated.admin.unsafe(`
      ALTER POLICY vehicles_insert_member ON public.vehicles
        WITH CHECK (organization_id IN (SELECT private.user_org_ids()));
      GRANT UPDATE ON public.vehicles TO authenticated;
    `);
    try {
      const sql = connect(migrated.migrationUrl);
      const findings = await readOnly(sql, (tx) => verifyCatalog(tx, REPO));
      await sql.end({ timeout: 5 });
      // El UPDATE de tabla se ve igual que el de columna en la lista de
      // privilegios: lo detecta la verificación por columna.
      expect(findings.filter((f) => !f.ok).map((f) => f.check)).toEqual([
        "rls.policies",
        "privileges.authenticated-update-columns",
      ]);
    } finally {
      // Revocar el UPDATE de tabla revoca también el de columna: se repone.
      await migrated.admin.unsafe(`
        ALTER POLICY vehicles_insert_member ON public.vehicles
          WITH CHECK (organization_id IN (SELECT private.user_org_ids()) AND status = 'in_preparation');
        REVOKE UPDATE ON public.vehicles FROM authenticated;
        GRANT UPDATE (status, updated_at) ON public.vehicles TO authenticated;
      `);
    }
    const sql = connect(migrated.migrationUrl);
    try {
      const findings = await readOnly(sql, (tx) => verifyCatalog(tx, REPO));
      expect(findings.filter((f) => !f.ok)).toEqual([]);
    } finally {
      await sql.end({ timeout: 5 });
    }
  });

  it("la verificación detecta una cadena humana sin root único y un service_role que puede editar la demanda (H1.4)", async () => {
    await migrated.admin.unsafe(`
      DROP INDEX public.opportunity_demand_facts_member_root_key;
      GRANT UPDATE, DELETE ON public.opportunity_demand_facts TO service_role;
    `);
    try {
      const sql = connect(migrated.migrationUrl);
      const findings = await readOnly(sql, (tx) => verifyCatalog(tx, REPO));
      await sql.end({ timeout: 5 });
      expect(findings.filter((f) => !f.ok).map((f) => f.check)).toEqual([
        "schema.demand-facts-chain",
        "privileges.service_role-demand-facts",
      ]);
    } finally {
      await migrated.admin.unsafe(`
        CREATE UNIQUE INDEX opportunity_demand_facts_member_root_key
          ON public.opportunity_demand_facts USING btree (organization_id, opportunity_id, fact)
          WHERE source_kind = 'member' AND previous_member_fact_id IS NULL;
        REVOKE UPDATE, DELETE ON public.opportunity_demand_facts FROM service_role;
      `);
    }
    const sql = connect(migrated.migrationUrl);
    try {
      const findings = await readOnly(sql, (tx) => verifyCatalog(tx, REPO));
      expect(findings.filter((f) => !f.ok)).toEqual([]);
    } finally {
      await sql.end({ timeout: 5 });
    }
  });

  it("la verificación detecta un trigger de transiciones deshabilitado, un motivo de pérdida sin CHECK y una edición de opportunities más allá de la etapa (H1.6)", async () => {
    await migrated.admin.unsafe(`
      ALTER TABLE public.opportunities DISABLE TRIGGER opportunities_stage_transition;
      ALTER TABLE public.opportunities DROP CONSTRAINT opportunities_loss_reason_stage_check;
      GRANT UPDATE (last_activity_at) ON public.opportunities TO authenticated;
    `);
    try {
      const sql = connect(migrated.migrationUrl);
      const findings = await readOnly(sql, (tx) => verifyCatalog(tx, REPO));
      await sql.end({ timeout: 5 });
      expect(findings.filter((f) => !f.ok).map((f) => f.check)).toEqual([
        "schema.opportunity-stages",
        "privileges.authenticated-update-columns",
      ]);
    } finally {
      await migrated.admin.unsafe(`
        ALTER TABLE public.opportunities ENABLE TRIGGER opportunities_stage_transition;
        ALTER TABLE public.opportunities ADD CONSTRAINT opportunities_loss_reason_stage_check
          CHECK ((stage = 'lost' AND loss_reason IS NOT NULL) OR (stage <> 'lost' AND loss_reason IS NULL));
        REVOKE UPDATE (last_activity_at) ON public.opportunities FROM authenticated;
      `);
    }
    const sql = connect(migrated.migrationUrl);
    try {
      const findings = await readOnly(sql, (tx) => verifyCatalog(tx, REPO));
      expect(findings.filter((f) => !f.ok)).toEqual([]);
    } finally {
      await sql.end({ timeout: 5 });
    }
  });

  it("la verificación detecta una unidad vinculada sin CHECK de etapa, una bitácora sin CHECK del texto y un service_role que puede borrar notas (Hito 2)", async () => {
    await migrated.admin.unsafe(`
      ALTER TABLE public.opportunities DROP CONSTRAINT opportunities_vehicle_stage_check;
      ALTER TABLE public.opportunity_notes DROP CONSTRAINT opportunity_notes_body_check;
      GRANT DELETE ON public.opportunity_notes TO service_role;
    `);
    try {
      const sql = connect(migrated.migrationUrl);
      const findings = await readOnly(sql, (tx) => verifyCatalog(tx, REPO));
      await sql.end({ timeout: 5 });
      expect(findings.filter((f) => !f.ok).map((f) => f.check)).toEqual([
        "schema.opportunity-stages",
        "schema.opportunity-notes",
        "privileges.service_role-opportunity-notes",
      ]);
    } finally {
      await migrated.admin.unsafe(`
        ALTER TABLE public.opportunities ADD CONSTRAINT opportunities_vehicle_stage_check
          CHECK (vehicle_id IS NULL OR stage IN ('negotiating', 'won', 'lost'));
        ALTER TABLE public.opportunity_notes ADD CONSTRAINT opportunity_notes_body_check
          CHECK (char_length(body) BETWEEN 1 AND 1000 AND body = btrim(body, ' ' || chr(10)) AND translate(body, chr(10), '') !~ '[[:cntrl:]]');
        REVOKE DELETE ON public.opportunity_notes FROM service_role;
      `);
    }
    const sql = connect(migrated.migrationUrl);
    try {
      const findings = await readOnly(sql, (tx) => verifyCatalog(tx, REPO));
      expect(findings.filter((f) => !f.ok)).toEqual([]);
    } finally {
      await sql.end({ timeout: 5 });
    }
  });

  it("la verificación detecta la función de transiciones de 0008 sin la regla de la unidad (Hito 2)", async () => {
    const [current] = await migrated.admin<{ definition: string }[]>`
      SELECT pg_get_functiondef('private.enforce_opportunity_stage_transition()'::regprocedure) AS definition
    `;
    await migrated.admin.unsafe(`
      CREATE OR REPLACE FUNCTION private.enforce_opportunity_stage_transition()
      RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
      BEGIN
        NEW.updated_at := now();
        RETURN NEW;
      END
      $$;
    `);
    try {
      const sql = connect(migrated.migrationUrl);
      const findings = await readOnly(sql, (tx) => verifyCatalog(tx, REPO));
      await sql.end({ timeout: 5 });
      expect(findings.filter((f) => !f.ok).map((f) => f.check)).toEqual([
        "schema.opportunity-stages",
      ]);
    } finally {
      await migrated.admin.unsafe(current!.definition);
    }
    const sql = connect(migrated.migrationUrl);
    try {
      const findings = await readOnly(sql, (tx) => verifyCatalog(tx, REPO));
      expect(findings.filter((f) => !f.ok)).toEqual([]);
    } finally {
      await sql.end({ timeout: 5 });
    }
  });

  it("la verificación detecta un cierre sin su CHECK y la función de 0009 sin la regla de inmutabilidad (DEC-034)", async () => {
    const [current] = await migrated.admin<{ definition: string }[]>`
      SELECT pg_get_functiondef('private.enforce_opportunity_stage_transition()'::regprocedure) AS definition
    `;
    const v0009 = await readFile(
      new URL(
        "../../db/migrations/0009_opportunity_notes_vehicle_link.sql",
        import.meta.url,
      ),
      "utf8",
    );
    const function0009 = v0009.slice(
      v0009.indexOf('CREATE OR REPLACE FUNCTION "private"'),
      v0009.indexOf("$$;", v0009.indexOf("AS $$")) + 3,
    );
    expect(function0009).toContain("opportunities_vehicle_link");
    expect(function0009).not.toContain("opportunities_closure_immutable");

    for (const drift of [
      "ALTER TABLE public.opportunities DROP CONSTRAINT opportunities_won_closure_check",
      function0009,
    ]) {
      await migrated.admin.unsafe(drift);
      try {
        const sql = connect(migrated.migrationUrl);
        const findings = await readOnly(sql, (tx) => verifyCatalog(tx, REPO));
        await sql.end({ timeout: 5 });
        expect(
          findings.filter((f) => !f.ok).map((f) => f.check),
          drift.slice(0, 60),
        ).toEqual(["schema.opportunity-stages"]);
      } finally {
        await migrated.admin.unsafe(`
          ALTER TABLE public.opportunities DROP CONSTRAINT IF EXISTS opportunities_won_closure_check;
          ALTER TABLE public.opportunities ADD CONSTRAINT opportunities_won_closure_check
            CHECK ((stage = 'won' AND vehicle_id IS NOT NULL AND sale_price IS NOT NULL AND sale_currency IS NOT NULL AND payment_method IS NOT NULL AND delivery_status IS NOT NULL AND delivery_date IS NOT NULL) OR (stage <> 'won' AND sale_price IS NULL AND sale_currency IS NULL AND payment_method IS NULL AND delivery_status IS NULL AND delivery_date IS NULL));
        `);
        await migrated.admin.unsafe(current!.definition);
      }
    }
    const sql = connect(migrated.migrationUrl);
    try {
      const findings = await readOnly(sql, (tx) => verifyCatalog(tx, REPO));
      expect(findings.filter((f) => !f.ok)).toEqual([]);
    } finally {
      await sql.end({ timeout: 5 });
    }
  });

  it("la verificación detecta un mensaje sin CHECK de canal, un trigger de actividad deshabilitado, una función del toque ejecutable y un service_role que puede borrar mensajes (Hito 4)", async () => {
    await migrated.admin.unsafe(`
      ALTER TABLE public.messages DROP CONSTRAINT messages_channel_check;
      ALTER TABLE public.opportunity_notes DISABLE TRIGGER opportunity_notes_touch_activity;
      GRANT DELETE ON public.messages TO service_role;
    `);
    try {
      const sql = connect(migrated.migrationUrl);
      const findings = await readOnly(sql, (tx) => verifyCatalog(tx, REPO));
      await sql.end({ timeout: 5 });
      expect(findings.filter((f) => !f.ok).map((f) => f.check)).toEqual([
        "schema.messages",
        "schema.activity-touch",
        "privileges.service_role-messages",
      ]);
    } finally {
      await migrated.admin.unsafe(`
        ALTER TABLE public.messages ADD CONSTRAINT messages_channel_check
          CHECK (channel IN ('whatsapp', 'email', 'manual'));
        ALTER TABLE public.opportunity_notes ENABLE TRIGGER opportunity_notes_touch_activity;
        REVOKE DELETE ON public.messages FROM service_role;
      `);
    }
    // EXECUTE para authenticated sobre la función SECURITY DEFINER.
    await migrated.admin.unsafe(
      "GRANT EXECUTE ON FUNCTION private.touch_opportunity_activity() TO authenticated",
    );
    try {
      const sql = connect(migrated.migrationUrl);
      const findings = await readOnly(sql, (tx) => verifyCatalog(tx, REPO));
      await sql.end({ timeout: 5 });
      expect(findings.filter((f) => !f.ok).map((f) => f.check)).toEqual([
        "schema.activity-touch",
      ]);
    } finally {
      await migrated.admin.unsafe(
        "REVOKE EXECUTE ON FUNCTION private.touch_opportunity_activity() FROM authenticated",
      );
    }
    const sql = connect(migrated.migrationUrl);
    try {
      const findings = await readOnly(sql, (tx) => verifyCatalog(tx, REPO));
      expect(findings.filter((f) => !f.ok)).toEqual([]);
    } finally {
      await sql.end({ timeout: 5 });
    }
  });

  it("la verificación detecta la función de transiciones de 0010 sin la regla del toque de actividad (DEC-036)", async () => {
    const [current] = await migrated.admin<{ definition: string }[]>`
      SELECT pg_get_functiondef('private.enforce_opportunity_stage_transition()'::regprocedure) AS definition
    `;
    const v0010 = await readFile(
      new URL(
        "../../db/migrations/0010_opportunity_closure_metadata.sql",
        import.meta.url,
      ),
      "utf8",
    );
    const function0010 = v0010.slice(
      v0010.indexOf('CREATE OR REPLACE FUNCTION "private"'),
      v0010.indexOf("$$;", v0010.indexOf("AS $$")) + 3,
    );
    expect(function0010).toContain("opportunities_closure_immutable");
    expect(function0010).not.toContain("opportunities_activity_touch");

    await migrated.admin.unsafe(function0010);
    try {
      const sql = connect(migrated.migrationUrl);
      const findings = await readOnly(sql, (tx) => verifyCatalog(tx, REPO));
      await sql.end({ timeout: 5 });
      expect(findings.filter((f) => !f.ok).map((f) => f.check)).toEqual([
        "schema.opportunity-stages",
      ]);
    } finally {
      await migrated.admin.unsafe(current!.definition);
    }
    const sql = connect(migrated.migrationUrl);
    try {
      const findings = await readOnly(sql, (tx) => verifyCatalog(tx, REPO));
      expect(findings.filter((f) => !f.ok)).toEqual([]);
    } finally {
      await sql.end({ timeout: 5 });
    }
  });

  it("en una base sin historial, app_runtime ya existente es un residuo", async () => {
    const fresh = await server.createDatabase();
    expect(failures(await preflightOf(fresh, "migrate", ALL_TAGS))).toEqual([
      ...HARNESS_ONLY,
      "residue.app_runtime",
    ]);
  });
});

/*
 * El próximo rollout real (DEC-036): 0011 después del merge, con
 * preflight → migrate → verify. Staging está en el Hito 2A (0000 a 0010) si
 * 0010 ya se aplicó; si no, en el Hito 2 (0000 a 0009), H1.6 (0000 a 0008),
 * H1.4 (0000 a 0007) o todavía en H1.3C (0000 a 0006, DEC-028):
 * expected_migrations declara exactamente lo pendiente en cada caso. Esta
 * rama no aplica nada a staging.
 */
describe.each([
  {
    stagingAt: "0006_vehicle_availability",
    label: "H1.3C",
    applied: 7,
    expected: [
      "0007_opportunity_demand_facts",
      "0008_opportunity_stages",
      "0009_opportunity_notes_vehicle_link",
      "0010_opportunity_closure_metadata",
      "0011_conversations_and_activity_trigger",
    ],
  },
  {
    stagingAt: "0007_opportunity_demand_facts",
    label: "H1.4",
    applied: 8,
    expected: [
      "0008_opportunity_stages",
      "0009_opportunity_notes_vehicle_link",
      "0010_opportunity_closure_metadata",
      "0011_conversations_and_activity_trigger",
    ],
  },
  {
    stagingAt: "0008_opportunity_stages",
    label: "H1.6",
    applied: 9,
    expected: [
      "0009_opportunity_notes_vehicle_link",
      "0010_opportunity_closure_metadata",
      "0011_conversations_and_activity_trigger",
    ],
  },
  {
    stagingAt: "0009_opportunity_notes_vehicle_link",
    label: "Hito 2",
    applied: 10,
    expected: [
      "0010_opportunity_closure_metadata",
      "0011_conversations_and_activity_trigger",
    ],
  },
  {
    stagingAt: "0010_opportunity_closure_metadata",
    label: "Hito 2A",
    applied: 11,
    expected: ["0011_conversations_and_activity_trigger"],
  },
])(
  "staging en $label: rollout hasta 0011",
  ({ stagingAt, applied, expected }) => {
    let staging: TestDatabase;

    beforeAll(async () => {
      staging = await server.createDatabase();
      await migrateUpTo(staging.migrationUrl, stagingAt);
    });

    it("antes de migrar, verify y el resto de las operaciones exigen aplicar lo pendiente", async () => {
      expect(failures(await preflightOf(staging, "verify"))).toEqual([
        ...HARNESS_ONLY,
        "operation.up-to-date",
      ]);
    });

    it("el preflight pasa con expected_migrations = lo pendiente, y solo con eso", async () => {
      const result = await preflightOf(staging, "migrate", expected);
      expect(failures(result)).toEqual(HARNESS_ONLY);
      expect(result.history).toEqual({
        kind: "consistent",
        applied: REPO.slice(0, applied),
        pending: REPO.slice(applied),
      });
      // Declarar de más (o de menos) aborta antes de migrar.
      expect(
        failures(await preflightOf(staging, "migrate", ALL_TAGS)),
      ).toContain("operation.pending");
      expect(
        failures(
          await preflightOf(staging, "migrate", [
            REPO[applied - 1]!.tag,
            ...expected,
          ]),
        ),
      ).toContain("operation.pending");
      expect(
        failures(await preflightOf(staging, "migrate", expected.slice(0, -1))),
      ).toContain("operation.pending");
    });

    it("aplica lo pendiente y la verificación de catálogo pasa completa", async () => {
      const password = new URL(staging.migrationUrl).password;
      const output = await runOfficialMigrations(staging.migrationUrl, [
        password,
      ]);
      expect(output).not.toContain(password);
      const [history] = await staging.admin<{ count: number }[]>`
        SELECT count(*)::int AS count FROM drizzle.__drizzle_migrations
      `;
      expect(history?.count).toBe(REPO.length);

      expect(failures(await preflightOf(staging, "verify"))).toEqual(
        HARNESS_ONLY,
      );
      const sql = connect(staging.migrationUrl);
      try {
        const findings = await readOnly(sql, (tx) => verifyCatalog(tx, REPO));
        expect(findings.filter((f) => !f.ok)).toEqual([]);
      } finally {
        await sql.end({ timeout: 5 });
      }
    });
  },
);

describe("provisioning de app_runtime", () => {
  it("fija la password como verificador SCRAM-SHA-256: el texto plano no llega a la base", async () => {
    runtimePassword = randomBytes(32).toString("hex");
    const sql = connect(migrated.migrationUrl);
    try {
      await provisionRuntimePassword(sql, runtimePassword);
    } finally {
      await sql.end({ timeout: 5 });
    }
    const stored = await storedPassword(migrated);
    expect(stored).toMatch(SCRAM_VERIFIER);
    const parsed = parseScramVerifier(stored ?? "");
    expect(parsed?.iterations).toBe(4096);
    expect(scramSha256Verifier(runtimePassword, parsed?.salt)).toBe(stored);
  });

  it("el verificador es el mismo que calcula PostgreSQL para esa password", async () => {
    const plain = randomBytes(24).toString("hex");
    await migrated.admin.unsafe(`
      SET password_encryption = 'scram-sha-256';
      ALTER ROLE app_runtime PASSWORD '${plain}';
    `);
    const stored = await storedPassword(migrated);
    const parsed = parseScramVerifier(stored ?? "");
    expect(scramSha256Verifier(plain, parsed?.salt, parsed?.iterations)).toBe(
      stored,
    );

    const sql = connect(migrated.migrationUrl);
    await provisionRuntimePassword(sql, runtimePassword);
    await sql.end({ timeout: 5 });
  });

  it("no le da una credencial a un app_runtime que no cumple ADR-001", async () => {
    const before = await storedPassword(migrated);
    await migrated.admin`ALTER ROLE app_runtime INHERIT`;
    const sql = connect(migrated.migrationUrl);
    try {
      await expect(
        provisionRuntimePassword(sql, randomBytes(32).toString("hex")),
      ).rejects.toThrow(/does not match ADR-001/);
    } finally {
      await sql.end({ timeout: 5 });
      await migrated.admin`ALTER ROLE app_runtime NOINHERIT`;
    }
    expect(await storedPassword(migrated)).toBe(before);
  });

  it("inicia sesión como app_runtime con la credencial provista", async () => {
    const login = await checkRuntimeLogin(
      runtimeUrl(migrated, runtimePassword),
      {
        attempts: 1,
      },
    );
    expect(login).toMatchObject({ check: "app_runtime.login", ok: true });
  });
});

// El mismo spec que corre contra staging por el Transaction pooler.
describeRuntimeAcceptance({
  runtimeUrl: () => runtimeUrl(migrated, runtimePassword),
  iterations: 30,
});

describe("limpieza de datos sintéticos (Auth Admin API simulada)", () => {
  const RUN = "local-1";
  const synthetic: string[] = [];
  const realUser = randomUUID();
  /** Dominio sintético pero sin la marca de app_metadata: nunca se borra. */
  const unmarkedUser = randomUUID();
  const deleted: string[] = [];
  let realOrg = "";
  let syntheticOrgs: string[] = [];

  /** Lo único que la limpieza hace con la secret key: eliminar usuarios. */
  const fakeAdmin: Pick<SyntheticUserAdmin, "deleteUser"> = {
    async deleteUser(id) {
      await migrated.admin`DELETE FROM auth.users WHERE id = ${id}`;
      deleted.push(id);
      return { error: null };
    },
  };

  beforeAll(async () => {
    // En Supabase, auth.users tiene email y raw_app_meta_data, y postgres
    // puede leerla; el shim del harness solo tiene lo que necesita la FK.
    await migrated.admin.unsafe(`
      ALTER TABLE auth.users ADD COLUMN IF NOT EXISTS email text;
      ALTER TABLE auth.users ADD COLUMN IF NOT EXISTS raw_app_meta_data jsonb;
      GRANT SELECT ON auth.users TO postgres;
    `);
    const addUser = async (id: string, email: string, metadata: object) => {
      await migrated.admin`
        INSERT INTO auth.users (id, email, raw_app_meta_data)
        VALUES (${id}, ${email}, ${migrated.admin.json(metadata as never)})
      `;
      await migrated.admin`INSERT INTO public.profiles (id) VALUES (${id})`;
    };
    for (const key of ["a", "b"]) {
      const id = randomUUID();
      synthetic.push(id);
      await addUser(id, syntheticEmail(RUN, key), syntheticAppMetadata(RUN));
    }
    await addUser(realUser, "real@example.test", { provider: "email" });
    await addUser(unmarkedUser, syntheticEmail(RUN, "x"), {
      provider: "email",
    });

    const orgs = await migrated.admin<{ id: string }[]>`
      INSERT INTO public.organizations (name) VALUES
        (${syntheticOrganizationName(RUN, "A")}),
        (${syntheticOrganizationName(RUN, "B")}),
        ('Organización real')
      RETURNING id
    `;
    syntheticOrgs = orgs.slice(0, 2).map((o) => o.id);
    realOrg = orgs[2]!.id;
    await migrated.admin`
      INSERT INTO public.memberships (organization_id, user_id, role) VALUES
        (${syntheticOrgs[0]!}, ${synthetic[0]!}, 'admin'),
        (${syntheticOrgs[1]!}, ${synthetic[1]!}, 'seller'),
        (${realOrg}, ${realUser}, 'admin')
    `;
  });

  it("encuentra por SQL solo usuarios con las dos marcas, sin la secret key", async () => {
    const sql = connect(migrated.migrationUrl);
    try {
      expect(
        (await listSyntheticUsers(sql, RUN)).map((u) => u.id).sort(),
      ).toEqual([...synthetic].sort());
      expect(await listSyntheticUsers(sql, "other-run")).toEqual([]);
    } finally {
      await sql.end({ timeout: 5 });
    }
  });

  it("el preflight del acceptance Auth → Tenant detecta sobrantes", async () => {
    expect(
      failures(await preflightOf(migrated, "auth-tenant-acceptance", [], true)),
    ).toEqual([...HARNESS_ONLY, "synthetic.leftovers"]);
  });

  it("no borra nada si una organización sintética tiene miembros reales", async () => {
    await migrated.admin`
      INSERT INTO public.memberships (organization_id, user_id, role)
      VALUES (${syntheticOrgs[0]!}, ${realUser}, 'seller')
    `;
    const sql = connect(migrated.migrationUrl);
    try {
      await expect(cleanupSynthetic(sql, fakeAdmin, RUN)).rejects.toThrow(
        /non-synthetic users/,
      );
    } finally {
      await sql.end({ timeout: 5 });
      await migrated.admin`
        DELETE FROM public.memberships
        WHERE organization_id = ${syntheticOrgs[0]!} AND user_id = ${realUser}
      `;
    }
    const [count] = await migrated.admin<{ count: number }[]>`
      SELECT count(*)::int AS count FROM public.organizations
    `;
    expect(count?.count).toBe(3);
    expect(deleted).toEqual([]);
  });

  it("borra solo lo sintético de la corrida, sin CASCADE ni DDL", async () => {
    const sql = connect(migrated.migrationUrl);
    try {
      expect(await cleanupSynthetic(sql, fakeAdmin, RUN)).toEqual({
        users: 2,
        profiles: 2,
        memberships: 2,
        organizations: 2,
      });
    } finally {
      await sql.end({ timeout: 5 });
    }
    expect(deleted.sort()).toEqual([...synthetic].sort());
    const remaining = await migrated.admin<{ name: string }[]>`
      SELECT name FROM public.organizations ORDER BY name
    `;
    expect(remaining.map((row) => row.name)).toEqual(["Organización real"]);
    const profiles = await migrated.admin<{ id: string }[]>`
      SELECT id FROM public.profiles ORDER BY id
    `;
    expect(profiles.map((p) => p.id)).toEqual([realUser, unmarkedUser].sort());

    // Sin la marca no se borra, pero el preflight lo sigue señalando: se
    // resuelve a mano.
    expect(
      failures(await preflightOf(migrated, "auth-tenant-acceptance", [], true)),
    ).toEqual([...HARNESS_ONLY, "synthetic.leftovers"]);
    await migrated.admin`DELETE FROM public.profiles WHERE id = ${unmarkedUser}`;
    await migrated.admin`DELETE FROM auth.users WHERE id = ${unmarkedUser}`;
    expect(
      failures(await preflightOf(migrated, "auth-tenant-acceptance", [], true)),
    ).toEqual(HARNESS_ONLY);
  });
});
