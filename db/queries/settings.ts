import "server-only";

import { eq, sql } from "drizzle-orm";

import type { Currency } from "@/domains/money";
import {
  buildTeamView,
  canEditOrganization,
  MEMBER_ROLES,
  type MemberRole,
  type TeamMemberRow,
  type TeamView,
} from "@/domains/team/members";
import { requireTenant } from "@/lib/tenant/session";

import { organizations } from "../schema";
import { withTenant } from "../tenant";

/*
 * Configuración y equipo del concesionario desde PostgreSQL (Hito 6,
 * DEC-038). Solo lectura.
 *
 *   request → requireTenant() → TenantContext → withTenant() → organización
 *   activa (filtro explícito + RLS) / miembros activos
 *   (private.organization_members()) → dominio → ViewModel
 *
 * - requireTenant() valida en cada request la organización activa contra
 *   las memberships activas del usuario (DEC-021). El layout de (app) es solo
 *   un gate de UX: cada loader pide su propio contexto.
 * - El rol del viewer sale del TenantContext (la membership en la base),
 *   nunca del cliente. Solo decide qué acciones muestra la UI: la barrera
 *   está en las Server Actions y en la base (DEC-038 §5).
 * - Los miembros los lee `private.organization_members()` (DEC-038 §6):
 *   profiles sigue mostrando solo el perfil propio (DEC-019) y auth.users no
 *   se expone. La función solo responde a un miembro activo de la
 *   organización pedida; el id que recibe es el del contexto.
 */

export type OrganizationSettingsView = Readonly<{
  name: string;
  defaultCurrency: Currency;
  /** El viewer puede editar (rol `admin`). */
  canEdit: boolean;
}>;

export async function getOrganizationSettings(): Promise<OrganizationSettingsView> {
  const ctx = await requireTenant();
  const [row] = await withTenant(ctx, (tx) =>
    tx
      .select({
        name: organizations.name,
        defaultCurrency: organizations.defaultCurrency,
      })
      .from(organizations)
      .where(eq(organizations.id, ctx.organizationId))
      .limit(1),
  );
  // RLS y el filtro dejan ver la organización activa: si no está, el
  // contexto ya no vale (membership revocada entre lecturas).
  if (!row) throw new Error("active organization not visible");
  return {
    name: row.name,
    defaultCurrency: row.defaultCurrency as Currency,
    canEdit: canEditOrganization(ctx.role),
  };
}

type MemberDbRow = {
  membership_id: string;
  user_id: string;
  full_name: string | null;
  email: string | null;
  role: string;
  joined_at: string | Date;
};

function isMemberRole(value: string): value is MemberRole {
  return (MEMBER_ROLES as readonly string[]).includes(value);
}

/** Una fila de la base, con forma esperada, o null (falla cerrado). */
export function memberFromDb(row: MemberDbRow): TeamMemberRow | null {
  if (!isMemberRole(row.role)) return null;
  const joinedAt = new Date(row.joined_at);
  if (Number.isNaN(joinedAt.getTime())) return null;
  return {
    membershipId: row.membership_id,
    userId: row.user_id,
    fullName: row.full_name,
    email: row.email,
    role: row.role,
    joinedAt,
  };
}

export async function getTeam(): Promise<TeamView> {
  const ctx = await requireTenant();
  const rows = await withTenant(ctx, (tx) =>
    tx.execute<MemberDbRow>(
      sql`SELECT membership_id, user_id, full_name, email, role, joined_at FROM private.organization_members(${ctx.organizationId})`,
    ),
  );
  const members = [...rows].flatMap((row) => memberFromDb(row) ?? []);
  return buildTeamView(members, { userId: ctx.userId, role: ctx.role });
}
