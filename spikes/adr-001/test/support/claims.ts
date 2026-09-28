import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import {
  markVerified,
  verifyAccessToken,
  type VerifiedClaims,
} from "../../src/claims";
import { env, isE1 } from "./env";
import type { FixtureUser } from "./fixtures";
import { verifyHs256 } from "./jwt-hs256";

let publishable: SupabaseClient | undefined;

/** Cliente con la publishable key, como el server client de @supabase/ssr. */
export function publishableClient(): SupabaseClient {
  if (!env.supabaseUrl || !env.publishableKey) {
    throw new Error("publishableClient solo existe en e1");
  }
  publishable ??= createClient(env.supabaseUrl, env.publishableKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return publishable;
}

/**
 * e1: verificación real con auth.getClaims(token) (src/claims.ts).
 * e0: verificador HS256 del shim (no hay servidor de Auth).
 */
export async function verifyToken(token: string): Promise<VerifiedClaims> {
  if (isE1) return verifyAccessToken(publishableClient().auth, token);
  if (!env.jwtSecret) throw new Error("e0 requiere SPIKE_JWT_SECRET");
  return markVerified(verifyHs256(token, env.jwtSecret));
}

export function verifiedClaimsFor(user: FixtureUser): Promise<VerifiedClaims> {
  return verifyToken(user.accessToken);
}
