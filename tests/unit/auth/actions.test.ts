import {
  AuthApiError,
  AuthRetryableFetchError,
  AuthUnknownError,
} from "@supabase/supabase-js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { signIn, signOut } from "@/lib/auth/actions";

/*
 * Server Actions de login y logout con el cliente de Supabase Auth simulado.
 * Los errores son las clases reales de @supabase/supabase-js. Valores
 * ficticios.
 */

vi.mock("server-only", () => ({}));

const mocks = vi.hoisted(() => {
  class RedirectSignal extends Error {
    constructor(readonly path: string) {
      super(`redirect(${path})`);
    }
  }
  const auth = {
    signInWithPassword: vi.fn(),
    signOut: vi.fn(),
    signUp: vi.fn(),
    getSession: vi.fn(),
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

const EMAIL = "vendedor@example.test";
const PASSWORD = "  pw-que-no-se-loguea  ";
const ORG = "00000000-0000-4000-8000-000000000001";

function form(fields: Record<string, string>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) data.append(key, value);
  return data;
}

async function redirectOf(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof mocks.RedirectSignal) return error.path;
    throw error;
  }
  throw new Error("expected a redirect");
}

const consoleSpies = {
  error: vi.spyOn(console, "error"),
  warn: vi.spyOn(console, "warn"),
  log: vi.spyOn(console, "log"),
  info: vi.spyOn(console, "info"),
};

function loggedText(): string {
  return JSON.stringify(
    Object.values(consoleSpies).flatMap((spy) => spy.mock.calls),
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  for (const spy of Object.values(consoleSpies)) {
    spy.mockImplementation(() => undefined);
  }
  mocks.auth.signInWithPassword.mockResolvedValue({
    data: { user: { id: "u" }, session: { access_token: "t" } },
    error: null,
  });
  mocks.auth.signOut.mockResolvedValue({ error: null });
});

afterEach(() => {
  // Ningún camino de login o logout loguea credenciales.
  expect(loggedText()).not.toContain(PASSWORD.trim());
  expect(loggedText()).not.toContain(EMAIL);
});

describe("signIn", () => {
  it("login exitoso: password auth con el email normalizado y el password tal cual, y redirect a /cockpit", async () => {
    const path = await redirectOf(
      signIn(null, form({ email: `  ${EMAIL} `, password: PASSWORD })),
    );

    expect(mocks.auth.signInWithPassword).toHaveBeenCalledTimes(1);
    expect(mocks.auth.signInWithPassword).toHaveBeenCalledWith({
      email: EMAIL,
      password: PASSWORD,
    });
    expect(path).toBe("/cockpit");
  });

  it("ignora organización y destino enviados por el cliente", async () => {
    const path = await redirectOf(
      signIn(
        null,
        form({
          email: EMAIL,
          password: PASSWORD,
          organization_id: ORG,
          organizationId: ORG,
          redirectTo: "https://evil.example",
          next: "//evil.example",
        }),
      ),
    );

    expect(mocks.auth.signInWithPassword.mock.calls[0]?.[0]).toEqual({
      email: EMAIL,
      password: PASSWORD,
    });
    expect(path).toBe("/cockpit");
  });

  it("nunca registra usuarios (signup público deshabilitado)", async () => {
    await redirectOf(signIn(null, form({ email: EMAIL, password: PASSWORD })));
    expect(mocks.auth.signUp).not.toHaveBeenCalled();
  });

  it("credenciales inválidas: error genérico, sin redirect y sin devolver el password", async () => {
    mocks.auth.signInWithPassword.mockResolvedValue({
      data: { user: null, session: null },
      error: new AuthApiError(
        "Invalid login credentials",
        400,
        "invalid_credentials",
      ),
    });

    const state = await signIn(
      null,
      form({ email: EMAIL, password: PASSWORD }),
    );

    expect(state).toEqual({ error: "invalid_credentials", email: EMAIL });
    expect(JSON.stringify(state)).not.toContain(PASSWORD.trim());
    expect(mocks.redirect).not.toHaveBeenCalled();
    expect(consoleSpies.error).not.toHaveBeenCalled();
  });

  it.each([
    ["invalid_credentials", 400],
    ["email_not_confirmed", 400],
    ["user_banned", 400],
    ["user_not_found", 404],
    ["validation_failed", 422],
  ])(
    "no revela si la cuenta existe: %s responde igual que credenciales inválidas",
    async (code, status) => {
      mocks.auth.signInWithPassword.mockResolvedValue({
        data: { user: null, session: null },
        error: new AuthApiError("x", status, code),
      });

      await expect(
        signIn(null, form({ email: EMAIL, password: PASSWORD })),
      ).resolves.toEqual({ error: "invalid_credentials", email: EMAIL });
    },
  );

  it("demasiados intentos (429)", async () => {
    mocks.auth.signInWithPassword.mockResolvedValue({
      data: { user: null, session: null },
      error: new AuthApiError("Too many", 429, "over_request_rate_limit"),
    });

    await expect(
      signIn(null, form({ email: EMAIL, password: PASSWORD })),
    ).resolves.toEqual({ error: "rate_limited", email: EMAIL });
  });

  it.each([
    ["red caída", new AuthRetryableFetchError("fetch failed", 0)],
    ["503", new AuthRetryableFetchError("unavailable", 503)],
    ["500", new AuthApiError("boom", 500, "unexpected_failure")],
    ["sin status", new AuthUnknownError("unknown", null)],
  ])(
    "proveedor no disponible (%s): error genérico y log sin credenciales",
    async (_, error) => {
      mocks.auth.signInWithPassword.mockResolvedValue({
        data: { user: null, session: null },
        error,
      });

      await expect(
        signIn(null, form({ email: EMAIL, password: PASSWORD })),
      ).resolves.toEqual({ error: "unavailable", email: EMAIL });
      expect(consoleSpies.error).toHaveBeenCalledTimes(1);
    },
  );

  it("si el cliente lanza, falla de forma segura", async () => {
    mocks.auth.signInWithPassword.mockRejectedValue(
      new Error(`boom ${EMAIL} ${PASSWORD}`),
    );

    await expect(
      signIn(null, form({ email: EMAIL, password: PASSWORD })),
    ).resolves.toEqual({ error: "unavailable", email: EMAIL });
    expect(mocks.redirect).not.toHaveBeenCalled();
  });

  it.each([
    ["sin email", { password: PASSWORD }, "missing_fields", ""],
    ["sin password", { email: EMAIL }, "missing_fields", EMAIL],
    ["password vacío", { email: EMAIL, password: "" }, "missing_fields", EMAIL],
    [
      "email inválido",
      { email: "vendedor", password: PASSWORD },
      "invalid_email",
      "vendedor",
    ],
    [
      "password desmedido",
      { email: EMAIL, password: "x".repeat(1025) },
      "invalid_credentials",
      EMAIL,
    ],
  ])(
    "valida en el servidor sin llamar a Supabase: %s",
    async (_, fields, error, email) => {
      await expect(signIn(null, form(fields))).resolves.toEqual({
        error,
        email,
      });
      expect(mocks.createAuthClient).not.toHaveBeenCalled();
    },
  );
});

describe("signOut", () => {
  it("cierra la sesión actual en Supabase y redirige a /login", async () => {
    const path = await redirectOf(signOut());

    expect(mocks.auth.signOut).toHaveBeenCalledTimes(1);
    expect(mocks.auth.signOut).toHaveBeenCalledWith({ scope: "local" });
    expect(path).toBe("/login");
  });

  it("redirige a /login aunque la revocación remota falle", async () => {
    mocks.auth.signOut.mockResolvedValue({
      error: new AuthRetryableFetchError("fetch failed", 0),
    });

    expect(await redirectOf(signOut())).toBe("/login");
    expect(consoleSpies.error).toHaveBeenCalledTimes(1);
  });

  it("redirige a /login aunque el cliente lance", async () => {
    mocks.auth.signOut.mockRejectedValue(new Error("boom"));

    expect(await redirectOf(signOut())).toBe("/login");
  });
});
