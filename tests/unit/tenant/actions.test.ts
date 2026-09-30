import { beforeEach, describe, expect, it, vi } from "vitest";

import type { ActiveMembership } from "@/db/queries/memberships";
import { selectOrganization } from "@/lib/tenant/actions";
import { ACTIVE_ORGANIZATION_COOKIE } from "@/lib/tenant/cookie";

import { cookieJar, type CookieJar } from "../support/cookie-jar";

/*
 * Server Action del selector de organización (H0.7) con Supabase Auth, la
 * query de memberships y las cookies simuladas. El `organizationId` del
 * formulario es input no confiable. Contra PostgreSQL real:
 * tests/db/tenant-resolution.test.ts. Valores ficticios.
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
const OTHER_USER = "00000000-0000-4000-8000-00000000000a";
const ORG_1 = "00000000-0000-4000-8000-000000000001";
const ORG_2 = "00000000-0000-4000-8000-000000000002";
// Con letras, para probar la normalización de mayúsculas.
const ORG_HEX = "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";

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

const MEMBERSHIPS: ActiveMembership[] = [
  { organizationId: ORG_1, organizationName: "Organización 1", role: "seller" },
  {
    organizationId: ORG_HEX,
    organizationName: "Organización H",
    role: "admin",
  },
];

const GENERIC_ERROR = { error: "invalid_selection" };

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

function setCookies(): string[] {
  return mocks.jar?.setCookies() ?? [];
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getClaims.mockResolvedValue({ data: { claims: CLAIMS }, error: null });
  mocks.listActiveMemberships.mockResolvedValue(MEMBERSHIPS);
  mocks.jar = cookieJar();
});

describe("selectOrganization", () => {
  it("selección válida: escribe la cookie y redirige a /cockpit", async () => {
    const path = await redirectOf(
      selectOrganization(null, form({ organizationId: ORG_1 })),
    );

    expect(path).toBe("/cockpit");
    const written = setCookies();
    expect(written).toHaveLength(1);
    expect(written[0]).toMatch(
      new RegExp(`^${ACTIVE_ORGANIZATION_COOKIE}=${ORG_1};`),
    );
    expect(written[0]).toMatch(/; HttpOnly(;|$)/i);
    expect(written[0]).toMatch(/; SameSite=Lax(;|$)/i);
    expect(written[0]).toMatch(/; Path=\/(;|$)/);
  });

  it("valida contra las memberships del usuario verificado, leídas de nuevo", async () => {
    await redirectOf(selectOrganization(null, form({ organizationId: ORG_1 })));

    expect(mocks.getClaims).toHaveBeenCalledTimes(1);
    expect(mocks.listActiveMemberships).toHaveBeenCalledTimes(1);
    expect(mocks.listActiveMemberships.mock.calls[0]?.[0]).toMatchObject({
      userId: USER,
    });
  });

  it("la cookie lleva el UUID de la base, no el del input", async () => {
    await redirectOf(
      selectOrganization(null, form({ organizationId: ORG_HEX.toUpperCase() })),
    );

    expect(setCookies()[0]).toMatch(
      new RegExp(`^${ACTIVE_ORGANIZATION_COOKIE}=${ORG_HEX};`),
    );
  });

  it("role y userId maliciosos en el form se ignoran", async () => {
    const path = await redirectOf(
      selectOrganization(
        null,
        form({
          organizationId: ORG_1,
          role: "admin",
          userId: OTHER_USER,
          user_id: OTHER_USER,
          organization_id: ORG_2,
          next: "https://evil.example",
        }),
      ),
    );

    expect(path).toBe("/cockpit");
    expect(mocks.listActiveMemberships.mock.calls[0]?.[0]).toMatchObject({
      userId: USER,
    });
    const [cookie] = setCookies();
    expect(cookie).toMatch(
      new RegExp(`^${ACTIVE_ORGANIZATION_COOKIE}=${ORG_1};`),
    );
    expect(cookie).not.toMatch(/admin|seller|role/i);
    expect(cookie).not.toContain(OTHER_USER);
    expect(cookie).not.toContain(USER);
  });

  it.each([
    ["ajena (sin membership activa)", ORG_2],
    ["inexistente", "00000000-0000-4000-8000-0000000000ff"],
  ])(
    "una organización %s falla con un error genérico y sin cookie",
    async (_, organizationId) => {
      await expect(
        selectOrganization(null, form({ organizationId })),
      ).resolves.toEqual(GENERIC_ERROR);
      expect(setCookies()).toEqual([]);
      expect(mocks.redirect).not.toHaveBeenCalled();
    },
  );

  it.each([
    ["sin organizationId", {}],
    ["vacío", { organizationId: "" }],
    ["que no es UUID", { organizationId: "org-1" }],
    ["con inyección", { organizationId: `${ORG_1}' OR '1'='1` }],
  ])("un organizationId %s falla sin consultar la base", async (_, fields) => {
    await expect(selectOrganization(null, form(fields))).resolves.toEqual(
      GENERIC_ERROR,
    );
    expect(mocks.listActiveMemberships).not.toHaveBeenCalled();
    expect(setCookies()).toEqual([]);
  });

  it("sin usuario verificado → /login, sin consultar ni escribir nada", async () => {
    mocks.getClaims.mockResolvedValue({ data: null, error: null });

    expect(
      await redirectOf(
        selectOrganization(null, form({ organizationId: ORG_1 })),
      ),
    ).toBe("/login");
    expect(mocks.listActiveMemberships).not.toHaveBeenCalled();
    expect(setCookies()).toEqual([]);
  });

  it("sin memberships activas, ninguna selección escribe la cookie", async () => {
    mocks.listActiveMemberships.mockResolvedValue([]);

    await expect(
      selectOrganization(null, form({ organizationId: ORG_1 })),
    ).resolves.toEqual(GENERIC_ERROR);
    expect(setCookies()).toEqual([]);
  });
});
