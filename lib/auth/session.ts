import "server-only";

import { redirect } from "next/navigation";
import { cache } from "react";

import { createAuthClient } from "@/lib/supabase/server";

import { verifyAuthenticatedUser, type AuthenticatedUser } from "./claims";
import { LOGIN_PATH } from "./paths";

/*
 * Identidad del usuario en server code (H0.6).
 *
 * Sale siempre de `auth.getClaims()`: claims del access token verificados por
 * Supabase Auth (firma contra el JWKS del proyecto y expiración). Nunca de
 * `getSession()`, que devuelve lo que diga la cookie sin verificarlo, ni de
 * input del cliente. Sin usuario verificado, falla cerrado.
 *
 * Es solo autenticación: no valida memberships ni organización. Eso lo hace
 * Tenant Resolution (H0.7, `requireTenant()`), que recibe esta identidad.
 *
 * `cache()` de React deduplica la verificación dentro del render de una
 * misma request (layout, páginas y requireTenant() la comparten). No se
 * comparte entre requests ni usuarios, y fuera de un render (Server
 * Actions) no memoriza.
 */

/** Usuario verificado de la request, o null. */
export const getAuthenticatedUser = cache(
  async (): Promise<AuthenticatedUser | null> => {
    const auth = await createAuthClient();
    return verifyAuthenticatedUser(auth);
  },
);

/** Usuario verificado; sin él, redirect a /login. */
export async function requireUser(): Promise<AuthenticatedUser> {
  const user = await getAuthenticatedUser();
  if (!user) redirect(LOGIN_PATH);
  return user;
}
