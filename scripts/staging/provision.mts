import type { Sql } from "postgres";

import { connect } from "./connect.mts";
import { finding, type Finding } from "./report.mts";
import { SCRAM_VERIFIER, scramSha256Verifier } from "./scram.mts";

/*
 * Credencial de app_runtime en staging (ADR-001 §4 y §7.5).
 *
 * 0001_tenant_isolation crea el rol sin password: se fija acá, fuera de las
 * migraciones, desde el GitHub secret STAGING_RUNTIME_DB_PASSWORD. La
 * password se hashea en el runner (SCRAM-SHA-256) y a la base solo llega el
 * verificador, así que ni el statement ni un log de la base la contienen.
 * Rotar es volver a correr esta operación con el secret nuevo (y después
 * actualizar RUNTIME_DATABASE_URL donde corra el runtime, H0.9).
 */

type RoleAttributes = {
  login: boolean;
  inherit: boolean;
  bypassRls: boolean;
  super: boolean;
  createRole: boolean;
  createDb: boolean;
  replication: boolean;
};

export async function provisionRuntimePassword(
  sql: Sql,
  password: string,
): Promise<void> {
  const verifier = scramSha256Verifier(password);
  // El verificador solo tiene base64, dígitos, `$` y `:`: se puede escribir
  // como literal sin riesgo. ALTER ROLE no acepta parámetros.
  if (!SCRAM_VERIFIER.test(verifier) || verifier.includes("'")) {
    throw new Error("provision-runtime: invalid SCRAM verifier.");
  }

  await sql.begin(async (tx) => {
    await tx`SELECT set_config('statement_timeout', '30s', true), set_config('lock_timeout', '5s', true)`;
    const [role] = await tx<RoleAttributes[]>`
      SELECT rolcanlogin AS login, rolinherit AS inherit,
        rolbypassrls AS "bypassRls", rolsuper AS super,
        rolcreaterole AS "createRole", rolcreatedb AS "createDb",
        rolreplication AS replication
      FROM pg_roles WHERE rolname = 'app_runtime'
    `;
    if (!role) {
      throw new Error(
        "provision-runtime: role app_runtime does not exist. Apply 0001_tenant_isolation first.",
      );
    }
    // Una credencial solo se le da a un rol que cumple ADR-001.
    if (
      !role.login ||
      role.inherit ||
      role.bypassRls ||
      role.super ||
      role.createRole ||
      role.createDb ||
      role.replication
    ) {
      throw new Error(
        "provision-runtime: app_runtime does not match ADR-001 (LOGIN NOINHERIT NOBYPASSRLS, no SUPERUSER/CREATEROLE/CREATEDB/REPLICATION). Nothing was changed.",
      );
    }
    await tx.unsafe(`ALTER ROLE app_runtime WITH PASSWORD '${verifier}'`);
  });
}

type Identity = { currentUser: string; sessionUser: string };

/**
 * Inicia sesión como app_runtime por el Transaction pooler (6543). Supavisor
 * puede tardar en ver una password nueva: reintenta unas veces.
 */
export async function checkRuntimeLogin(
  runtimeUrl: string,
  options: { attempts?: number; delayMs?: number } = {},
): Promise<Finding> {
  const attempts = options.attempts ?? 5;
  const delayMs = options.delayMs ?? 3000;
  let lastError = "";
  for (let attempt = 1; attempt <= attempts; attempt++) {
    const sql = connect(runtimeUrl);
    try {
      const [identity] = await sql<Identity[]>`
        SELECT current_user AS "currentUser", session_user AS "sessionUser"
      `;
      const ok =
        identity?.currentUser === "app_runtime" &&
        identity.sessionUser === "app_runtime";
      return finding(
        "app_runtime.login",
        ok,
        `current_user ${identity?.currentUser}, session_user ${identity?.sessionUser} (attempt ${attempt})`,
      );
    } catch (error) {
      const { code } = (error ?? {}) as { code?: unknown };
      lastError = typeof code === "string" ? code : "connection error";
    } finally {
      await sql.end({ timeout: 5 });
    }
    if (attempt < attempts) {
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
  return finding(
    "app_runtime.login",
    false,
    `could not log in as app_runtime after ${attempts} attempts (${lastError})`,
  );
}
