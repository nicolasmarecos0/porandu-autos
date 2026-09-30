import { stringFromBase64URL } from "@supabase/ssr";
import { unstable_doesMiddlewareMatch } from "next/experimental/testing/server";
import { NextRequest, type NextResponse } from "next/server";
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import { updateSession } from "@/lib/supabase/proxy";
import { config } from "@/proxy";

import {
  accessTokenClaims,
  AUTH_COOKIE,
  createSigningKey,
  fakeAuthServer,
  PUBLISHABLE_KEY,
  session,
  sessionCookies,
  signAccessToken,
  SUPABASE_URL,
  type Session,
  type SigningKey,
} from "../support/fake-supabase-auth";

/*
 * proxy.ts con @supabase/ssr y auth-js reales contra un Supabase Auth falso
 * (tests/unit/support/fake-supabase-auth.ts): refresh de cookies, cabeceras
 * anti-caché, redirect optimista y fallo cerrado. Sin red ni Postgres.
 */

vi.mock("server-only", () => ({}));

const APP = "https://app.example.test";
const USER = "00000000-0000-4000-8000-00000000000a";
const NO_STORE = "private, no-cache, no-store, must-revalidate, max-age=0";

let key: SigningKey;
let server: ReturnType<typeof fakeAuthServer>;
let refreshed: Session | null;
let consoleCalls: unknown[][];

beforeAll(async () => {
  key = await createSigningKey("key-1");
});

beforeEach(() => {
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", SUPABASE_URL);
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", PUBLISHABLE_KEY);
  refreshed = null;
  server = fakeAuthServer({
    jwks: [key.publicJwk],
    refresh: async (token) => (token === "refresh-1" ? refreshed : null),
  });
  vi.stubGlobal("fetch", server.fetch);
  // auth-js avisa por consola cuando un refresh falla. Se captura (la
  // consola parcheada de Next necesita su runtime) y se revisa abajo.
  consoleCalls = [];
  for (const method of ["log", "info", "warn", "error"] as const) {
    vi.spyOn(console, method).mockImplementation((...args) => {
      consoleCalls.push(args);
    });
  }
});

afterEach(() => {
  // Ningún log del proxy lleva tokens: ni refresh tokens ni JWTs.
  const logged = JSON.stringify(consoleCalls.map((args) => args.map(String)));
  expect(logged).not.toContain("refresh-");
  expect(logged).not.toContain("eyJ");
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

function nowSeconds(): number {
  return Math.floor(Date.now() / 1000);
}

async function validSession(
  claims: Record<string, unknown> = accessTokenClaims(USER),
  signingKey: SigningKey = key,
): Promise<Session> {
  const token = await signAccessToken(signingKey, claims);
  return session(token, "refresh-1", nowSeconds() + 3600, USER);
}

/** Sesión con el access token vencido: obliga a refrescar. */
async function expiredSession(): Promise<Session> {
  const past = nowSeconds() - 60;
  const token = await signAccessToken(
    key,
    accessTokenClaims(USER, { exp: past, iat: past - 3600 }),
  );
  return session(token, "refresh-1", past, USER);
}

function request(
  path: string,
  options: { method?: string; session?: Session } = {},
): NextRequest {
  const cookies = options.session ? sessionCookies(options.session) : [];
  return new NextRequest(new URL(path, APP), {
    method: options.method ?? "GET",
    headers: {
      cookie: cookies.map(({ name, value }) => `${name}=${value}`).join("; "),
    },
  });
}

function passesThrough(response: NextResponse): boolean {
  return response.headers.get("x-middleware-next") === "1";
}

function setCookies(response: NextResponse): string[] {
  return response.headers.getSetCookie();
}

function cookieValue(setCookie: string, name: string): string {
  const prefix = `${name}=`;
  expect(setCookie.startsWith(prefix)).toBe(true);
  return setCookie.slice(prefix.length).split(";")[0] ?? "";
}

function decodeSession(value: string): unknown {
  expect(value.startsWith("base64-")).toBe(true);
  return JSON.parse(stringFromBase64URL(value.slice("base64-".length)));
}

function authCalls(): string[] {
  return server.calls.map(({ method, url }) => `${method} ${url}`);
}

describe("matcher de proxy.ts", () => {
  it.each(["/", "/login", "/cockpit", "/opportunities", "/settings/x"])(
    "corre en rutas de la app: %s",
    (url) => {
      expect(unstable_doesMiddlewareMatch({ config, url })).toBe(true);
    },
  );

  it.each([
    "/_next/static/chunks/app.js",
    "/_next/static/css/app.css",
    "/_next/image?url=%2Fcar.png&w=640&q=75",
    "/favicon.ico",
    "/icon.svg",
    "/cars/representacion.webp",
  ])("excluye assets y estáticos: %s", (url) => {
    expect(unstable_doesMiddlewareMatch({ config, url })).toBe(false);
  });
});

describe("updateSession", () => {
  it("sin sesión, una navegación a una ruta privada va a /login", async () => {
    const response = await updateSession(request("/cockpit"));

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe(`${APP}/login`);
    // Sin cookie de sesión no hay nada que verificar ni refrescar.
    expect(authCalls()).toEqual([]);
  });

  it("no redirige /login: no hay loop", async () => {
    const response = await updateSession(request("/login"));

    expect(passesThrough(response)).toBe(true);
    expect(response.headers.get("location")).toBeNull();
  });

  it("no redirige Server Actions (POST): verifican su propia autorización", async () => {
    const response = await updateSession(
      request("/cockpit", { method: "POST" }),
    );

    expect(passesThrough(response)).toBe(true);
  });

  it("con un access token vigente verifica la firma contra el JWKS y deja pasar, sin escribir cookies", async () => {
    const response = await updateSession(
      request("/cockpit", { session: await validSession() }),
    );

    expect(passesThrough(response)).toBe(true);
    expect(setCookies(response)).toEqual([]);
    // Solo el JWKS (auth-js lo cachea entre requests): ni refresh ni /user.
    for (const call of authCalls()) {
      expect(call).toBe(`GET ${SUPABASE_URL}/auth/v1/.well-known/jwks.json`);
    }
  });

  it("refresca un access token vencido y escribe las cookies nuevas en response y request, sin caché", async () => {
    refreshed = await validSession();
    refreshed = { ...refreshed, refresh_token: "refresh-2" };

    const response = await updateSession(
      request("/opportunities", { session: await expiredSession() }),
    );

    expect(passesThrough(response)).toBe(true);
    expect(authCalls()).toContain(
      `POST ${SUPABASE_URL}/auth/v1/token?grant_type=refresh_token`,
    );

    const written = setCookies(response);
    expect(written).toHaveLength(1);
    const value = cookieValue(written[0] ?? "", AUTH_COOKIE);
    expect(decodeSession(value)).toMatchObject({
      access_token: refreshed.access_token,
      refresh_token: "refresh-2",
    });
    expect(written[0]).toMatch(/; Path=\/(;|$)/);
    expect(written[0]).toMatch(/; HttpOnly(;|$)/i);
    expect(written[0]).toMatch(/; SameSite=Lax(;|$)/i);
    expect(written[0]).not.toMatch(/; Secure(;|$)/i);
    expect(response.headers.get("cache-control")).toBe(NO_STORE);
    // El render de esta misma request ve la sesión refrescada.
    expect(response.headers.get("x-middleware-request-cookie")).toContain(
      `${AUTH_COOKIE}=${value}`,
    );
  });

  it("en producción las cookies de sesión son Secure", async () => {
    vi.stubEnv("NODE_ENV", "production");
    refreshed = await validSession();

    const response = await updateSession(
      request("/cockpit", { session: await expiredSession() }),
    );

    expect(setCookies(response)[0]).toMatch(/; Secure(;|$)/i);
  });

  it("si el refresh token es inválido, borra la sesión y el redirect a /login lleva ese borrado", async () => {
    const response = await updateSession(
      request("/cockpit", { session: await expiredSession() }),
    );

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe(`${APP}/login`);
    const written = setCookies(response);
    expect(written).toHaveLength(1);
    expect(written[0]).toMatch(new RegExp(`^${AUTH_COOKIE}=;`));
    expect(written[0]).toMatch(/; Max-Age=0(;|$)/);
    expect(response.headers.get("cache-control")).toBe(NO_STORE);
  });

  it("falla cerrado con un token adulterado (claims cambiados, firma original)", async () => {
    const original = await validSession();
    const [header, , signature] = original.access_token.split(".");
    const forgedPayload = Buffer.from(
      JSON.stringify(accessTokenClaims("00000000-0000-4000-8000-00000000000b")),
    ).toString("base64url");
    const forged = {
      ...original,
      access_token: `${header}.${forgedPayload}.${signature}`,
    };

    const response = await updateSession(
      request("/cockpit", { session: forged }),
    );

    expect(response.headers.get("location")).toBe(`${APP}/login`);
  });

  it("falla cerrado con un token firmado por otra clave", async () => {
    const attacker = await createSigningKey("key-1");

    const response = await updateSession(
      request("/cockpit", {
        session: await validSession(accessTokenClaims(USER), attacker),
      }),
    );

    expect(response.headers.get("location")).toBe(`${APP}/login`);
  });

  it("falla cerrado con un kid desconocido (Auth rechaza el token)", async () => {
    const unknown = await createSigningKey("key-unknown");

    const response = await updateSession(
      request("/cockpit", {
        session: await validSession(accessTokenClaims(USER), unknown),
      }),
    );

    expect(response.headers.get("location")).toBe(`${APP}/login`);
    expect(authCalls()).toContain(`GET ${SUPABASE_URL}/auth/v1/user`);
  });

  it.each([
    ["sub no UUID", { sub: "user-a" }],
    ["usuario anónimo", { is_anonymous: true }],
    ["rol anon", { role: "anon" }],
  ])(
    "aplica la misma validación de claims que el server code: %s",
    async (_, overrides) => {
      const response = await updateSession(
        request("/cockpit", {
          session: await validSession(accessTokenClaims(USER, overrides)),
        }),
      );

      expect(response.headers.get("location")).toBe(`${APP}/login`);
    },
  );

  it("solo habla con Supabase Auth: nunca con Postgres ni la Data API", async () => {
    refreshed = await validSession();
    await updateSession(
      request("/cockpit", { session: await expiredSession() }),
    );

    expect(server.calls.length).toBeGreaterThan(0);
    for (const { url } of server.calls) {
      expect(url.startsWith(`${SUPABASE_URL}/auth/v1/`)).toBe(true);
    }
  });
});
