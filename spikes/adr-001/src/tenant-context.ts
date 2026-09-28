import { and, eq } from "drizzle-orm";
import type { VerifiedClaims } from "./claims";
import type { RuntimeDb } from "./runtime";
import { memberships } from "./schema";
import { brandTenantContext, withUser, type TenantContext } from "./tenant";

/*
 * Prototipo de requireTenant() sin Next: en el producto la org solicitada sale
 * de una cookie httpOnly. Esa cookie es solo una preferencia; la fuente de
 * verdad son las memberships ACTIVAS del usuario, leídas en cada request.
 */

export type TenantResolution =
  | { readonly kind: "ok"; readonly ctx: TenantContext }
  | {
      readonly kind: "select-organization";
      readonly organizationIds: readonly string[];
    }
  | { readonly kind: "no-access" };

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function resolveTenant(
  runtime: RuntimeDb,
  claims: VerifiedClaims,
  requestedOrganizationId: string | null,
): Promise<TenantResolution> {
  const rows = await withUser(runtime, claims, (tx) =>
    tx
      .select({
        organizationId: memberships.organizationId,
        role: memberships.role,
      })
      .from(memberships)
      // Filtro explícito además de RLS: RLS deja ver memberships de otros
      // usuarios de mis organizaciones; acá solo interesan las propias.
      .where(
        and(eq(memberships.userId, claims.sub), eq(memberships.active, true)),
      ),
  );

  if (rows.length === 0) return { kind: "no-access" };

  const requested =
    requestedOrganizationId !== null && UUID_RE.test(requestedOrganizationId)
      ? rows.find((row) => row.organizationId === requestedOrganizationId)
      : undefined;
  const chosen = requested ?? (rows.length === 1 ? rows[0] : undefined);

  if (!chosen) {
    return {
      kind: "select-organization",
      organizationIds: rows.map((row) => row.organizationId),
    };
  }

  return {
    kind: "ok",
    ctx: brandTenantContext({
      userId: claims.sub,
      organizationId: chosen.organizationId,
      role: chosen.role,
      claims,
    }),
  };
}
