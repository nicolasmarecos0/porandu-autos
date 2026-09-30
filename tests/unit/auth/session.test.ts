import { beforeEach, describe, expect, it, vi } from "vitest";

import { getAuthenticatedUser, requireUser } from "@/lib/auth/session";

/*
 * Auth guard de H0.6: requireUser() con el cliente de Supabase Auth simulado.
 * La integración con @supabase/ssr real (cookies y refresh) está en
 * proxy.test.ts.
 */

// `server-only` lo resuelve Next; en Vitest (entorno node) es un no-op.
vi.mock("server-only", () => ({}));

const mocks = vi.hoisted(() => {
  class RedirectSignal extends Error {
    constructor(readonly path: string) {
      super(`redirect(${path})`);
    }
  }
  const auth = {
    getClaims: vi.fn(),
    getSession: vi.fn(),
    getUser: vi.fn(),
  };
  return {
    RedirectSignal,
    auth,
    createAuthClient: vi.fn(async () => auth),
    redirect: vi.fn((path: string) => {
      throw new RedirectSignal(path);
    }),
  };
});

vi.mock("@/lib/supabase/server", () => ({
  createAuthClient: mocks.createAuthClient,
}));
vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));

const USER = "00000000-0000-4000-8000-00000000000a";

const CLAIMS = {
  iss: "https://testref.supabase.co/auth/v1",
  sub: USER,
  aud: "authenticated",
  exp: 1_900_000_000,
  iat: 1_899_996_400,
  role: "authenticated",
  aal: "aal1",
  session_id: "00000000-0000-4000-8000-0000000000e1",
};

async function redirectOf(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof mocks.RedirectSignal) return error.path;
    throw error;
  }
  throw new Error("expected a redirect");
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("requireUser", () => {
  it("con claims válidos devuelve la identidad y no redirige", async () => {
    mocks.auth.getClaims.mockResolvedValue({
      data: { claims: CLAIMS },
      error: null,
    });

    await expect(requireUser()).resolves.toEqual({
      userId: USER,
      claims: CLAIMS,
    });
    expect(mocks.redirect).not.toHaveBeenCalled();
  });

  it("autoriza con getClaims(), nunca con getSession() ni getUser()", async () => {
    mocks.auth.getClaims.mockResolvedValue({
      data: { claims: CLAIMS },
      error: null,
    });

    await requireUser();

    expect(mocks.auth.getClaims).toHaveBeenCalledTimes(1);
    expect(mocks.auth.getSession).not.toHaveBeenCalled();
    expect(mocks.auth.getUser).not.toHaveBeenCalled();
  });

  it.each([
    ["sin sesión", { data: null, error: null }],
    ["token inválido o vencido", { data: null, error: new Error("JWT") }],
    [
      "sub que no es UUID",
      { data: { claims: { ...CLAIMS, sub: "user-a" } }, error: null },
    ],
    [
      "rol anon",
      { data: { claims: { ...CLAIMS, role: "anon" } }, error: null },
    ],
  ])(
    "rechaza al usuario no autenticado (%s) con redirect a /login",
    async (_, result) => {
      mocks.auth.getClaims.mockResolvedValue(result);

      expect(await redirectOf(requireUser())).toBe("/login");
    },
  );

  it("falla cerrado si la verificación lanza", async () => {
    mocks.auth.getClaims.mockRejectedValue(new TypeError("fetch failed"));

    expect(await redirectOf(requireUser())).toBe("/login");
  });

  it("aunque getSession() tenga una sesión, sin claims verificados no hay usuario", async () => {
    mocks.auth.getSession.mockResolvedValue({
      data: { session: { access_token: "forged", user: { id: USER } } },
      error: null,
    });
    mocks.auth.getClaims.mockResolvedValue({
      data: null,
      error: new Error("Invalid JWT signature"),
    });

    expect(await redirectOf(requireUser())).toBe("/login");
  });
});

describe("getAuthenticatedUser", () => {
  it("sin usuario devuelve null, sin redirigir", async () => {
    mocks.auth.getClaims.mockResolvedValue({ data: null, error: null });

    await expect(getAuthenticatedUser()).resolves.toBeNull();
    expect(mocks.redirect).not.toHaveBeenCalled();
  });
});
