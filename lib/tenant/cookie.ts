import "server-only";

import { cookies } from "next/headers";

/*
 * Cookie de organización activa (H0.7).
 *
 * Recuerda qué organización eligió el usuario en el selector. Guarda solo el
 * UUID de la organización: no es una credencial ni una fuente de
 * autorización. Cada request vuelve a validarla contra las memberships
 * activas del usuario (resolveTenant()); una cookie falsificada, ajena o
 * vieja nunca concede acceso. Por eso no se firma: su seguridad no depende
 * de que el cliente no pueda escribirla. Nunca lleva rol, userId ni permisos.
 *
 * Solo el servidor la lee y la escribe:
 * - httpOnly: ningún script del navegador la necesita.
 * - sameSite lax y path "/", como las cookies de sesión.
 * - secure: en producción solo viaja por HTTPS.
 * - maxAge: dura lo mismo que la sesión de Supabase (400 días, el default de
 *   @supabase/ssr), para no volver a pedir la organización en cada
 *   reinicio del navegador. El logout la borra.
 */

export const ACTIVE_ORGANIZATION_COOKIE = "porandu-active-organization";

const MAX_AGE_SECONDS = 400 * 24 * 60 * 60;

export function activeOrganizationCookieOptions() {
  return {
    path: "/",
    sameSite: "lax",
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    maxAge: MAX_AGE_SECONDS,
  } as const;
}

/** Valor crudo de la cookie: una preferencia sin validar, o null. */
export async function readActiveOrganization(): Promise<string | null> {
  const cookieStore = await cookies();
  return cookieStore.get(ACTIVE_ORGANIZATION_COOKIE)?.value ?? null;
}

/**
 * Solo Server Actions y Route Handlers pueden escribir cookies. El valor
 * tiene que salir de una membership activa leída de la base, nunca del input.
 */
export async function writeActiveOrganization(
  organizationId: string,
): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.set(
    ACTIVE_ORGANIZATION_COOKIE,
    organizationId,
    activeOrganizationCookieOptions(),
  );
}

/** Borra la cookie (logout), con los mismos atributos con que se escribió. */
export async function clearActiveOrganization(): Promise<void> {
  const cookieStore = await cookies();
  const { path, sameSite, httpOnly, secure } =
    activeOrganizationCookieOptions();
  cookieStore.delete({
    name: ACTIVE_ORGANIZATION_COOKIE,
    path,
    sameSite,
    httpOnly,
    secure,
  });
}
