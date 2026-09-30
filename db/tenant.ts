import "server-only";

import { sql } from "drizzle-orm";

import { getDb, type RuntimeDatabase } from "./client";

/*
 * Boundary de acceso a datos (ADR-001 §2 y §4). Es la única puerta al
 * cliente de runtime: fuera de este módulo, ESLint prohíbe importar
 * db/client.
 *
 * Cada llamada abre una transacción cuyo primer statement fija, con alcance
 * de transacción, los claims de la request y el rol `authenticated`
 * (`set_config(..., true)`, equivalente a SET LOCAL). Al COMMIT, ROLLBACK o
 * error la conexión vuelve a ser `app_runtime` sin claims, que no tiene
 * privilegios sobre ninguna tabla: fuera de este boundary todo falla cerrado.
 * Nunca se usa SET de sesión ni `set_config(..., false)` (ADR-001 §3.2).
 *
 * RLS es la barrera de aislamiento: cada fila queda limitada a las
 * organizaciones con membership activa del usuario de los claims. El
 * `organizationId` del contexto no llega a la base; las queries lo usan como
 * filtro explícito (defense in depth) y las escrituras lo toman de ahí,
 * nunca del input del cliente.
 *
 * H0.5 no verifica tokens. El contexto lo construirá H0.6 a partir de claims
 * verificados por Supabase Auth y de una organización validada contra las
 * memberships activas del usuario; hasta entonces solo lo construyen tests.
 */

/** Claims de un access token verificado por Supabase Auth (H0.6). */
export type VerifiedClaims = Readonly<
  Record<string, unknown> & { sub: string; role: "authenticated" }
>;

/** Usuario autenticado, todavía sin organización elegida. */
export type UserContext = Readonly<{
  userId: string;
  claims: VerifiedClaims;
}>;

/** Usuario autenticado y organización ya validada contra sus memberships. */
export type TenantContext = UserContext & Readonly<{ organizationId: string }>;

/** Transacción de withUser/withTenant: rol `authenticated` y claims locales. */
export type ScopedTransaction = Parameters<
  Parameters<RuntimeDatabase["transaction"]>[0]
>[0];

export class TenantContextError extends Error {
  constructor(reason: string) {
    super(`Invalid tenant context: ${reason}`);
    this.name = "TenantContextError";
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID.test(value);
}

/*
 * Valida la forma del contexto antes de tocar la base. Un contexto inválido
 * no abre transacción: falla cerrado.
 */
function claimsOf(ctx: UserContext): string {
  if (typeof ctx !== "object" || ctx === null) {
    throw new TenantContextError("missing context");
  }
  if (!isUuid(ctx.userId)) {
    throw new TenantContextError("userId must be a UUID");
  }
  const { claims } = ctx;
  if (typeof claims !== "object" || claims === null) {
    throw new TenantContextError("missing claims");
  }
  if (claims.sub !== ctx.userId) {
    throw new TenantContextError("claims.sub does not match userId");
  }
  if (claims.role !== "authenticated") {
    throw new TenantContextError("claims.role must be authenticated");
  }
  return JSON.stringify(claims);
}

function run<T>(
  claims: string,
  fn: (tx: ScopedTransaction) => Promise<T>,
): Promise<T> {
  return getDb().transaction(async (tx) => {
    // Un solo statement. Los claims viajan como parámetro, nunca como SQL
    // interpolado; el rol está fijo en el código y no sale del token.
    await tx.execute(
      sql`SELECT set_config('request.jwt.claims', ${claims}, true), set_config('role', 'authenticated', true)`,
    );
    return fn(tx);
  });
}

/**
 * Acceso con la identidad del usuario y sin organización: leer las
 * memberships propias antes de elegir organización (filtrando por
 * `ctx.userId`).
 */
export async function withUser<T>(
  ctx: UserContext,
  fn: (tx: ScopedTransaction) => Promise<T>,
): Promise<T> {
  return run(claimsOf(ctx), fn);
}

/**
 * Única puerta de acceso a datos tenant-scoped. Las queries filtran por
 * `ctx.organizationId`; RLS impide igualmente ver otra organización.
 */
export async function withTenant<T>(
  ctx: TenantContext,
  fn: (tx: ScopedTransaction) => Promise<T>,
): Promise<T> {
  const claims = claimsOf(ctx);
  if (!isUuid(ctx.organizationId)) {
    throw new TenantContextError("organizationId must be a UUID");
  }
  return run(claims, fn);
}
