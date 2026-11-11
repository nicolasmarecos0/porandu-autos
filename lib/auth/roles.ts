import type { MemberRole } from "@/domains/team/members";

/*
 * Control de roles del producto (Hito 22, DEC-054): qué puede hacer cada rol
 * de la membership activa. Módulo puro y apto para el navegador (no importa
 * Next, React ni db/): las Server Actions y los loaders lo consultan con el
 * rol del TenantContext (el de la membership en la base, nunca del cliente)
 * antes de escribir o de leer, y la UI lo usa para ocultar o deshabilitar lo
 * que el rol no puede hacer. Ocultar un botón no es una barrera: el servidor
 * responde UNAUTHORIZED_ROLE y la base vuelve a exigir lo mismo con RLS y
 * triggers (0023_security_roles).
 *
 * Roles (enum `membership_role`, DEC-018): `admin` es la gerencia del
 * concesionario (dueño, gerente, tasador) y `seller` es el equipo de ventas.
 * El "admin / manager vs sales" del pedido del fundador es `admin` vs
 * `seller`: no hay un rol `manager` separado (DEC-054 §1). Si algún día se
 * agrega, entra en MANAGEMENT_ROLES y cada capacidad lo hereda.
 */

/** Los roles de la gerencia: aprueban, fijan precios, anulan y auditan. */
export const MANAGEMENT_ROLES = [
  "admin",
] as const satisfies readonly MemberRole[];

/** Las acciones críticas que el rol decide (DEC-054 §2 a §5). */
export const CAPABILITIES = [
  /** Tasar o retasar un usado (DEC-052 §3). */
  "trade_in.appraise",
  /** Aprobar la toma: tasada → aprobada (DEC-054 §2). */
  "trade_in.approve",
  /** Ver la sección financiera de la toma: reacondicionamiento e ingreso. */
  "trade_in.view_financials",
  /** Editar el precio publicado de una unidad (DEC-054 §3). */
  "vehicle.edit_price",
  /** Anular una entrega programada (DEC-054 §4). */
  "delivery.cancel",
  /** Ver las Métricas del salón, la vista directiva (DEC-054 §5). */
  "metrics.view",
] as const;

export type Capability = (typeof CAPABILITIES)[number];

const CAPABILITY_ROLES: Readonly<Record<Capability, readonly MemberRole[]>> = {
  "trade_in.appraise": MANAGEMENT_ROLES,
  "trade_in.approve": MANAGEMENT_ROLES,
  "trade_in.view_financials": MANAGEMENT_ROLES,
  "vehicle.edit_price": MANAGEMENT_ROLES,
  "delivery.cancel": MANAGEMENT_ROLES,
  "metrics.view": MANAGEMENT_ROLES,
};

/** ¿Puede `role` hacer `capability`? Falla cerrado ante un rol desconocido. */
export function can(role: MemberRole, capability: Capability): boolean {
  return CAPABILITY_ROLES[capability].includes(role);
}

/** Los roles que tienen `capability`, para avisos y tests. */
export function rolesFor(capability: Capability): readonly MemberRole[] {
  return CAPABILITY_ROLES[capability];
}

/* ── Error estructurado ─────────────────────────────────────────────────── */

/** Código estable del rechazo por rol (DEC-054 §6). */
export const UNAUTHORIZED_ROLE = "UNAUTHORIZED_ROLE" as const;

/**
 * La respuesta de una Server Action cuando el rol de la membership activa no
 * tiene la capacidad: nada se leyó del pedido más allá de lo necesario para
 * saber qué se pidió, y nada se escribió.
 */
export type UnauthorizedRoleState = Readonly<{
  status: "unauthorized_role";
  code: typeof UNAUTHORIZED_ROLE;
  capability: Capability;
}>;

export function unauthorizedRole(
  capability: Capability,
): UnauthorizedRoleState {
  return { status: "unauthorized_role", code: UNAUTHORIZED_ROLE, capability };
}

/** null si `role` puede; si no, el rechazo estructurado. */
export function authorize(
  role: MemberRole,
  capability: Capability,
): UnauthorizedRoleState | null {
  return can(role, capability) ? null : unauthorizedRole(capability);
}

/* ── Copy (es-PY) ───────────────────────────────────────────────────────── */

/** Etiqueta corta junto a una acción o un bloque reservado. */
export const RESTRICTED_LABEL = "Solo administradores";

/** Por qué una acción no está disponible: tooltips y avisos (DEC-011). */
export const CAPABILITY_REQUIREMENTS: Readonly<Record<Capability, string>> = {
  "trade_in.appraise":
    "Solo un administrador (tasador o gerente) tasa el usado.",
  "trade_in.approve":
    "Solo un administrador (gerente) aprueba la toma. Avisale para que la confirme.",
  "trade_in.view_financials":
    "El costo de reacondicionamiento y el costo total de ingreso los ve un administrador.",
  "vehicle.edit_price":
    "Solo un administrador (gerente) cambia el precio publicado.",
  "delivery.cancel": "Solo un administrador (gerente) anula una entrega.",
  "metrics.view":
    "Las Métricas del salón son la vista de la gerencia: las ve un administrador.",
};

/** El aviso de un rechazo UNAUTHORIZED_ROLE. */
export function unauthorizedRoleMessage(capability: Capability): string {
  return `${CAPABILITY_REQUIREMENTS[capability]} No se guardó nada.`;
}
