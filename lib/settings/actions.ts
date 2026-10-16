"use server";

import { revalidatePath } from "next/cache";

import {
  changeMemberRole,
  deactivateMember,
  inviteMemberByEmail,
  updateOrganizationSettings,
  type MemberWriteOutcome,
} from "@/db/queries/settings-write";
import { canEditOrganization, canManageTeam } from "@/domains/team/members";
import { requireTenant } from "@/lib/tenant/session";

import {
  parseInvitationRequest,
  parseMembershipId,
  parseOrganizationRequest,
  parseRoleRequest,
  type InviteMemberState,
  type MemberActionState,
  type UpdateOrganizationState,
} from "./requests";

/*
 * Configuración del concesionario y gestión del equipo (Hito 6, DEC-038
 * §5): las únicas puertas de escritura de `organizations` y `memberships`.
 *
 *   requireTenant() → rol `admin` → leer y validar el pedido (Zod) →
 *   db/queries/settings-write.ts (withTenant(), filtro explícito por la
 *   organización activa, RLS de admin, triggers de guarda) → revalidar
 *   /settings
 *
 * 1. El TenantContext sale de requireTenant(), como en toda acción
 *    tenant-scoped (DEC-021): sin sesión → /login, sin membership activa →
 *    /no-access. El rol es el de la membership en la base.
 * 2. RBAC (DEC-038 §5): solo `admin` edita la organización, invita, cambia
 *    roles o revoca. Un `seller` recibe `forbidden` antes de leer el pedido,
 *    y si esta regla faltara, la base lo rechaza igual (policies con
 *    private.user_admin_org_ids(), DEC-038 §4).
 * 3. La organización nunca sale del pedido. Un id de membership malformado,
 *    ajeno o de otra organización es `not_found`, sin revelar nada.
 * 4. Nadie cambia ni revoca su propia membership, y la organización nunca
 *    se queda sin admin activo: lo decide el trigger de la base y vuelve
 *    como `self` o `last_admin`.
 * 5. Un error inesperado no expone detalles de la base: se registra solo el
 *    tipo, el SQLSTATE y la constraint (nunca emails ni nombres).
 * 6. Invitar no crea cuentas ni envía correos (DEC-038 §3, DEC-020): da
 *    acceso a una cuenta de Porandú que ya existe.
 *
 * El estado previo (`_previous`) lo envía el cliente: no se usa.
 */

const SETTINGS_PATH = "/settings";
const TEAM_PATH = "/settings/team";

function logFailure(operation: string, error: unknown): void {
  const { name, cause } =
    error instanceof Error ? error : { name: undefined, cause: undefined };
  const detail = (key: "code" | "constraint_name") =>
    typeof cause === "object" && cause !== null && key in cause
      ? (cause as Record<typeof key, unknown>)[key]
      : undefined;
  console.error(`[settings] ${operation} failed`, {
    name,
    code: detail("code"),
    constraint_name: detail("constraint_name"),
  });
}

export async function updateOrganization(
  _previous: UpdateOrganizationState,
  formData: FormData,
): Promise<UpdateOrganizationState> {
  const ctx = await requireTenant();
  if (!canEditOrganization(ctx.role)) return { status: "forbidden" };

  const parsed = parseOrganizationRequest(formData);
  if (parsed.kind === "invalid") {
    return { status: "invalid", errors: parsed.errors, values: parsed.values };
  }

  try {
    const { outcome } = await updateOrganizationSettings(ctx, parsed.settings);
    if (outcome === "forbidden") return { status: "forbidden" };
  } catch (error) {
    logFailure("update organization", error);
    return { status: "failed", values: parsed.values };
  }
  revalidatePath(SETTINGS_PATH);
  return { status: "saved", settings: parsed.settings };
}

export async function inviteMember(
  _previous: InviteMemberState,
  formData: FormData,
): Promise<InviteMemberState> {
  const ctx = await requireTenant();
  if (!canManageTeam(ctx.role)) return { status: "forbidden" };

  const parsed = parseInvitationRequest(formData);
  if (parsed.kind === "invalid") {
    return { status: "invalid", errors: parsed.errors, values: parsed.values };
  }

  try {
    const result = await inviteMemberByEmail(ctx, parsed.invitation);
    switch (result.outcome) {
      case "added":
      case "reactivated":
        revalidatePath(TEAM_PATH);
        return { status: result.outcome, invitation: parsed.invitation };
      case "already_member":
        return { status: "already_member", invitation: parsed.invitation };
      case "no_account":
        return { status: "no_account", values: parsed.values };
      case "forbidden":
        return { status: "forbidden" };
    }
  } catch (error) {
    logFailure("invite member", error);
    return { status: "failed", values: parsed.values };
  }
}

function memberState(
  outcome: MemberWriteOutcome,
  done: "updated" | "removed",
): MemberActionState {
  switch (outcome.outcome) {
    case "updated":
      revalidatePath(TEAM_PATH);
      return { status: done };
    case "not_found":
    case "self":
    case "last_admin":
      return { status: outcome.outcome };
  }
}

export async function updateMemberRole(
  _previous: MemberActionState,
  formData: FormData,
): Promise<MemberActionState> {
  const ctx = await requireTenant();
  if (!canManageTeam(ctx.role)) return { status: "forbidden" };

  const membershipId = parseMembershipId(formData);
  if (membershipId === null) return { status: "not_found" };
  const role = parseRoleRequest(formData);
  if (role === null) return { status: "invalid" };

  try {
    return memberState(
      await changeMemberRole(ctx, membershipId, role),
      "updated",
    );
  } catch (error) {
    logFailure("update member role", error);
    return { status: "failed" };
  }
}

export async function removeMember(
  _previous: MemberActionState,
  formData: FormData,
): Promise<MemberActionState> {
  const ctx = await requireTenant();
  if (!canManageTeam(ctx.role)) return { status: "forbidden" };

  const membershipId = parseMembershipId(formData);
  if (membershipId === null) return { status: "not_found" };

  try {
    return memberState(await deactivateMember(ctx, membershipId), "removed");
  } catch (error) {
    logFailure("remove member", error);
    return { status: "failed" };
  }
}
