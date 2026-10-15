import { z } from "zod";

/*
 * Equipo del concesionario (Hito 6, DEC-038): los miembros activos de la
 * organización, sus roles y las reglas de quién puede gestionarlos.
 *
 * Módulo puro y apto para el navegador: la UI usa las listas, los labels y
 * las reglas para mostrar u ocultar acciones, pero la autorización la
 * imponen el servidor (Server Actions con requireTenant() y rol `admin`) y
 * la base (policies de `memberships` y el trigger de cambios, DEC-038 §4 y
 * §5). Ocultar un botón no es una barrera.
 */

/**
 * Roles de una membership (enum `membership_role`, DEC-018). Un test vigila
 * que coincidan con `membershipRole` de db/schema/memberships.ts.
 */
export const MEMBER_ROLES = ["admin", "seller"] as const;

export type MemberRole = (typeof MEMBER_ROLES)[number];

/** Copy es-PY de cada rol (DEC-011). */
export const MEMBER_ROLE_LABELS: Readonly<Record<MemberRole, string>> = {
  admin: "Administrador",
  seller: "Vendedor",
};

/** Largo máximo de un email (RFC 5321). */
export const EMAIL_MAX_LENGTH = 254;

/* ── Reglas de acceso (RBAC, DEC-038 §5) ────────────────────────────────── */

/** Solo un `admin` edita la organización e invita, cambia o quita miembros. */
export function canManageTeam(role: MemberRole): boolean {
  return role === "admin";
}

/** Editar la configuración general: la misma regla que el equipo. */
export const canEditOrganization = canManageTeam;

/**
 * ¿Puede `viewer` cambiar el rol o quitar a `member`? Solo un `admin`, y
 * nunca sobre su propia membership: nadie se degrada ni se quita a sí mismo
 * (así una organización no se queda sin administradores por error). La
 * base aplica la misma regla y, además, que siempre quede un `admin` activo.
 */
export function canManageMember(
  viewer: Readonly<{ userId: string; role: MemberRole }>,
  member: Readonly<{ userId: string }>,
): boolean {
  return canManageTeam(viewer.role) && viewer.userId !== member.userId;
}

/* ── Pedidos (Zod, DEC-038 §7) ──────────────────────────────────────────── */

/** Campos que el servidor lee de cada pedido. */
export const INVITATION_FIELDS = { email: "email", role: "role" } as const;

export const MEMBER_FIELDS = {
  membershipId: "membershipId",
  role: "role",
} as const;

/** Email tal como se compara: NFC, recortado y en minúsculas. */
export function normalizeEmail(raw: string): string {
  return raw.normalize("NFC").trim().toLowerCase();
}

export type InvitationValues = Readonly<{ email: string; role: string }>;

export type InvitationField = keyof InvitationValues;

export const INVITATION_FIELD_ERRORS = [
  "required",
  "invalid_email",
  "too_long",
  "invalid_option",
] as const;

export type InvitationFieldError = (typeof INVITATION_FIELD_ERRORS)[number];

export type InvitationErrors = Readonly<
  Partial<Record<InvitationField, InvitationFieldError>>
>;

/** Invitación válida: email normalizado y rol de la lista. */
export type Invitation = Readonly<{ email: string; role: MemberRole }>;

export type ParsedInvitation =
  | Readonly<{ ok: true; invitation: Invitation }>
  | Readonly<{ ok: false; errors: InvitationErrors }>;

const roleSchema = z
  .string()
  .trim()
  .min(1, "required")
  .pipe(z.enum(MEMBER_ROLES, { error: "invalid_option" }));

const invitationSchema = z.object({
  email: z
    .string()
    .transform(normalizeEmail)
    .refine((email) => email !== "", "required")
    .refine((email) => email.length <= EMAIL_MAX_LENGTH, "too_long")
    .pipe(z.email({ error: "invalid_email" })),
  role: roleSchema,
});

function firstErrors<F extends string, E extends string>(
  issues: readonly z.core.$ZodIssue[],
  known: readonly E[],
  fallback: E,
): Partial<Record<F, E>> {
  const errors: Partial<Record<F, E>> = {};
  for (const issue of issues) {
    const field = issue.path[0] as F;
    if (errors[field] !== undefined) continue;
    errors[field] = (known as readonly string[]).includes(issue.message)
      ? (issue.message as E)
      : fallback;
  }
  return errors;
}

/**
 * Valida una invitación, que es input no confiable: un email con forma
 * válida y un rol de la lista. Que el email tenga una cuenta lo decide la
 * base, no el dominio.
 */
export function parseInvitation(values: InvitationValues): ParsedInvitation {
  const parsed = invitationSchema.safeParse(values);
  if (parsed.success) return { ok: true, invitation: parsed.data };
  return {
    ok: false,
    errors: firstErrors<InvitationField, InvitationFieldError>(
      parsed.error.issues,
      INVITATION_FIELD_ERRORS,
      "invalid_option",
    ),
  };
}

/** Rol elegido para un cambio de rol: de la lista, o null. */
export function parseMemberRole(raw: string): MemberRole | null {
  const parsed = roleSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

/* ── Lectura ────────────────────────────────────────────────────────────── */

/** Un miembro activo, tal como lo lee la capa de datos. */
export type TeamMemberRow = Readonly<{
  membershipId: string;
  userId: string;
  fullName: string | null;
  email: string | null;
  role: MemberRole;
  joinedAt: Date;
}>;

/** Un miembro listo para la UI. */
export type TeamMember = TeamMemberRow &
  Readonly<{
    /** Nombre visible: el nombre del perfil, el email o un genérico. */
    displayName: string;
    isViewer: boolean;
    /** El viewer puede cambiarle el rol o quitarlo (canManageMember()). */
    manageable: boolean;
  }>;

export type TeamView = Readonly<{
  members: readonly TeamMember[];
  viewerRole: MemberRole;
  /** El viewer puede invitar (canManageTeam()). */
  canInvite: boolean;
  adminCount: number;
}>;

const collator = new Intl.Collator("es-PY", { sensitivity: "base" });

function displayNameOf(row: TeamMemberRow): string {
  const name = row.fullName?.trim();
  if (name) return name;
  if (row.email) return row.email;
  return "Miembro sin nombre";
}

/**
 * Arma la vista del equipo: administradores primero, después por nombre
 * (es-PY) y, para un orden determinista, por id de membership.
 */
export function buildTeamView(
  rows: readonly TeamMemberRow[],
  viewer: Readonly<{ userId: string; role: MemberRole }>,
): TeamView {
  const members = rows
    .map((row): TeamMember => ({
      ...row,
      displayName: displayNameOf(row),
      isViewer: row.userId === viewer.userId,
      manageable: canManageMember(viewer, row),
    }))
    .sort(
      (a, b) =>
        MEMBER_ROLES.indexOf(a.role) - MEMBER_ROLES.indexOf(b.role) ||
        collator.compare(a.displayName, b.displayName) ||
        (a.membershipId < b.membershipId ? -1 : 1),
    );
  return {
    members,
    viewerRole: viewer.role,
    canInvite: canManageTeam(viewer.role),
    adminCount: members.filter((member) => member.role === "admin").length,
  };
}

/** Iniciales para el avatar (hasta dos letras). */
export function memberInitials(displayName: string): string {
  const letters = displayName
    .split(/[\s@._-]+/u)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => [...part][0]!.toLocaleUpperCase("es-PY"));
  return letters.join("") || "?";
}
