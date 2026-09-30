import {
  parseRunId,
  readSecretKey,
} from "../../../scripts/staging/synthetic.mts";
import {
  migrationDatabaseUrl,
  parseStagingTarget,
  readMigrationPassword,
  readRuntimePassword,
  runtimeDatabaseUrl,
} from "../../../scripts/staging/target.mts";

/*
 * Destinos de los acceptance de staging, derivados en memoria de los GitHub
 * secrets del paso (mismas validaciones que scripts/staging/target.mts).
 * Nunca se imprimen.
 */

export type RuntimeTarget = Readonly<{
  /** app_runtime por el Transaction pooler (6543). */
  runtimeUrl: string;
}>;

export type AuthTenantTarget = RuntimeTarget &
  Readonly<{
    supabaseUrl: string;
    publishableKey: string;
    /** Admin API: alta y baja de usuarios sintéticos. Nunca el runtime. */
    secretKey: string;
    /** postgres (5432): fixtures sintéticos y revocación. Nunca el runtime. */
    migrationUrl: string;
    runId: string;
    /** Probar que la Data API no devuelve datos con un token real. */
    probeDataApi: boolean;
  }>;

/**
 * Solo la credencial de runtime: el paso del acceptance del runtime no
 * recibe la de postgres, así que no puede usarla ni por error.
 */
export function stagingRuntimeTarget(): RuntimeTarget {
  const target = parseStagingTarget(process.env);
  return {
    runtimeUrl: runtimeDatabaseUrl(target, readRuntimePassword(process.env)),
  };
}

export function stagingAuthTenantTarget(): AuthTenantTarget {
  const env = process.env;
  const target = parseStagingTarget(env);
  const publishableKey = env.STAGING_PUBLISHABLE_KEY?.trim() ?? "";
  if (!publishableKey.startsWith("sb_publishable_")) {
    throw new Error(
      "STAGING_PUBLISHABLE_KEY must be a publishable key (sb_publishable_…).",
    );
  }
  return {
    runtimeUrl: runtimeDatabaseUrl(target, readRuntimePassword(env)),
    migrationUrl: migrationDatabaseUrl(target, readMigrationPassword(env)),
    supabaseUrl: target.supabaseUrl,
    publishableKey,
    secretKey: readSecretKey(env),
    runId: parseRunId(env.STAGING_SYNTHETIC_RUN_ID),
    probeDataApi: true,
  };
}
