import "server-only";

import { and, asc, eq } from "drizzle-orm";

import type { AuthenticatedUser } from "@/lib/auth/claims";

import { memberships, organizations, type membershipRole } from "../schema";
import { withUser } from "../tenant";

/*
 * Memberships activas del usuario autenticado (Tenant Resolution, H0.7).
 *
 * Es la única query que corre con withUser(): lee las memberships propias
 * antes de que exista una organización elegida (ADR-001 §4). ESLint solo
 * permite importar withUser() desde este módulo.
 *
 * RLS deja ver las memberships de todas las organizaciones donde el usuario
 * tiene membership activa, incluidas las de otros usuarios. Por eso el
 * filtro explícito por `user_id` es obligatorio: sin él, la lista mezclaría
 * memberships ajenas. `user_id` sale siempre de la identidad verificada
 * (claims de Supabase Auth), nunca de input del cliente.
 */

export type MembershipRole = (typeof membershipRole.enumValues)[number];

/** Lo mínimo para resolver el tenant y mostrar el selector. */
export type ActiveMembership = Readonly<{
  organizationId: string;
  organizationName: string;
  role: MembershipRole;
}>;

export async function listActiveMemberships(
  user: AuthenticatedUser,
): Promise<ActiveMembership[]> {
  return withUser(user, (tx) =>
    tx
      .select({
        organizationId: memberships.organizationId,
        organizationName: organizations.name,
        role: memberships.role,
      })
      .from(memberships)
      .innerJoin(
        organizations,
        eq(organizations.id, memberships.organizationId),
      )
      .where(
        and(eq(memberships.userId, user.userId), eq(memberships.active, true)),
      )
      .orderBy(asc(organizations.name), asc(organizations.id)),
  );
}
