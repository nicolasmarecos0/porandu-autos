import type { Sql } from "postgres";

import { connect, readOnly } from "./connect.mts";
import { runOfficialMigrations } from "./migrate.mts";
import { compareHistory, readRepoMigrations } from "./migrations.mts";
import { evaluatePreflight, readFacts, type Operation } from "./preflight.mts";
import { checkRuntimeLogin, provisionRuntimePassword } from "./provision.mts";
import {
  failed,
  finding,
  formatFindings,
  writeSummary,
  type Finding,
} from "./report.mts";
import { cleanupSynthetic, syntheticUserAdmin } from "./synthetic.mts";
import { redact } from "./target.mts";
import {
  probeDataApi,
  serviceRolePrivileges,
  verifyCatalog,
} from "./verify.mts";

/*
 * Operaciones del workflow Staging DB. Reciben credenciales ya resueltas y
 * validadas por cli.mts (destino de staging, secrets) y devuelven si
 * pasaron. Cada operación que escribe vuelve a correr el preflight antes:
 * ninguna se puede usar salteando los chequeos.
 */

export type CommandContext = Readonly<{
  /** postgres por el Session pooler (5432). */
  migrationUrl: string;
  supabaseUrl: string;
  /** Solo migrate: tags pendientes declarados por quien dispara. */
  expectedMigrations?: readonly string[];
  /** Solo provision-runtime. */
  runtimePassword?: string;
  /** Solo provision-runtime: app_runtime por el Transaction pooler (6543). */
  runtimeUrl?: string;
  /** Solo verify: sonda de la Data API. */
  publishableKey?: string;
  /** Solo cleanup-synthetic: Admin API de Supabase Auth. */
  secretKey?: string;
  /** Valores que nunca pueden aparecer en la salida. */
  secrets: readonly string[];
  log: (line: string) => void;
}>;

function report(
  ctx: CommandContext,
  title: string,
  findings: readonly Finding[],
): boolean {
  ctx.log(`\n${title}\n${formatFindings(findings)}`);
  writeSummary(title, findings);
  return failed(findings).length === 0;
}

async function withConnection<T>(
  url: string,
  fn: (sql: Sql) => Promise<T>,
): Promise<T> {
  const sql = connect(url);
  try {
    return await fn(sql);
  } finally {
    await sql.end({ timeout: 5 });
  }
}

/** Preflight de solo lectura para `operation`. */
export async function preflightCommand(
  ctx: CommandContext,
  operation: Operation,
): Promise<boolean> {
  const facts = await withConnection(ctx.migrationUrl, (sql) =>
    readOnly(sql, (tx) =>
      readFacts(tx, { synthetic: operation === "auth-tenant-acceptance" }),
    ),
  );
  const { findings } = evaluatePreflight(
    facts,
    readRepoMigrations(),
    operation,
    ctx.expectedMigrations ?? [],
  );
  return report(ctx, `Preflight (${operation}) · solo lectura`, findings);
}

export async function migrateCommand(ctx: CommandContext): Promise<boolean> {
  if (!(await preflightCommand(ctx, "migrate"))) return false;

  try {
    const output = await runOfficialMigrations(ctx.migrationUrl, ctx.secrets);
    if (output !== "") ctx.log(output);
  } catch (error) {
    ctx.log(
      redact(
        error instanceof Error ? error.message : String(error),
        ctx.secrets,
      ),
    );
    // Estado real después de la falla, para el diagnóstico.
    await preflightCommand(ctx, "preflight");
    return false;
  }

  const repo = readRepoMigrations();
  const rows = await withConnection(ctx.migrationUrl, (sql) =>
    readOnly(
      sql,
      (tx) => tx<{ id: number; hash: string; createdAt: string }[]>`
        SELECT id, hash, created_at::text AS "createdAt"
        FROM drizzle.__drizzle_migrations ORDER BY created_at, id
      `,
    ),
  );
  const status = compareHistory(
    repo,
    rows.map((r) => ({
      id: r.id,
      hash: r.hash,
      createdAt: Number(r.createdAt),
    })),
  );
  return report(ctx, "Migraciones oficiales", [
    finding(
      "migrations.applied",
      status.kind === "consistent" &&
        status.pending.length === 0 &&
        rows.length === repo.length,
      status.kind === "consistent"
        ? `drizzle history: ${status.applied.map((m) => m.tag).join(", ")} (${rows.length} rows)`
        : status.reason,
    ),
  ]);
}

export async function provisionRuntimeCommand(
  ctx: CommandContext,
): Promise<boolean> {
  const { runtimePassword, runtimeUrl } = ctx;
  if (!runtimePassword || !runtimeUrl) {
    throw new Error("provision-runtime requires the runtime credential.");
  }
  if (!(await preflightCommand(ctx, "provision-runtime"))) return false;

  await withConnection(ctx.migrationUrl, (sql) =>
    provisionRuntimePassword(sql, runtimePassword),
  );
  return report(ctx, "Provisioning de app_runtime", [
    finding(
      "app_runtime.password",
      true,
      "set from STAGING_RUNTIME_DB_PASSWORD as a SCRAM-SHA-256 verifier",
    ),
    await checkRuntimeLogin(runtimeUrl),
  ]);
}

export async function verifyCommand(ctx: CommandContext): Promise<boolean> {
  if (!(await preflightCommand(ctx, "verify"))) return false;

  const repo = readRepoMigrations();
  const { findings, serviceRole } = await withConnection(
    ctx.migrationUrl,
    (sql) =>
      readOnly(sql, async (tx) => ({
        findings: await verifyCatalog(tx, repo),
        serviceRole: await serviceRolePrivileges(tx),
      })),
  );
  const dataApi = ctx.publishableKey?.startsWith("sb_publishable_")
    ? await probeDataApi(ctx.supabaseUrl, ctx.publishableKey)
    : [
        finding(
          "data-api",
          false,
          "STAGING_PUBLISHABLE_KEY is required (sb_publishable_…)",
        ),
      ];
  const ok = report(ctx, "Verificación post-migración", [
    ...findings,
    ...dataApi,
  ]);
  ctx.log(
    `\nInfo (no falla): service_role sobre tablas de public (default privileges de Supabase): ${serviceRole.length === 0 ? "none" : serviceRole.join(", ")}`,
  );
  return ok;
}

export async function cleanupSyntheticCommand(
  ctx: CommandContext,
  runId: string | undefined,
): Promise<boolean> {
  if (!ctx.secretKey) {
    throw new Error("cleanup-synthetic requires STAGING_SECRET_KEY.");
  }
  const admin = syntheticUserAdmin(ctx.supabaseUrl, ctx.secretKey);
  const result = await withConnection(ctx.migrationUrl, (sql) =>
    cleanupSynthetic(sql, admin, runId),
  );
  return report(
    ctx,
    `Limpieza de datos sintéticos (${runId === undefined ? "todas las corridas" : `corrida ${runId}`})`,
    [
      finding(
        "synthetic.cleanup",
        true,
        `deleted users ${result.users}, profiles ${result.profiles}, memberships ${result.memberships}, organizations ${result.organizations}`,
      ),
    ],
  );
}
