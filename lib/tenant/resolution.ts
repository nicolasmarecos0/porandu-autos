import type {
  ActiveMembership,
  MembershipRole,
} from "@/db/queries/memberships";
import type { AuthenticatedUser, VerifiedClaims } from "@/lib/auth/claims";

/*
 * Tenant Resolution (H0.7): el único lugar que construye un TenantContext.
 *
 * Módulo puro: no importa Next, React, Supabase ni db/ (solo tipos). Recibe
 * el usuario verificado (H0.6) y sus memberships activas leídas de la base, y
 * decide la organización activa. La organización preferida (la cookie) es
 * solo una preferencia: nunca concede acceso por sí sola y el rol sale
 * siempre de la membership.
 *
 * Un TenantContext es opaco:
 * - Tipo: la marca `[TRUSTED]` es un `unique symbol` que no se exporta, así
 *   que ningún objeto literal escrito fuera de este módulo tiene ese tipo.
 * - Runtime: cada contexto emitido queda registrado en un WeakSet privado y
 *   congelado. withTenant() (db/tenant.ts) rechaza cualquier objeto que no
 *   salió de acá, aunque tenga la forma correcta o se haya forzado con `as`,
 *   y también una copia (`{ ...ctx }`) con otra organización.
 * - ESLint: solo lib/tenant/session.ts (requireTenant()) y los tests
 *   importan resolveTenant().
 */

declare const TRUSTED: unique symbol;

/** Usuario verificado + organización validada contra sus memberships activas. */
export type TenantContext = Readonly<{
  userId: string;
  claims: VerifiedClaims;
  organizationId: string;
  /** Rol de la membership en la base; nunca del JWT, la cookie ni un form. */
  role: MembershipRole;
}> & { readonly [TRUSTED]: true };

export type TenantResolution =
  | Readonly<{ kind: "resolved"; context: TenantContext }>
  | Readonly<{ kind: "no-access" }>
  | Readonly<{ kind: "select-organization" }>;

const issued = new WeakSet<object>();

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ROLES: readonly string[] = ["admin", "seller"] satisfies MembershipRole[];

/** ¿Lo emitió resolveTenant()? Es lo que exige withTenant(). */
export function isTenantContext(value: unknown): value is TenantContext {
  return typeof value === "object" && value !== null && issued.has(value);
}

/**
 * Organización enviada por el cliente (selector): input no confiable. Devuelve
 * el UUID normalizado, o null. Que sea un UUID no significa que el usuario
 * pertenezca: eso se valida contra sus memberships activas.
 */
export function parseOrganizationId(raw: unknown): string | null {
  return typeof raw === "string" && UUID.test(raw) ? raw.toLowerCase() : null;
}

// Defensa: una fila con forma inesperada no participa (falla cerrado).
function isWellFormed(membership: ActiveMembership): boolean {
  return (
    UUID.test(membership.organizationId) && ROLES.includes(membership.role)
  );
}

function issue(
  user: AuthenticatedUser,
  membership: ActiveMembership,
): TenantResolution {
  const context = Object.freeze({
    userId: user.userId,
    claims: Object.freeze({ ...user.claims }),
    organizationId: membership.organizationId,
    role: membership.role,
  }) as TenantContext;
  issued.add(context);
  return { kind: "resolved", context };
}

/**
 * Algoritmo oficial:
 * - 0 memberships activas → no-access;
 * - 1 → esa organización, con o sin cookie (una cookie ajena o vieja no
 *   bloquea ni concede otro tenant);
 * - 2+ → la de la cookie solo si coincide exactamente con una membership
 *   activa; si no hay cookie o no coincide → select-organization.
 *
 * `memberships` tienen que ser las activas de `user`, leídas en esta request
 * (listActiveMemberships()).
 */
export function resolveTenant(
  user: AuthenticatedUser,
  memberships: readonly ActiveMembership[],
  preferredOrganizationId: string | null | undefined,
): TenantResolution {
  const candidates = memberships.filter(isWellFormed);
  const [only] = candidates;
  if (!only) return { kind: "no-access" };
  if (candidates.length === 1) return issue(user, only);

  const preferred = candidates.find(
    (membership) => membership.organizationId === preferredOrganizationId,
  );
  return preferred ? issue(user, preferred) : { kind: "select-organization" };
}
