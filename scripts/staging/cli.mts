/*
 * Staging DB (H0.8): punto de entrada del workflow
 * .github/workflows/staging-db.yml.
 *
 *   node scripts/staging/cli.mts <preflight|migrate|provision-runtime|verify|cleanup-synthetic>
 *
 * Solo corre en GitHub Actions contra el proyecto de staging, con los
 * secrets del environment `staging`. Valida el destino (project ref en
 * cuatro fuentes, pooler de Supabase en sa-east-1) antes de abrir cualquier
 * conexión y arma cada credencial en memoria, solo la que el comando
 * necesita. Nunca imprime URLs, passwords ni keys.
 */
import {
  cleanupSyntheticCommand,
  migrateCommand,
  preflightCommand,
  provisionRuntimeCommand,
  verifyCommand,
  type CommandContext,
} from "./commands.mts";
import { parseExpectedMigrations } from "./migrations.mts";
import { parseOperation } from "./preflight.mts";
import { parseRunId, readSecretKey } from "./synthetic.mts";
import {
  maskSecrets,
  migrationDatabaseUrl,
  parseStagingTarget,
  readMigrationPassword,
  readRuntimePassword,
  redact,
  runtimeDatabaseUrl,
} from "./target.mts";

const env = process.env;

/** Todo valor sensible que el proceso podría ver. */
const SECRETS = [
  env.STAGING_DB_PASSWORD,
  env.STAGING_RUNTIME_DB_PASSWORD,
  env.STAGING_SECRET_KEY,
].filter((value): value is string => typeof value === "string" && value !== "");

function log(message: string): void {
  process.stdout.write(`${message}\n`);
}

function cleanupScope(args: readonly string[]): string | undefined {
  const all = args.includes("--all");
  const index = args.indexOf("--run-id");
  const runId = index >= 0 ? parseRunId(args[index + 1]) : undefined;
  if (all === (runId !== undefined)) {
    throw new Error(
      "cleanup-synthetic requires exactly one of --all or --run-id <id>.",
    );
  }
  return runId;
}

async function main(): Promise<boolean> {
  const [command, ...args] = process.argv.slice(2);
  if (env.GITHUB_ACTIONS === "true") maskSecrets(SECRETS);

  const target = parseStagingTarget(env);
  log(
    `Staging target: project ${target.projectRef} · ${target.region} · Supavisor ${target.poolerHost}`,
  );
  const base: CommandContext = {
    migrationUrl: migrationDatabaseUrl(target, readMigrationPassword(env)),
    supabaseUrl: target.supabaseUrl,
    secrets: SECRETS,
    log,
  };

  switch (command) {
    case "preflight": {
      const operation = parseOperation(env.STAGING_OPERATION);
      return preflightCommand(
        {
          ...base,
          expectedMigrations:
            operation === "migrate"
              ? parseExpectedMigrations(env.STAGING_EXPECTED_MIGRATIONS)
              : [],
        },
        operation,
      );
    }
    case "migrate":
      return migrateCommand({
        ...base,
        expectedMigrations: parseExpectedMigrations(
          env.STAGING_EXPECTED_MIGRATIONS,
        ),
      });
    case "provision-runtime": {
      // Antes de conectar: la password existe, tiene el formato y no es la
      // de postgres.
      const runtimePassword = readRuntimePassword(env);
      return provisionRuntimeCommand({
        ...base,
        runtimePassword,
        runtimeUrl: runtimeDatabaseUrl(target, runtimePassword),
      });
    }
    case "verify":
      return verifyCommand({
        ...base,
        publishableKey: env.STAGING_PUBLISHABLE_KEY?.trim(),
      });
    case "cleanup-synthetic":
      return cleanupSyntheticCommand(
        { ...base, secretKey: readSecretKey(env) },
        cleanupScope(args),
      );
    default:
      throw new Error(
        "Usage: node scripts/staging/cli.mts <preflight|migrate|provision-runtime|verify|cleanup-synthetic>",
      );
  }
}

main().then(
  (ok) => {
    process.exitCode = ok ? 0 : 1;
  },
  (error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    log(`::error::${redact(message, SECRETS).replaceAll("\n", "%0A")}`);
    process.exitCode = 1;
  },
);
