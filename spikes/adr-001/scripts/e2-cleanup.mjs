/*
 * E2 · limpieza de staging. El workflow la corre ANTES (restos de una corrida
 * interrumpida) y DESPUÉS (siempre) de la matriz. Solo toca lo sintético del
 * spike:
 *   - usuarios de Auth con email `…@adr001.test` (Admin API, secret key);
 *   - organizaciones `ADR-001 spike …` y sus memberships;
 *   - tablas de test `public.tenant_probe` y `public.spike_ddl_check`;
 *   - anula la password de app_runtime: nadie puede loguearse con ese rol
 *     hasta la próxima corrida (que genera una efímera nueva).
 * No toca el schema del spike (tablas, rol, función, policies): ver RESULTS.md.
 * Imprime solo contadores.
 */
import { createClient } from "@supabase/supabase-js";
import postgres from "postgres";
import { stagingMigrationUrl } from "../test/support/staging.ts";

const supabaseUrl = process.env.SPIKE_SUPABASE_URL?.trim();
const secretKey = process.env.SPIKE_SECRET_KEY?.trim();
if (!supabaseUrl || !secretKey) {
  console.log("::error::faltan SPIKE_SUPABASE_URL o SPIKE_SECRET_KEY");
  process.exit(1);
}

const sql = postgres(stagingMigrationUrl(), {
  max: 1,
  prepare: false,
  connect_timeout: 20,
  onnotice: () => undefined,
});
const admin = createClient(supabaseUrl, secretKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const report = {
  syntheticUsersDeleted: 0,
  syntheticUsersFailed: 0,
  syntheticOrgsDeleted: 0,
  appRuntimePassword: "sin cambios",
};

try {
  const users = await sql`
    select id from auth.users where email like '%@adr001.test'`;
  for (const { id } of users) {
    const { error } = await admin.auth.admin.deleteUser(id);
    if (error) report.syntheticUsersFailed += 1;
    else report.syntheticUsersDeleted += 1;
  }

  const [tables] = await sql`
    select to_regclass('public.organizations') is not null as orgs,
           to_regclass('public.memberships') is not null as memberships`;
  if (tables?.orgs) {
    const orgs = await sql`
      select id from public.organizations where name like 'ADR-001 spike %'`;
    const ids = orgs.map((row) => row.id);
    if (ids.length > 0) {
      if (tables.memberships) {
        await sql`delete from public.memberships where organization_id = any(${ids}::uuid[])`;
      }
      await sql`delete from public.organizations where id = any(${ids}::uuid[])`;
    }
    report.syntheticOrgsDeleted = ids.length;
  }

  await sql`drop table if exists public.tenant_probe`;
  await sql`drop table if exists public.spike_ddl_check`;

  const [role] = await sql`
    select exists (select 1 from pg_roles where rolname = 'app_runtime') as present`;
  if (role?.present) {
    await sql.unsafe("alter role app_runtime with password null");
    report.appRuntimePassword = "anulada";
  } else {
    report.appRuntimePassword = "rol inexistente (primera corrida)";
  }
} finally {
  await sql.end({ timeout: 5 });
}

console.log(`Limpieza E2: ${JSON.stringify(report)}`);
if (report.syntheticUsersFailed > 0) process.exit(1);
