import { createChunks, stringToBase64URL } from "@supabase/ssr";

/*
 * Supabase Auth falso para probar la integración con @supabase/ssr y
 * auth-js reales, sin red. Sirve el JWKS y el refresh de tokens con una clave
 * ES256 generada por test (como los proyectos de E1/E2: JWT ES256 con kid).
 * No reimplementa la verificación: la hace auth-js con WebCrypto.
 * Todos los valores son ficticios.
 */

export const SUPABASE_URL = "https://testref.supabase.co";
export const PUBLISHABLE_KEY = "sb_publishable_test";
/** Nombre por defecto de la cookie de sesión: `sb-<project_ref>-auth-token`. */
export const AUTH_COOKIE = "sb-testref-auth-token";

const encoder = new TextEncoder();

function base64url(value: string | ArrayBuffer): string {
  const bytes =
    typeof value === "string" ? encoder.encode(value) : new Uint8Array(value);
  return Buffer.from(bytes).toString("base64url");
}

/** JWK pública como la publica el JWKS de Supabase (con `kid`). */
export type PublicJwk = JsonWebKey & { kid: string };

export type SigningKey = Readonly<{
  kid: string;
  privateKey: CryptoKey;
  publicJwk: PublicJwk;
}>;

export async function createSigningKey(kid: string): Promise<SigningKey> {
  const { privateKey, publicKey } = await crypto.subtle.generateKey(
    { name: "ECDSA", namedCurve: "P-256" },
    true,
    ["sign", "verify"],
  );
  const jwk = await crypto.subtle.exportKey("jwk", publicKey);
  return { kid, privateKey, publicJwk: { ...jwk, alg: "ES256", kid } };
}

export async function signAccessToken(
  key: SigningKey,
  claims: Record<string, unknown>,
): Promise<string> {
  const header = base64url(
    JSON.stringify({ alg: "ES256", typ: "JWT", kid: key.kid }),
  );
  const payload = base64url(JSON.stringify(claims));
  const signature = await crypto.subtle.sign(
    { name: "ECDSA", hash: "SHA-256" },
    key.privateKey,
    encoder.encode(`${header}.${payload}`),
  );
  return `${header}.${payload}.${base64url(signature)}`;
}

/** Claims de un access token de Supabase para `userId`, vigente por 1 h. */
export function accessTokenClaims(
  userId: string,
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  const now = Math.floor(Date.now() / 1000);
  return {
    iss: `${SUPABASE_URL}/auth/v1`,
    sub: userId,
    aud: "authenticated",
    exp: now + 3600,
    iat: now,
    role: "authenticated",
    aal: "aal1",
    session_id: "00000000-0000-4000-8000-0000000000e1",
    email: "vendedor@example.test",
    phone: "",
    is_anonymous: false,
    app_metadata: { provider: "email", providers: ["email"] },
    user_metadata: {},
    ...overrides,
  };
}

export type Session = Readonly<{
  access_token: string;
  refresh_token: string;
  expires_at: number;
  expires_in: number;
  token_type: "bearer";
  user: Record<string, unknown>;
}>;

export function session(
  accessToken: string,
  refreshToken: string,
  expiresAt: number,
  userId: string,
): Session {
  return {
    access_token: accessToken,
    refresh_token: refreshToken,
    expires_at: expiresAt,
    expires_in: 3600,
    token_type: "bearer",
    user: {
      id: userId,
      aud: "authenticated",
      role: "authenticated",
      email: "vendedor@example.test",
      app_metadata: { provider: "email" },
      user_metadata: {},
      created_at: "2026-09-30T00:00:00Z",
    },
  };
}

/** Cookies de sesión codificadas como las escribe @supabase/ssr. */
export function sessionCookies(
  value: Session,
): { name: string; value: string }[] {
  return createChunks(
    AUTH_COOKIE,
    `base64-${stringToBase64URL(JSON.stringify(value))}`,
  );
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

/**
 * `fetch` que responde como Supabase Auth: JWKS, refresh de tokens y
 * `/user` (401; auth-js lo usa si el `kid` no está en el JWKS). Registra
 * cada request.
 */
export function fakeAuthServer(options: {
  jwks: PublicJwk[];
  refresh: (refreshToken: string) => Promise<Session | null>;
}) {
  const calls: { method: string; url: string }[] = [];

  async function fetch(
    input: RequestInfo | URL,
    init?: RequestInit,
  ): Promise<Response> {
    const request = new Request(input, init);
    const url = new URL(request.url);
    calls.push({ method: request.method, url: request.url });

    if (url.pathname === "/auth/v1/.well-known/jwks.json") {
      return json(200, { keys: options.jwks });
    }
    if (
      url.pathname === "/auth/v1/token" &&
      url.searchParams.get("grant_type") === "refresh_token"
    ) {
      const body = (await request.json()) as { refresh_token: string };
      const refreshed = await options.refresh(body.refresh_token);
      return refreshed
        ? json(200, refreshed)
        : json(400, {
            code: 400,
            error_code: "refresh_token_not_found",
            msg: "Invalid Refresh Token: Refresh Token Not Found",
          });
    }
    if (url.pathname === "/auth/v1/user") {
      return json(401, {
        code: 401,
        error_code: "bad_jwt",
        msg: "invalid JWT",
      });
    }
    return json(404, { code: 404, msg: "not found" });
  }

  return { fetch, calls };
}
