/*
 * Rutas de Tenant Resolution (H0.7). Exigen sesión (no son públicas) y viven
 * fuera del área (app), que redirige a ellas. Los redirects usan solo estas
 * constantes: el destino nunca sale del input del cliente.
 */

/** Usuario autenticado sin ninguna membership activa. */
export const NO_ACCESS_PATH = "/no-access";

/** Varias memberships activas y ninguna organización elegida válida. */
export const SELECT_ORGANIZATION_PATH = "/select-organization";
