import type { Sql } from "postgres";

import type { TenantContext, UserContext } from "@/db/tenant";

/*
 * Tenants de prueba. Se insertan con el superusuario y quedan committeados:
 * withUser()/withTenant() los leen por sus propias conexiones.
 *
 *   A: admin de ORG_1.
 *   B: admin de ORG_2.
 *   C: seller de ORG_1 y admin de ORG_3 (varias memberships) y seller
 *      inactivo de ORG_2.
 *   D: solo una membership inactiva (seller de ORG_1).
 *   E: perfil sin memberships.
 */

export const ORG_1 = "00000000-0000-4000-8000-000000000001";
export const ORG_2 = "00000000-0000-4000-8000-000000000002";
export const ORG_3 = "00000000-0000-4000-8000-000000000003";

export const USER_A = "00000000-0000-4000-8000-00000000000a";
export const USER_B = "00000000-0000-4000-8000-00000000000b";
export const USER_C = "00000000-0000-4000-8000-00000000000c";
export const USER_D = "00000000-0000-4000-8000-00000000000d";
export const USER_E = "00000000-0000-4000-8000-00000000000e";

export const USERS = [USER_A, USER_B, USER_C, USER_D, USER_E];

type Membership = {
  organizationId: string;
  userId: string;
  role: "admin" | "seller";
  active: boolean;
};

export const MEMBERSHIPS: Membership[] = [
  { organizationId: ORG_1, userId: USER_A, role: "admin", active: true },
  { organizationId: ORG_2, userId: USER_B, role: "admin", active: true },
  { organizationId: ORG_1, userId: USER_C, role: "seller", active: true },
  { organizationId: ORG_3, userId: USER_C, role: "admin", active: true },
  { organizationId: ORG_2, userId: USER_C, role: "seller", active: false },
  { organizationId: ORG_1, userId: USER_D, role: "seller", active: false },
];

/** Organizaciones con membership activa: lo que RLS debe dejar ver. */
export function activeOrganizations(userId: string): string[] {
  return MEMBERSHIPS.filter((m) => m.userId === userId && m.active)
    .map((m) => m.organizationId)
    .sort();
}

export async function seedTenants(admin: Sql): Promise<void> {
  await admin.begin(async (tx) => {
    await tx`INSERT INTO auth.users ${tx(USERS.map((id) => ({ id })))}`;
    await tx`
      INSERT INTO public.profiles ${tx(
        USERS.map((id) => ({ id, full_name: `Usuario ${id.at(-1)}` })),
      )}
    `;
    await tx`
      INSERT INTO public.organizations ${tx([
        { id: ORG_1, name: "Organización 1" },
        { id: ORG_2, name: "Organización 2" },
        { id: ORG_3, name: "Organización 3" },
      ])}
    `;
    await tx`
      INSERT INTO public.memberships ${tx(
        MEMBERSHIPS.map((m) => ({
          organization_id: m.organizationId,
          user_id: m.userId,
          role: m.role,
          active: m.active,
        })),
      )}
    `;
  });
}

/*
 * Contextos que en runtime salen de la identidad verificada por Supabase Auth
 * (H0.6) y, con la organización activa validada, de Tenant Resolution (H0.7).
 * En los tests se construyen directo: un contexto "falsificado" (usuario de
 * una organización ajena) es solo otra combinación.
 */
export function userContext(userId: string): UserContext {
  return { userId, claims: { sub: userId, role: "authenticated" } };
}

export function tenantContext(
  userId: string,
  organizationId: string,
): TenantContext {
  return { ...userContext(userId), organizationId };
}
