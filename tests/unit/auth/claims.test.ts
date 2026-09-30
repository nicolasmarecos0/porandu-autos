import { describe, expect, expectTypeOf, it, vi } from "vitest";

import type { TenantContext, UserContext } from "@/db/tenant";
import {
  parseVerifiedClaims,
  toAuthenticatedUser,
  verifyAuthenticatedUser,
  type AuthenticatedUser,
  type ClaimsVerifier,
} from "@/lib/auth/claims";

/*
 * Identidad verificada (H0.6). La firma y la expiración las verifica
 * `auth.getClaims()` de Supabase Auth (E2 lo validó contra el JWKS real de
 * staging); acá se prueba lo que la aplicación hace con esos claims.
 * Valores ficticios.
 */

const USER = "00000000-0000-4000-8000-00000000000a";
const ORG = "00000000-0000-4000-8000-000000000001";
const SESSION = "00000000-0000-4000-8000-0000000000e1";

/** Claims como los devuelve getClaims() para un access token de Supabase. */
function supabaseClaims(overrides: Record<string, unknown> = {}) {
  return {
    iss: "https://testref.supabase.co/auth/v1",
    sub: USER,
    aud: "authenticated",
    exp: 1_900_000_000,
    iat: 1_899_996_400,
    role: "authenticated",
    aal: "aal1",
    session_id: SESSION,
    email: "vendedor@example.test",
    phone: "",
    is_anonymous: false,
    amr: [{ method: "password", timestamp: 1_899_996_400 }],
    app_metadata: { provider: "email", providers: ["email"] },
    user_metadata: {},
    ...overrides,
  };
}

const EXPECTED_CLAIMS = {
  sub: USER,
  role: "authenticated",
  aud: "authenticated",
  iss: "https://testref.supabase.co/auth/v1",
  iat: 1_899_996_400,
  exp: 1_900_000_000,
  aal: "aal1",
  session_id: SESSION,
};

function verifier(result: unknown): ClaimsVerifier & {
  getSession: () => never;
  getUser: () => never;
} {
  return {
    getClaims: vi.fn(async () => result as never),
    getSession: vi.fn(() => {
      throw new Error("getSession() must not be used for authorization");
    }),
    getUser: vi.fn(() => {
      throw new Error("getUser() is not the H0.6 verification path");
    }),
  };
}

describe("toAuthenticatedUser", () => {
  it("claims válidos producen la identidad esperada, con userId desde sub", () => {
    expect(toAuthenticatedUser(supabaseClaims())).toEqual({
      userId: USER,
      claims: EXPECTED_CLAIMS,
    });
  });

  it("acepta aud como lista", () => {
    const aud = ["authenticated", "other"];
    expect(parseVerifiedClaims(supabaseClaims({ aud }))?.aud).toEqual(aud);
  });

  it("solo pasan los claims obligatorios: ninguna organización sale de los claims", () => {
    const claims = parseVerifiedClaims(
      supabaseClaims({
        organization_id: ORG,
        organizationId: ORG,
        app_metadata: { provider: "email", organization_id: ORG },
        user_metadata: { organization_id: ORG, role: "admin" },
      }),
    );

    expect(claims).toEqual(EXPECTED_CLAIMS);
    expect(JSON.stringify(claims)).not.toContain(ORG);
    expect(claims).not.toHaveProperty("email");
  });

  it.each([
    ["null", null],
    ["undefined", undefined],
    ["un string (token sin verificar)", "eyJhbGciOiJFUzI1NiJ9.e30.x"],
    ["un número", 42],
    ["una lista", [supabaseClaims()]],
    ["un objeto vacío", {}],
  ])("claims ausentes o inválidos fallan cerrado: %s", (_, raw) => {
    expect(toAuthenticatedUser(raw)).toBeNull();
  });

  it.each(Object.keys(EXPECTED_CLAIMS))(
    "falla cerrado si falta el claim obligatorio %s",
    (key) => {
      const claims: Record<string, unknown> = supabaseClaims();
      delete claims[key];
      expect(toAuthenticatedUser(claims)).toBeNull();
    },
  );

  it.each([
    ["número", 42],
    ["vacío", ""],
    ["no UUID", "user-a"],
    ["UUID con espacios", ` ${USER} `],
    ["UUID sin guiones", USER.replaceAll("-", "")],
    ["inyección", "' OR 1=1 --"],
  ])("un sub inválido (%s) no produce identidad", (_, sub) => {
    expect(toAuthenticatedUser(supabaseClaims({ sub }))).toBeNull();
  });

  it.each(["anon", "service_role", "postgres", "Authenticated", undefined])(
    "exige role authenticated (rechaza %s)",
    (role) => {
      expect(toAuthenticatedUser(supabaseClaims({ role }))).toBeNull();
    },
  );

  it("rechaza un usuario anónimo aunque tenga rol authenticated", () => {
    expect(
      toAuthenticatedUser(supabaseClaims({ is_anonymous: true })),
    ).toBeNull();
  });

  it.each([
    ["exp no numérico", { exp: "1900000000" }],
    ["iat no finito", { iat: Number.NaN }],
    ["aud vacío", { aud: [] }],
    ["session_id vacío", { session_id: "" }],
  ])("rechaza claims mal tipados: %s", (_, overrides) => {
    expect(toAuthenticatedUser(supabaseClaims(overrides))).toBeNull();
  });
});

describe("verifyAuthenticatedUser", () => {
  it("usa los claims verificados de getClaims(), nunca getSession() ni getUser()", async () => {
    const auth = verifier({
      data: { claims: supabaseClaims() },
      error: null,
    });

    await expect(verifyAuthenticatedUser(auth)).resolves.toEqual({
      userId: USER,
      claims: EXPECTED_CLAIMS,
    });
    expect(auth.getClaims).toHaveBeenCalledTimes(1);
    expect(auth.getSession).not.toHaveBeenCalled();
    expect(auth.getUser).not.toHaveBeenCalled();
  });

  it.each([
    ["sin sesión", { data: null, error: null }],
    ["token inválido", { data: null, error: new Error("Invalid JWT") }],
    [
      "error junto a claims",
      { data: { claims: supabaseClaims() }, error: new Error("x") },
    ],
    [
      "claims rechazados",
      { data: { claims: supabaseClaims({ sub: "user-a" }) }, error: null },
    ],
  ])("falla cerrado: %s", async (_, result) => {
    await expect(verifyAuthenticatedUser(verifier(result))).resolves.toBeNull();
  });

  it("falla cerrado si getClaims() lanza (p. ej. JWKS inaccesible)", async () => {
    const auth: ClaimsVerifier = {
      getClaims: async () => {
        throw new TypeError("fetch failed");
      },
    };
    await expect(verifyAuthenticatedUser(auth)).resolves.toBeNull();
  });
});

describe("tipos de la identidad", () => {
  it("alimenta withUser() (UserContext) pero no es un TenantContext", () => {
    expectTypeOf<AuthenticatedUser>().toExtend<UserContext>();
    expectTypeOf<AuthenticatedUser>().not.toExtend<TenantContext>();
    expectTypeOf<AuthenticatedUser>().not.toHaveProperty("organizationId");
  });
});
