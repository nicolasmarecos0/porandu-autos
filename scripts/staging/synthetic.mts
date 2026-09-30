import { createClient } from "@supabase/supabase-js";
import type { Sql } from "postgres";

import { StagingConfigError, type EnvSource } from "./target.mts";

/*
 * Datos sintéticos del acceptance Auth → Tenant en staging.
 *
 * - Usuarios: email `synthetic-<clave>-<run>@porandu-synthetic.test` (TLD
 *   reservado, RFC 2606) y `app_metadata.porandu_synthetic`, que solo puede
 *   escribir la Admin API. Se crean únicamente con la Admin API (el signup
 *   público de staging está cerrado).
 * - Organizaciones: nombre `SYNTHETIC H0 <run> · <clave>`, insertadas con la
 *   credencial de migración, igual que sus memberships y profiles.
 *
 * La limpieza borra solo filas con esas marcas: nunca DDL, nunca CASCADE,
 * nunca el schema, el historial de migraciones ni app_runtime. Un usuario
 * cuenta como sintético solo si tiene las dos marcas (dominio y
 * app_metadata). Si una organización sintética tiene memberships de usuarios
 * que no lo son, no borra nada y falla.
 */

export const SYNTHETIC_EMAIL_DOMAIN = "porandu-synthetic.test";
export const SYNTHETIC_MARKER_KEY = "porandu_synthetic";
export const SYNTHETIC_MARKER = "h0-staging-rollout";
export const SYNTHETIC_ORG_PREFIX = "SYNTHETIC H0 ";

const RUN_ID = /^[a-z0-9][a-z0-9-]{0,39}$/;
const KEY = /^[a-z0-9]{1,12}$/;

export function parseRunId(raw: string | undefined): string {
  const runId = raw?.trim() ?? "";
  if (!RUN_ID.test(runId)) {
    throw new StagingConfigError([
      "The synthetic run id must match [a-z0-9-] (at most 40 characters).",
    ]);
  }
  return runId;
}

export function syntheticEmail(runId: string, key: string): string {
  if (!KEY.test(key)) throw new Error("synthetic key must be [a-z0-9]");
  return `synthetic-${key}-${parseRunId(runId)}@${SYNTHETIC_EMAIL_DOMAIN}`;
}

export function syntheticOrganizationName(runId: string, key: string): string {
  return `${SYNTHETIC_ORG_PREFIX}${parseRunId(runId)} · ${key}`;
}

export function syntheticAppMetadata(runId: string): Record<string, string> {
  return {
    [SYNTHETIC_MARKER_KEY]: SYNTHETIC_MARKER,
    run_id: parseRunId(runId),
  };
}

export type SyntheticCandidate = Readonly<{
  id: string;
  email?: string | null;
  app_metadata?: Record<string, unknown> | null;
}>;

export function isSyntheticUser(
  user: SyntheticCandidate,
  runId?: string,
): boolean {
  const email = user.email?.toLowerCase() ?? "";
  const metadata = user.app_metadata ?? {};
  return (
    email.endsWith(`@${SYNTHETIC_EMAIL_DOMAIN}`) &&
    metadata[SYNTHETIC_MARKER_KEY] === SYNTHETIC_MARKER &&
    (runId === undefined || metadata.run_id === runId)
  );
}

/*
 * STAGING_SECRET_KEY (DEC-022): excepción operacional, solo en el workflow
 * Staging DB (environment `staging`) y solo para la Auth Admin API: crear y
 * eliminar usuarios sintéticos. Nunca runtime, Vercel ni navegador, y nunca
 * queries de producto ni Data API. Por eso el cliente con la secret key no
 * sale de este módulo: syntheticUserAdmin() expone solo esas dos
 * operaciones, y buscar usuarios sintéticos es una lectura SQL de
 * auth.users con la credencial de migración.
 */

/** Lo único que el tooling puede hacer con la secret key. */
export type SyntheticUserAdmin = {
  createUser(input: {
    runId: string;
    key: string;
    password: string;
  }): Promise<{ id: string; email: string }>;
  deleteUser(id: string): Promise<{ error: unknown }>;
};

/** La parte de la Admin API de Supabase Auth que usa el wrapper. */
export type AuthAdminApi = {
  createUser(attributes: {
    email: string;
    password: string;
    email_confirm: boolean;
    app_metadata: Record<string, string>;
  }): Promise<{
    data: { user: { id: string } | null };
    error: { code?: unknown } | null;
  }>;
  deleteUser(id: string): Promise<{ error: unknown }>;
};

/** STAGING_SECRET_KEY: solo Auth Admin API de datos sintéticos (DEC-022). */
export function readSecretKey(env: EnvSource): string {
  const key = env.STAGING_SECRET_KEY?.trim() ?? "";
  if (!key.startsWith("sb_secret_")) {
    throw new StagingConfigError([
      "STAGING_SECRET_KEY is required and must be a Supabase secret key (sb_secret_…).",
    ]);
  }
  return key;
}

/** Crea solo usuarios con las dos marcas sintéticas. */
export function wrapAuthAdmin(admin: AuthAdminApi): SyntheticUserAdmin {
  return {
    async createUser({ runId, key, password }) {
      const email = syntheticEmail(runId, key);
      const { data, error } = await admin.createUser({
        email,
        password,
        email_confirm: true,
        app_metadata: syntheticAppMetadata(runId),
      });
      if (error || !data.user) {
        const code = typeof error?.code === "string" ? error.code : "no user";
        throw new Error(`Auth Admin API: createUser failed (${code}).`);
      }
      return { id: data.user.id, email };
    },
    deleteUser: (id) => admin.deleteUser(id),
  };
}

/**
 * Auth Admin API con la secret key, sin sesión persistida ni refresh. El
 * cliente de Supabase no se devuelve: solo crear y eliminar usuarios.
 */
export function syntheticUserAdmin(
  supabaseUrl: string,
  secretKey: string,
): SyntheticUserAdmin {
  const client = createClient(supabaseUrl, secretKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });
  return wrapAuthAdmin(client.auth.admin);
}

/**
 * Usuarios sintéticos (dominio y marca de app_metadata) de una corrida o de
 * todas. Lectura de auth.users con la credencial de migración: no usa la
 * secret key.
 */
export async function listSyntheticUsers(
  sql: Sql,
  runId?: string,
): Promise<SyntheticCandidate[]> {
  const rows = await sql<
    { id: string; email: string | null; app_metadata: unknown }[]
  >`
    SELECT id, email, raw_app_meta_data AS app_metadata FROM auth.users
    WHERE email LIKE ${`%@${SYNTHETIC_EMAIL_DOMAIN}`}
    ORDER BY id
  `;
  return rows
    .map((row) => ({
      id: row.id,
      email: row.email,
      app_metadata:
        typeof row.app_metadata === "object" && row.app_metadata !== null
          ? (row.app_metadata as Record<string, unknown>)
          : null,
    }))
    .filter((user) => isSyntheticUser(user, runId));
}

export type CleanupReport = Readonly<{
  users: number;
  profiles: number;
  memberships: number;
  organizations: number;
}>;

/**
 * Borra los datos sintéticos de una corrida (`runId`) o de todas. Orden
 * explícito, sin depender de CASCADE: memberships → organizaciones →
 * profiles → usuarios de Auth (Admin API).
 */
export async function cleanupSynthetic(
  sql: Sql,
  admin: Pick<SyntheticUserAdmin, "deleteUser">,
  runId?: string,
): Promise<CleanupReport> {
  if (runId !== undefined) parseRunId(runId);
  const users = await listSyntheticUsers(sql, runId);
  const userIds = users.map((user) => user.id);
  const orgPrefix =
    runId === undefined
      ? SYNTHETIC_ORG_PREFIX
      : `${SYNTHETIC_ORG_PREFIX}${runId} `;

  const rows = await sql.begin(async (tx) => {
    const [tables] = await tx<{ ready: boolean }[]>`
      SELECT to_regclass('public.organizations') IS NOT NULL
        AND to_regclass('public.memberships') IS NOT NULL
        AND to_regclass('public.profiles') IS NOT NULL AS ready
    `;
    if (!tables?.ready)
      return { profiles: 0, memberships: 0, organizations: 0 };

    const orgs = await tx<{ id: string }[]>`
      SELECT id FROM public.organizations
      WHERE starts_with(name, ${orgPrefix})
      FOR UPDATE
    `;
    const orgIds = orgs.map((org) => org.id);

    const [foreign] = await tx<{ count: number }[]>`
      SELECT count(*)::int AS count FROM public.memberships
      WHERE organization_id = ANY(${orgIds}::uuid[])
        AND NOT (user_id = ANY(${userIds}::uuid[]))
    `;
    if ((foreign?.count ?? 0) > 0) {
      throw new Error(
        "cleanup-synthetic: synthetic organizations have memberships of non-synthetic users. Nothing was deleted.",
      );
    }

    const memberships = await tx`
      DELETE FROM public.memberships
      WHERE organization_id = ANY(${orgIds}::uuid[])
         OR user_id = ANY(${userIds}::uuid[])
      RETURNING id
    `;
    const organizations = await tx`
      DELETE FROM public.organizations WHERE id = ANY(${orgIds}::uuid[])
      RETURNING id
    `;
    const profiles = await tx`
      DELETE FROM public.profiles WHERE id = ANY(${userIds}::uuid[])
      RETURNING id
    `;
    return {
      profiles: profiles.count,
      memberships: memberships.count,
      organizations: organizations.count,
    };
  });

  let deleted = 0;
  for (const id of userIds) {
    const { error } = await admin.deleteUser(id);
    if (!error) deleted += 1;
  }
  if (deleted !== userIds.length) {
    throw new Error(
      `cleanup-synthetic: ${userIds.length - deleted} synthetic Auth users could not be deleted.`,
    );
  }
  return { users: deleted, ...rows };
}
