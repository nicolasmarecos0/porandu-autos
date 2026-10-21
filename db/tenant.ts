import "server-only";

import { sql } from "drizzle-orm";

import type { VerifiedClaims } from "@/lib/auth/claims";
import { isTenantContext, type TenantContext } from "@/lib/tenant/resolution";

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
 * Este módulo no verifica tokens ni valida organizaciones: recibe un contexto
 * confiable. Supabase Auth (H0.6, lib/auth/) produce la identidad con claims
 * verificados; Tenant Resolution (H0.7, `requireTenant()` en
 * lib/tenant/session.ts) construye el TenantContext con la organización
 * activa validada contra las memberships activas del usuario. withTenant()
 * lo consume pero no puede inventarlo: rechaza todo objeto que no haya
 * emitido lib/tenant/resolution.ts, aunque tenga la forma correcta.
 * withUser() solo lo usa la query de memberships propias
 * (db/queries/memberships.ts); ESLint lo impide en cualquier otro módulo.
 *
 * withIngestion() es la puerta del sistema, sin usuario (Hito 7, DEC-039
 * §4): la ingesta de los webhooks de WhatsApp. Asume `authenticated` sin
 * claims: sin usuario no hay membership, así que RLS no le deja ver ni
 * escribir ninguna fila y no satisface ninguna policy de miembro. Solo
 * escribe por `private.ingest_whatsapp_message()`, que rechaza cualquier
 * llamada con claims. Solo lo usa db/queries/ingest-whatsapp-message.ts;
 * ESLint lo impide en cualquier otro módulo.
 */

/** Usuario autenticado, todavía sin organización elegida. */
export type UserContext = Readonly<{
  userId: string;
  claims: VerifiedClaims;
}>;

/**
 * Usuario autenticado y organización ya validada contra sus memberships. Es
 * opaco: solo Tenant Resolution lo construye (lib/tenant/resolution.ts).
 */
export type { TenantContext };

/**
 * Transacción de withUser/withTenant (rol `authenticated` y claims locales)
 * o de withIngestion (rol `authenticated`, sin claims).
 */
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
  // Un objeto plano, un AuthenticatedUser o una copia de un contexto con
  // otra organización no pasan: solo lo que emitió Tenant Resolution.
  if (!isTenantContext(ctx)) {
    throw new TenantContextError("not issued by Tenant Resolution");
  }
  const claims = claimsOf(ctx);
  if (!isUuid(ctx.organizationId)) {
    throw new TenantContextError("organizationId must be a UUID");
  }
  return run(claims, fn);
}

/**
 * Puerta del sistema para la ingesta de mensajes entrantes (DEC-039 §4). Una
 * transacción cuyo primer statement vacía los claims y asume
 * `authenticated`, con alcance de transacción, como withTenant() (ADR-001
 * §3.2). Sin claims, RLS no deja ver ni escribir nada: la escritura pasa por
 * `private.ingest_whatsapp_message()`, y la organización la resuelve la base
 * a partir de la línea receptora, nunca el llamador.
 */
export async function withIngestion<T>(
  fn: (tx: ScopedTransaction) => Promise<T>,
): Promise<T> {
  return getDb().transaction(async (tx) => {
    // Un solo statement. El rol está fijo en el código.
    await tx.execute(
      sql`SELECT set_config('request.jwt.claims', '', true), set_config('role', 'authenticated', true)`,
    );
    return fn(tx);
  });
}
