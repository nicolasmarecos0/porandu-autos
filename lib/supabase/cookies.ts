import type { CookieOptionsWithName } from "@supabase/ssr";

/*
 * Opciones de las cookies de sesión de Supabase Auth. @supabase/ssr las
 * aplica sobre sus defaults (path "/", SameSite=Lax, max-age de 400 días) y
 * conserva su nombre por defecto (`sb-<project_ref>-auth-token`, en chunks).
 *
 * - httpOnly: no hay cliente de Supabase en el navegador. Ningún script
 *   necesita leer los tokens, así que tampoco puede leerlos un XSS.
 * - secure: en producción las cookies solo viajan por HTTPS. En desarrollo
 *   (http://localhost) no se exige.
 */
export function authCookieOptions(): CookieOptionsWithName {
  return {
    path: "/",
    sameSite: "lax",
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
  };
}
