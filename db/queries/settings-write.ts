import "server-only";

import { and, eq, sql } from "drizzle-orm";

import type { OrganizationSettings } from "@/domains/settings/organization";
import type { Invitation, MemberRole } from "@/domains/team/members";

import { memberships, organizations } from "../schema";
import { withTenant, type TenantContext } from "../tenant";

/*
 * Escrituras de la configuración y del equipo (Hito 6, DEC-038 §4). Las
 * únicas puertas son las Server Actions de lib/settings/actions.ts, que
 * obtienen el contexto con requireTenant(), exigen rol `admin` y validan el
 * pedido antes de llegar acá; ESLint impide importar este módulo desde
 * cualquier otro lado.
 *
 *   TenantContext → withTenant() → UPDATE / INSERT con filtro explícito por
 *   la organización activa → RLS (solo `admin` activo, USING y WITH CHECK)
 *   → triggers de guarda (membership propia, último admin, identidad,
 *   updated_at) → COMMIT
 *
 * Este módulo no vuelve a mirar el rol: lo hacen las acciones (capa de
 * aplicación) y la base (policies con private.user_admin_org_ids()). Así un
 * test puede llamarlo con un contexto de `seller` y comprobar que la base
 * sola lo rechaza (DEC-038 §5, defensa en profundidad).
 *
 * - La organización sale siempre del contexto, nunca del cliente.
 * - Una membership ajena, inexistente o de otra organización es `not_found`
 *   sin revelar si existe. Revocar es `active = false` (DEC-018): no se borra.
 * - El rechazo de un trigger vuelve como resultado (`self`, `last_admin`),
 *   no como error.
 */

export type OrganizationWriteOutcome =
  | Readonly<{ outcome: "updated" }>
  /** RLS no dejó editar: el usuario no es `admin` activo. Nada cambió. */
  | Readonly<{ outcome: "forbidden" }>;

export type InviteOutcome =
  | Readonly<{ outcome: "added"; membershipId: string }>
  /** Tenía una membership revocada: vuelve activa con el rol pedido. */
  | Readonly<{ outcome: "reactivated"; membershipId: string }>
  /** Ya es miembro activo: nada cambió (tampoco su rol). */
  | Readonly<{ outcome: "already_member" }>
  /** No hay una cuenta de Porandú con ese email. Nada cambió. */
  | Readonly<{ outcome: "no_account" }>
  | Readonly<{ outcome: "forbidden" }>;

export type MemberWriteOutcome =
  | Readonly<{ outcome: "updated" }>
  /** No existe, no está activa o no es de la organización activa. */
  | Readonly<{ outcome: "not_found" }>
  /** Es la membership del propio usuario (memberships_self_change). */
  | Readonly<{ outcome: "self" }>
  /** La organización se quedaría sin admin activo (memberships_last_admin). */
  | Readonly<{ outcome: "last_admin" }>;

/* ── Errores de la base ─────────────────────────────────────────────────── */

type PgDetail = { code?: unknown; constraint_name?: unknown };

/** SQLSTATE y constraint del error de Postgres (Drizzle lo envuelve). */
export function pgDetail(error: unknown): {
  code: string | undefined;
  constraint: string | undefined;
} {
  const candidates: unknown[] = [
    error,
    error instanceof Error ? error.cause : undefined,
  ];
  for (const candidate of candidates) {
    if (typeof candidate !== "object" || candidate === null) continue;
    const { code, constraint_name } = candidate as PgDetail;
    if (typeof code === "string") {
      return {
        code,
        constraint:
          typeof constraint_name === "string" ? constraint_name : undefined,
      };
    }
  }
  return { code: undefined, constraint: undefined };
}

const INSUFFICIENT_PRIVILEGE = "42501";
const CHECK_VIOLATION = "23514";

/** Traduce el rechazo de un trigger de memberships; si no lo es, lo relanza. */
function guardOutcome(error: unknown): MemberWriteOutcome {
  const { code, constraint } = pgDetail(error);
  if (code === CHECK_VIOLATION && constraint === "memberships_self_change") {
    return { outcome: "self" };
  }
  if (code === CHECK_VIOLATION && constraint === "memberships_last_admin") {
    return { outcome: "last_admin" };
  }
  throw error;
}

/* ── Organización ───────────────────────────────────────────────────────── */

export async function updateOrganizationSettings(
  ctx: TenantContext,
  settings: OrganizationSettings,
): Promise<OrganizationWriteOutcome> {
  return withTenant(ctx, async (tx) => {
    const updated = await tx
      .update(organizations)
      .set({ name: settings.name, defaultCurrency: settings.defaultCurrency })
      .where(eq(organizations.id, ctx.organizationId))
      .returning({ id: organizations.id });
    return updated.length === 1
      ? { outcome: "updated" }
      : { outcome: "forbidden" };
  });
}

/* ── Equipo ─────────────────────────────────────────────────────────────── */

/**
 * Invita a la organización activa a la cuenta de Porandú con ese email
 * (DEC-038 §3): la membership nace activa con el rol pedido, o una revocada
 * vuelve activa con ese rol. No crea cuentas ni envía correos.
 */
export async function inviteMemberByEmail(
  ctx: TenantContext,
  invitation: Invitation,
): Promise<InviteOutcome> {
  try {
    return await withTenant(ctx, async (tx): Promise<InviteOutcome> => {
      const { organizationId } = ctx;
      const [candidate] = await tx.execute<{ user_id: string | null }>(
        sql`SELECT private.find_member_candidate(${organizationId}, ${invitation.email}) AS user_id`,
      );
      const userId = candidate?.user_id ?? null;
      if (userId === null) return { outcome: "no_account" };

      const [row] = await tx
        .insert(memberships)
        .values({ organizationId, userId, role: invitation.role })
        .onConflictDoUpdate({
          target: [memberships.organizationId, memberships.userId],
          set: { role: invitation.role, active: true },
          setWhere: eq(memberships.active, false),
        })
        .returning({
          id: memberships.id,
          inserted: sql<boolean>`(xmax = 0)`,
        });
      if (!row) return { outcome: "already_member" };
      return row.inserted
        ? { outcome: "added", membershipId: row.id }
        : { outcome: "reactivated", membershipId: row.id };
    });
  } catch (error) {
    // find_member_candidate() solo responde a un admin activo.
    if (pgDetail(error).code === INSUFFICIENT_PRIVILEGE) {
      return { outcome: "forbidden" };
    }
    throw error;
  }
}

/** Cambia el rol de un miembro activo de la organización activa. */
export async function changeMemberRole(
  ctx: TenantContext,
  membershipId: string,
  role: MemberRole,
): Promise<MemberWriteOutcome> {
  try {
    return await withTenant(ctx, async (tx): Promise<MemberWriteOutcome> => {
      const updated = await tx
        .update(memberships)
        .set({ role })
        .where(
          and(
            eq(memberships.id, membershipId),
            eq(memberships.organizationId, ctx.organizationId),
            eq(memberships.active, true),
          ),
        )
        .returning({ id: memberships.id });
      return updated.length === 1
        ? { outcome: "updated" }
        : { outcome: "not_found" };
    });
  } catch (error) {
    return guardOutcome(error);
  }
}

/** Revoca el acceso de un miembro activo: `active = false` (DEC-018). */
export async function deactivateMember(
  ctx: TenantContext,
  membershipId: string,
): Promise<MemberWriteOutcome> {
  try {
    return await withTenant(ctx, async (tx): Promise<MemberWriteOutcome> => {
      const updated = await tx
        .update(memberships)
        .set({ active: false })
        .where(
          and(
            eq(memberships.id, membershipId),
            eq(memberships.organizationId, ctx.organizationId),
            eq(memberships.active, true),
          ),
        )
        .returning({ id: memberships.id });
      return updated.length === 1
        ? { outcome: "updated" }
        : { outcome: "not_found" };
    });
  } catch (error) {
    return guardOutcome(error);
  }
}
