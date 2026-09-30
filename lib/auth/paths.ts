/*
 * Rutas de autenticación (H0.6). Los redirects de auth usan solo estas
 * constantes: el destino nunca sale del input del cliente.
 */

export const LOGIN_PATH = "/login";

/** Destino después de iniciar sesión. */
export const HOME_PATH = "/cockpit";

/** Rutas que no exigen sesión. Todo lo demás es privado por defecto. */
export function isPublicPath(pathname: string): boolean {
  return pathname === LOGIN_PATH;
}
