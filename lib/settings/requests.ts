import {
  ORGANIZATION_FIELDS,
  ORGANIZATION_NAME_MAX_LENGTH,
  parseOrganizationSettings,
  type OrganizationErrors,
  type OrganizationSettings,
  type OrganizationValues,
} from "@/domains/settings/organization";
import {
  EMAIL_MAX_LENGTH,
  INVITATION_FIELDS,
  MEMBER_FIELDS,
  parseInvitation,
  parseMemberRole,
  type Invitation,
  type InvitationErrors,
  type InvitationValues,
  type MemberRole,
} from "@/domains/team/members";

/*
 * Pedidos y respuestas de las Server Actions de Configuración (Hito 6,
 * DEC-038 §5). Cada pedido trae solo sus campos: la organización nunca sale
 * del cliente (es la del TenantContext), y cualquier otro campo se ignora
 * porque no tiene adónde ir. Nada de esto expone la base: ni SQLSTATE, ni
 * constraints, ni si un id existe en otra organización.
 */

/* ── Respuestas ─────────────────────────────────────────────────────────── */

/** Respuesta de updateOrganization(). */
export type UpdateOrganizationState =
  | Readonly<{ status: "saved"; settings: OrganizationSettings }>
  | Readonly<{
      status: "invalid";
      errors: OrganizationErrors;
      values: OrganizationValues;
    }>
  /** El usuario no es `admin`: nada cambió. */
  | Readonly<{ status: "forbidden" }>
  | Readonly<{ status: "failed"; values: OrganizationValues }>
  | null;

/** Respuesta de inviteMember(). */
export type InviteMemberState =
  | Readonly<{ status: "added" | "reactivated"; invitation: Invitation }>
  | Readonly<{ status: "already_member"; invitation: Invitation }>
  /** No hay una cuenta de Porandú con ese email. */
  | Readonly<{ status: "no_account"; values: InvitationValues }>
  | Readonly<{
      status: "invalid";
      errors: InvitationErrors;
      values: InvitationValues;
    }>
  | Readonly<{ status: "forbidden" }>
  | Readonly<{ status: "failed"; values: InvitationValues }>
  | null;

/** Respuesta de updateMemberRole() y removeMember(). */
export type MemberActionState =
  | Readonly<{ status: "updated" | "removed" }>
  /** No existe, ya no está activa o no es de la organización activa. */
  | Readonly<{ status: "not_found" }>
  /** Es la membership propia. */
  | Readonly<{ status: "self" }>
  /** La organización se quedaría sin administradores. */
  | Readonly<{ status: "last_admin" }>
  /** El rol pedido no es de la lista. */
  | Readonly<{ status: "invalid" }>
  | Readonly<{ status: "forbidden" }>
  | Readonly<{ status: "failed" }>
  | null;

/* ── Lectura de los pedidos ─────────────────────────────────────────────── */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_OPTION_ECHO_LENGTH = 32;

function text(value: FormDataEntryValue | null): string {
  return typeof value === "string" ? value : "";
}

export type ParsedOrganizationRequest =
  | Readonly<{
      kind: "ok";
      settings: OrganizationSettings;
      values: OrganizationValues;
    }>
  | Readonly<{
      kind: "invalid";
      errors: OrganizationErrors;
      values: OrganizationValues;
    }>;

/** Lee y valida (Zod, en el servidor) el pedido de configuración general. */
export function parseOrganizationRequest(
  formData: FormData,
): ParsedOrganizationRequest {
  const typed: OrganizationValues = {
    name: text(formData.get(ORGANIZATION_FIELDS.name)),
    defaultCurrency: text(formData.get(ORGANIZATION_FIELDS.defaultCurrency)),
  };
  const values: OrganizationValues = {
    name: typed.name.slice(0, ORGANIZATION_NAME_MAX_LENGTH * 4),
    defaultCurrency: typed.defaultCurrency.slice(0, MAX_OPTION_ECHO_LENGTH),
  };
  const parsed = parseOrganizationSettings(typed);
  if (!parsed.ok) return { kind: "invalid", errors: parsed.errors, values };
  return { kind: "ok", settings: parsed.settings, values };
}

export type ParsedInvitationRequest =
  | Readonly<{ kind: "ok"; invitation: Invitation; values: InvitationValues }>
  | Readonly<{
      kind: "invalid";
      errors: InvitationErrors;
      values: InvitationValues;
    }>;

/** Lee y valida (Zod, en el servidor) una invitación. */
export function parseInvitationRequest(
  formData: FormData,
): ParsedInvitationRequest {
  const typed: InvitationValues = {
    email: text(formData.get(INVITATION_FIELDS.email)),
    role: text(formData.get(INVITATION_FIELDS.role)),
  };
  const values: InvitationValues = {
    email: typed.email.slice(0, EMAIL_MAX_LENGTH * 2),
    role: typed.role.slice(0, MAX_OPTION_ECHO_LENGTH),
  };
  const parsed = parseInvitation(typed);
  if (!parsed.ok) return { kind: "invalid", errors: parsed.errors, values };
  return { kind: "ok", invitation: parsed.invitation, values };
}

/**
 * Id de la membership de un pedido, o null si no es un UUID (no llega a la
 * base). Que sea un UUID no significa que sea de la organización activa:
 * eso lo deciden el filtro explícito y RLS.
 */
export function parseMembershipId(formData: FormData): string | null {
  const id = text(formData.get(MEMBER_FIELDS.membershipId)).trim();
  return UUID.test(id) ? id.toLowerCase() : null;
}

/** Rol pedido en un cambio de rol, o null si no es de la lista. */
export function parseRoleRequest(formData: FormData): MemberRole | null {
  return parseMemberRole(text(formData.get(MEMBER_FIELDS.role)));
}
