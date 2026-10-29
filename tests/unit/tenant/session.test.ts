import { beforeEach, describe, expect, it, vi } from "vitest";

import type { ActiveMembership } from "@/db/queries/memberships";
import { ACTIVE_ORGANIZATION_COOKIE } from "@/lib/tenant/cookie";
import { isTenantContext } from "@/lib/tenant/resolution";
import {
  getActiveMemberships,
  requireTenant,
  resolveRequestTenant,
} from "@/lib/tenant/session";

import { cookieJar, type CookieJar } from "../support/cookie-jar";

/*
 * requireTenant() (H0.7) con Supabase Auth, la query de memberships y las
 * cookies simuladas: orden de las verificaciones, redirects y origen de cada
 * dato del contexto. resolveRequestTenant() (Hito 8, DEC-040 §3) es la misma
 * resolución sin redirects, para los Route Handlers. Contra PostgreSQL real: tests/db/tenant-resolution.
 * Valores ficticios.
 */

vi.mock("server-only", () => ({}));

const mocks = vi.hoisted(() => {
  class RedirectSignal extends Error {
    constructor(readonly path: string) {
      super(`redirect(${path})`);
    }
  }
  return {
    RedirectSignal,
    getClaims: vi.fn(),
    listActiveMemberships: vi.fn(),
    jar: null as CookieJar | null,
    redirect: vi.fn((path: string) => {
      throw new RedirectSignal(path);
    }),
  };
});

vi.mock("@/lib/supabase/server", () => ({
  createAuthClient: async () => ({ getClaims: mocks.getClaims }),
}));
vi.mock("@/db/queries/memberships", () => ({
  listActiveMemberships: mocks.listActiveMemberships,
}));
vi.mock("next/headers", () => ({
  cookies: async () => {
    if (!mocks.jar) throw new Error("no cookie jar");
    return mocks.jar.store;
  },
}));
vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));

const USER = "00000000-0000-4000-8000-00000000000c";
const ORG_1 = "00000000-0000-4000-8000-000000000001";
const ORG_2 = "00000000-0000-4000-8000-000000000002";
const ORG_3 = "00000000-0000-4000-8000-000000000003";

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

const seller1: ActiveMembership = {
  organizationId: ORG_1,
  organizationName: "Organización 1",
  role: "seller",
};
const admin3: ActiveMembership = {
  organizationId: ORG_3,
  organizationName: "Organización 3",
  role: "admin",
};

function signedIn(claims: Record<string, unknown> = CLAIMS) {
  mocks.getClaims.mockResolvedValue({ data: { claims }, error: null });
}

function withCookie(organizationId?: string) {
  mocks.jar = cookieJar(
    organizationId ? { [ACTIVE_ORGANIZATION_COOKIE]: organizationId } : {},
  );
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

async function tenant() {
  const { userId, organizationId, role } = await requireTenant();
  return { userId, organizationId, role };
}

beforeEach(() => {
  vi.clearAllMocks();
  signedIn();
  withCookie();
});

describe("requireTenant", () => {
  it("sin usuario verificado → /login, sin consultar memberships", async () => {
    mocks.getClaims.mockResolvedValue({ data: null, error: null });
    withCookie(ORG_1);

    expect(await redirectOf(requireTenant())).toBe("/login");
    expect(mocks.listActiveMemberships).not.toHaveBeenCalled();
  });

  it("lee las memberships del usuario verificado (userId de claims.sub)", async () => {
    mocks.listActiveMemberships.mockResolvedValue([seller1]);

    await requireTenant();

    expect(mocks.listActiveMemberships).toHaveBeenCalledTimes(1);
    const [user] = mocks.listActiveMemberships.mock.calls[0] ?? [];
    expect(user).toMatchObject({ userId: USER, claims: { sub: USER } });
  });

  it("0 memberships activas → /no-access", async () => {
    mocks.listActiveMemberships.mockResolvedValue([]);
    withCookie(ORG_1);

    expect(await redirectOf(requireTenant())).toBe("/no-access");
  });

  it("1 membership sin cookie → ese tenant, con el rol de la base", async () => {
    mocks.listActiveMemberships.mockResolvedValue([seller1]);

    expect(await tenant()).toEqual({
      userId: USER,
      organizationId: ORG_1,
      role: "seller",
    });
  });

  it("1 membership + cookie falsificada → el tenant real", async () => {
    mocks.listActiveMemberships.mockResolvedValue([seller1]);
    withCookie(ORG_2);

    expect((await tenant()).organizationId).toBe(ORG_1);
  });

  it("varias memberships + cookie válida → esa organización", async () => {
    mocks.listActiveMemberships.mockResolvedValue([seller1, admin3]);
    withCookie(ORG_3);

    expect(await tenant()).toEqual({
      userId: USER,
      organizationId: ORG_3,
      role: "admin",
    });
  });

  it.each([
    ["sin cookie", undefined],
    ["con cookie inválida", "not-a-uuid"],
    ["con cookie de otra organización", ORG_2],
  ])("varias memberships %s → /select-organization", async (_, cookie) => {
    mocks.listActiveMemberships.mockResolvedValue([seller1, admin3]);
    withCookie(cookie);

    expect(await redirectOf(requireTenant())).toBe("/select-organization");
  });

  it("ninguna organización ni rol salen del JWT", async () => {
    signedIn({
      ...CLAIMS,
      organization_id: ORG_2,
      user_role: "admin",
      app_metadata: { organization_id: ORG_2, role: "admin" },
      user_metadata: { organization_id: ORG_2, role: "admin" },
    });
    mocks.listActiveMemberships.mockResolvedValue([seller1, admin3]);

    expect(await redirectOf(requireTenant())).toBe("/select-organization");

    mocks.listActiveMemberships.mockResolvedValue([seller1]);
    const context = await requireTenant();
    expect(context.organizationId).toBe(ORG_1);
    expect(context.role).toBe("seller");
    expect(JSON.stringify(context)).not.toContain(ORG_2);
  });

  it("devuelve un TenantContext emitido por Tenant Resolution", async () => {
    mocks.listActiveMemberships.mockResolvedValue([seller1]);

    expect(isTenantContext(await requireTenant())).toBe(true);
  });

  it("cada llamada vuelve a validar: no hereda la decisión de una anterior", async () => {
    mocks.listActiveMemberships.mockResolvedValue([seller1]);
    withCookie(ORG_1);
    expect((await tenant()).organizationId).toBe(ORG_1);

    // La membership se revoca; la cookie sigue ahí.
    mocks.listActiveMemberships.mockResolvedValue([]);
    expect(await redirectOf(requireTenant())).toBe("/no-access");
    expect(mocks.listActiveMemberships).toHaveBeenCalledTimes(2);
  });

  it("nunca escribe cookies (un Server Component no puede)", async () => {
    mocks.listActiveMemberships.mockResolvedValue([seller1]);
    withCookie(ORG_2);

    await requireTenant();

    expect(mocks.jar?.setCookies()).toEqual([]);
  });
});

describe("getActiveMemberships", () => {
  it("exige usuario verificado", async () => {
    mocks.getClaims.mockResolvedValue({ data: null, error: null });

    expect(await redirectOf(getActiveMemberships())).toBe("/login");
    expect(mocks.listActiveMemberships).not.toHaveBeenCalled();
  });

  it("devuelve las memberships activas del usuario", async () => {
    mocks.listActiveMemberships.mockResolvedValue([seller1, admin3]);

    await expect(getActiveMemberships()).resolves.toEqual([seller1, admin3]);
  });
});

describe("resolveRequestTenant (sin redirects, DEC-040 §3)", () => {
  it("sin usuario verificado → unauthenticated, sin redirect ni memberships", async () => {
    mocks.getClaims.mockResolvedValue({ data: null, error: null });

    await expect(resolveRequestTenant()).resolves.toEqual({
      kind: "unauthenticated",
    });
    expect(mocks.redirect).not.toHaveBeenCalled();
    expect(mocks.listActiveMemberships).not.toHaveBeenCalled();
  });

  it("0 memberships activas → no-access, sin redirect", async () => {
    mocks.listActiveMemberships.mockResolvedValue([]);

    await expect(resolveRequestTenant()).resolves.toEqual({
      kind: "no-access",
    });
    expect(mocks.redirect).not.toHaveBeenCalled();
  });

  it("varias memberships sin elección válida → select-organization, sin redirect", async () => {
    mocks.listActiveMemberships.mockResolvedValue([seller1, admin3]);
    withCookie(ORG_2);

    await expect(resolveRequestTenant()).resolves.toEqual({
      kind: "select-organization",
    });
    expect(mocks.redirect).not.toHaveBeenCalled();
  });

  it("con organización resuelta → el mismo TenantContext que requireTenant()", async () => {
    mocks.listActiveMemberships.mockResolvedValue([seller1, admin3]);
    withCookie(ORG_3);

    const resolution = await resolveRequestTenant();
    if (resolution.kind !== "resolved") throw new Error("not resolved");
    expect(isTenantContext(resolution.context)).toBe(true);
    const { userId, organizationId, role } = resolution.context;
    expect({ userId, organizationId, role }).toEqual({
      userId: USER,
      organizationId: ORG_3,
      role: "admin",
    });
    expect(await tenant()).toEqual({ userId, organizationId, role });
  });
});
