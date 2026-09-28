import type { SupabaseClient } from "@supabase/supabase-js";

/*
 * Claims de un access token YA VERIFICADO por Supabase Auth.
 * Solo verifyAccessToken() (o el verificador E0 de test/support) los produce.
 */
declare const verifiedBrand: unique symbol;

export type VerifiedClaims = {
  readonly sub: string;
  readonly role: string;
  readonly [claim: string]: unknown;
} & { readonly [verifiedBrand]: true };

export class InvalidSessionError extends Error {
  override name = "InvalidSessionError";
}

/**
 * Verifica el access token con `auth.getClaims(token)`: firma + `exp`
 * localmente (claves asimétricas vía JWKS) o, si el token es HS256, contra el
 * servidor de Auth (`getUser`). Nunca usa `getSession()`.
 */
export async function verifyAccessToken(
  auth: SupabaseClient["auth"],
  token: string,
): Promise<VerifiedClaims> {
  const { data, error } = await auth.getClaims(token);
  if (error || !data) {
    throw new InvalidSessionError(error?.message ?? "token sin claims");
  }
  const claims: Record<string, unknown> = { ...data.claims };
  if (typeof claims.sub !== "string" || claims.role !== "authenticated") {
    throw new InvalidSessionError("claims sin sub o con rol inesperado");
  }
  return claims as VerifiedClaims;
}

/** Solo para verificadores alternativos del harness (E0). */
export function markVerified(claims: Record<string, unknown>): VerifiedClaims {
  if (typeof claims.sub !== "string" || typeof claims.role !== "string") {
    throw new InvalidSessionError("claims sin sub o role");
  }
  return claims as VerifiedClaims;
}
