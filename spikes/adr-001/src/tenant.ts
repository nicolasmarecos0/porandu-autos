import { sql } from "drizzle-orm";
import type { VerifiedClaims } from "./claims";
import type { RuntimeDb } from "./runtime";

/*
 * Única puerta de acceso a datos del spike (prototipo de db/tenant.ts).
 *
 * withTenant / withUser abren UNA transacción y, en un solo statement:
 *   - set_config('request.jwt.claims', <claims verificados>, true)
 *   - set_config('role', 'authenticated', true)   ≡ SET LOCAL ROLE authenticated
 * Ambos son transaction-local: al COMMIT o ROLLBACK la conexión vuelve a ser
 * `app_runtime` sin claims. Los claims van parametrizados, nunca con sql.raw,
 * y el rol está fijo en el código: nunca sale del token.
 */

export type MembershipRole = "admin" | "seller";

declare const tenantContextBrand: unique symbol;

/** Solo lo construye resolveTenant() después de validar la membership. */
export type TenantContext = {
  readonly userId: string;
  readonly organizationId: string;
  readonly role: MembershipRole;
  readonly claims: VerifiedClaims;
} & { readonly [tenantContextBrand]: true };

type Db = RuntimeDb["db"];
export type TenantTx = Parameters<Parameters<Db["transaction"]>[0]>[0];

async function setRequestIdentity(
  tx: TenantTx,
  claims: VerifiedClaims,
): Promise<void> {
  await tx.execute(
    sql`select set_config('request.jwt.claims', ${JSON.stringify(claims)}, true), set_config('role', 'authenticated', true)`,
  );
}

/** Transacción con identidad de usuario pero sin organización (resolver memberships). */
export function withUser<T>(
  runtime: RuntimeDb,
  claims: VerifiedClaims,
  fn: (tx: TenantTx) => Promise<T>,
): Promise<T> {
  return runtime.db.transaction(async (tx) => {
    await setRequestIdentity(tx, claims);
    return fn(tx);
  });
}

/** Transacción tenant-scoped. Las queries además filtran por ctx.organizationId. */
export function withTenant<T>(
  runtime: RuntimeDb,
  ctx: TenantContext,
  fn: (tx: TenantTx) => Promise<T>,
): Promise<T> {
  if (ctx.claims.sub !== ctx.userId) {
    return Promise.reject(new Error("TenantContext inconsistente"));
  }
  return withUser(runtime, ctx.claims, fn);
}

/** Uso exclusivo de resolveTenant() (tenant-context.ts). */
export function brandTenantContext(
  value: Omit<TenantContext, typeof tenantContextBrand>,
): TenantContext {
  return value as TenantContext;
}
