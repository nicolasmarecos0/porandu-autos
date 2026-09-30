import "server-only";

import { redirect } from "next/navigation";

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
 */

/** Usuario verificado de la request, o null. */
export async function getAuthenticatedUser(): Promise<AuthenticatedUser | null> {
  const auth = await createAuthClient();
  return verifyAuthenticatedUser(auth);
}

/** Usuario verificado; sin él, redirect a /login. */
export async function requireUser(): Promise<AuthenticatedUser> {
  const user = await getAuthenticatedUser();
  if (!user) redirect(LOGIN_PATH);
  return user;
}
