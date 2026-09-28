import { randomBytes, randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createClient } from "@supabase/supabase-js";
import type { TestProject } from "vitest/node";
import { openSql, type Sql } from "./db";
import { env, isE1, usesSupabase } from "./env";
import type {
  FixtureUser,
  Fixtures,
  OrgKey,
  SetupMeta,
  UserKey,
} from "./fixtures";
import { decodeJwtPart, signHs256 } from "./jwt-hs256";

/*
 * Provisioning del experimento. Usa la credencial de MIGRACIÓN (`postgres`):
 * es harness, no runtime. Requiere que `drizzle-kit migrate` ya haya corrido.
 *
 *   1. fija la password de app_runtime (fuera de las migraciones; en e2 es
 *      efímera y el workflow la anula al terminar);
 *   2. crea usuarios (e1/e2: Auth Admin API + login con password; e0: shim);
 *   3. crea profiles, organizaciones, memberships;
 *   4. crea la tabla de prueba tenant_probe (y en e1 el schema de control);
 *   5. registra metadatos del entorno (Q1, auth.uid(), pooler, claves).
 *
 * Todo lo sintético lleva marca de la corrida: emails `…@adr001.test` y
 * organizaciones `ADR-001 spike <runId> · A|B`. En e2 lo borra
 * scripts/e2-cleanup.mjs (antes y después de cada corrida).
 */

const USER_KEYS: readonly UserKey[] = ["uA", "uB", "uAB", "uC", "uD"];

function quoteLiteral(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

/**
 * Settings del rol `authenticator` que se pueden registrar sin riesgo. Todo lo
 * demás se redacta: podría contener secretos (p. ej. un jwt_secret de PostgREST).
 */
const SAFE_AUTHENTICATOR_SETTINGS = new Set([
  "pgrst.db_schemas",
  "pgrst.db_extra_search_path",
  "pgrst.db_anon_role",
  "search_path",
  "statement_timeout",
  "lock_timeout",
  "session_preload_libraries",
]);

function redactSettings(config: string[] | null | undefined): string[] | null {
  if (!config) return null;
  return config.map((entry) => {
    const key = entry.split("=", 1)[0] ?? "";
    return SAFE_AUTHENTICATOR_SETTINGS.has(key) ? entry : `${key}=<omitido>`;
  });
}

async function createUsers(
  sql: Sql,
  runId: string,
): Promise<Record<UserKey, FixtureUser>> {
  const users = {} as Record<UserKey, FixtureUser>;

  if (usesSupabase) {
    if (!env.supabaseUrl || !env.secretKey || !env.publishableKey) {
      throw new Error("e1/e2 requieren URL, secret y publishable key");
    }
    const admin = createClient(env.supabaseUrl, env.secretKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    for (const key of USER_KEYS) {
      const email = `${key.toLowerCase()}-${runId}@adr001.test`;
      const password = randomBytes(18).toString("base64url");
      const created = await admin.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
      });
      if (created.error || !created.data.user) {
        throw new Error(`createUser ${key}: ${created.error?.message}`);
      }
      const client = createClient(env.supabaseUrl, env.publishableKey, {
        auth: { persistSession: false, autoRefreshToken: false },
      });
      const signIn = await client.auth.signInWithPassword({ email, password });
      if (signIn.error || !signIn.data.session) {
        throw new Error(`signIn ${key}: ${signIn.error?.message}`);
      }
      users[key] = {
        id: created.data.user.id,
        email,
        accessToken: signIn.data.session.access_token,
      };
    }
    return users;
  }

  if (!env.jwtSecret) throw new Error("e0 requiere SPIKE_JWT_SECRET");
  const now = Math.floor(Date.now() / 1000);
  for (const key of USER_KEYS) {
    const id = randomUUID();
    const email = `${key.toLowerCase()}-${runId}@adr001.test`;
    await sql`insert into auth.users (id, email) values (${id}, ${email})`;
    users[key] = {
      id,
      email,
      accessToken: signHs256(
        {
          sub: id,
          role: "authenticated",
          aud: "authenticated",
          email,
          iat: now,
          exp: now + 3600,
          session_id: randomUUID(),
        },
        env.jwtSecret,
      ),
    };
  }
  return users;
}

async function poolerCheck(url: string | undefined): Promise<string> {
  if (!url) return "not-configured";
  const sql = openSql(url, "pooler-check", 1);
  try {
    const [row] = await sql<{ cu: string }[]>`select current_user as cu`;
    return `ok:${row?.cu ?? "?"}`;
  } catch (error) {
    return `error:${error instanceof Error ? error.message : String(error)}`;
  } finally {
    await sql.end({ timeout: 5 });
  }
}

export default async function setup(project: TestProject): Promise<void> {
  const sql = openSql(env.migrationUrl, "migration", 2);
  try {
    const [who] = await sql<{ cu: string }[]>`select current_user as cu`;
    if (who?.cu !== "postgres") {
      throw new Error(`la credencial de migración no es postgres: ${who?.cu}`);
    }
    const [fn] = await sql<{ exists: boolean }[]>`
      select to_regprocedure('private.user_org_ids()') is not null as exists`;
    if (!fn?.exists) {
      throw new Error("Faltan migraciones: correr drizzle-kit migrate antes");
    }

    // 1. Password de app_runtime: fuera de las migraciones, nunca en el repo.
    await sql.unsafe(
      `alter role app_runtime with password ${quoteLiteral(env.appRuntimePassword)}`,
    );

    // 2–3. Identidades, organizaciones y memberships.
    const runId = randomBytes(4).toString("hex");
    const users = await createUsers(sql, runId);
    for (const key of USER_KEYS) {
      await sql`insert into public.profiles (id, full_name)
                values (${users[key].id}, ${`ADR-001 spike ${runId} · ${key}`})`;
    }
    const orgs = {} as Record<OrgKey, string>;
    for (const key of ["A", "B"] as const) {
      const [row] = await sql<{ id: string }[]>`
        insert into public.organizations (name)
        values (${`ADR-001 spike ${runId} · ${key}`})
        returning id`;
      if (!row) throw new Error("org sin id");
      orgs[key] = row.id;
    }
    const memberships: [UserKey, OrgKey, "admin" | "seller", boolean][] = [
      ["uA", "A", "admin", true],
      ["uB", "B", "seller", true],
      ["uAB", "A", "seller", true],
      ["uAB", "B", "admin", true],
      ["uD", "A", "seller", false],
    ];
    for (const [user, org, role, active] of memberships) {
      await sql`insert into public.memberships (organization_id, user_id, role, active)
                values (${orgs[org]}, ${users[user].id}, ${role}, ${active})`;
    }

    // 4a. tenant_probe: patrón de tabla tenant de Hito 1 (solo en bases de test).
    // En e2 puede quedar de una corrida interrumpida: se recrea siempre.
    await sql.unsafe(`
      drop table if exists public.tenant_probe;
      create table public.tenant_probe (
        id uuid primary key default gen_random_uuid(),
        organization_id uuid not null references public.organizations(id) on delete cascade,
        label text not null,
        constraint tenant_probe_organization_id_id_key unique (organization_id, id)
      );
      alter table public.tenant_probe enable row level security;
      revoke all on table public.tenant_probe from anon, authenticated;
      grant select, insert, update, delete on table public.tenant_probe to authenticated;
      create policy tenant_probe_member_all on public.tenant_probe
        for all to authenticated
        using (organization_id in (select private.user_org_ids()))
        with check (organization_id in (select private.user_org_ids()));
    `);
    const probe: Record<OrgKey, string[]> = { A: [], B: [] };
    for (const [org, label] of [
      ["A", "pA1"],
      ["A", "pA2"],
      ["B", "pB1"],
    ] as const) {
      const [row] = await sql<{ id: string }[]>`
        insert into public.tenant_probe (organization_id, label)
        values (${orgs[org]}, ${label}) returning id`;
      if (!row) throw new Error("probe sin id");
      probe[org].push(row.id);
    }

    // 4b. Control positivo de la Data API (solo e1 local): misma tabla, mismas
    // grants y RLS, pero en un schema que SÍ está expuesto (supabase/config.toml).
    // La CLI crea el schema vacío antes de PostgREST (supabase/migrations).
    // En e2 no se crea nada extra: la Data API de staging está deshabilitada.
    if (isE1) {
      await sql.unsafe(`
        create schema if not exists spike_exposed;
        grant usage on schema spike_exposed to anon, authenticated;
        create table spike_exposed.tenant_probe_exposed (
          id uuid primary key default gen_random_uuid(),
          organization_id uuid not null,
          label text not null
        );
        alter table spike_exposed.tenant_probe_exposed enable row level security;
        revoke all on table spike_exposed.tenant_probe_exposed from anon, authenticated;
        grant select on table spike_exposed.tenant_probe_exposed to authenticated;
        create policy tenant_probe_exposed_member_select on spike_exposed.tenant_probe_exposed
          for select to authenticated
          using (organization_id in (select private.user_org_ids()));
      `);
      await sql`insert into spike_exposed.tenant_probe_exposed (organization_id, label)
                values (${orgs.A}, 'xA1'), (${orgs.B}, 'xB1')`;
      await sql`select pg_notify('pgrst', 'reload schema')`;
    }

    // 5. Metadatos del entorno.
    const [version] = await sql<{ v: string }[]>`select version() as v`;
    const [pgRole] = await sql<
      { rolsuper: boolean; rolbypassrls: boolean; rolcreaterole: boolean }[]
    >`select rolsuper, rolbypassrls, rolcreaterole from pg_roles where rolname = 'postgres'`;
    const [owner] = await sql<{ owner: string }[]>`
      select tableowner as owner from pg_tables
      where schemaname = 'public' and tablename = 'organizations'`;
    const [grant] = await sql<
      { inherit: boolean; set: boolean; admin: boolean }[]
    >`select m.inherit_option as inherit, m.set_option as set, m.admin_option as admin
      from pg_auth_members m
      join pg_roles r on r.oid = m.roleid
      join pg_roles u on u.oid = m.member
      where r.rolname = 'authenticated' and u.rolname = 'app_runtime'`;
    const [uidDef] = await sql<{ def: string }[]>`
      select pg_get_functiondef('auth.uid()'::regprocedure) as def`;
    const extensions = await sql<{ name: string }[]>`
      select extname as name from pg_extension order by 1`;
    const [authenticator] = await sql<{ config: string[] | null }[]>`
      select rolconfig as config from pg_roles where rolname = 'authenticator'`;

    const meta: SetupMeta = {
      target: env.target,
      serverVersion: version?.v ?? "?",
      postgresRole: pgRole ?? {
        rolsuper: false,
        rolbypassrls: false,
        rolcreaterole: false,
      },
      appTableOwner: owner?.owner ?? "?",
      q1Grant: grant
        ? { exists: true, ...grant }
        : { exists: false, inherit: null, set: null, admin: null },
      authUidDefinition: uidDef?.def ?? "?",
      accessTokenHeader: usesSupabase
        ? decodeJwtPart(users.uA.accessToken, 0)
        : null,
      publishableKeyKind: env.publishableKeyKind,
      secretKeyKind: env.secretKeyKind,
      pooler: {
        postgres: await poolerCheck(env.postgresPoolerUrl),
        appRuntime: await poolerCheck(env.runtimePoolerUrl),
      },
      extensions: extensions.map((e) => e.name),
      authenticatorConfig: redactSettings(authenticator?.config),
      runId,
    };

    await mkdir(env.resultsDir, { recursive: true });
    await writeFile(
      join(env.resultsDir, "meta.json"),
      `${JSON.stringify(meta, null, 2)}\n`,
    );

    const fixtures: Fixtures = { target: env.target, orgs, users, probe, meta };
    project.provide("fixtures", fixtures);
  } finally {
    await sql.end({ timeout: 5 });
  }
}
