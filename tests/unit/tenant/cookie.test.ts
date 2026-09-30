import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  ACTIVE_ORGANIZATION_COOKIE,
  activeOrganizationCookieOptions,
  clearActiveOrganization,
  readActiveOrganization,
  writeActiveOrganization,
} from "@/lib/tenant/cookie";

import { cookieJar, type CookieJar } from "../support/cookie-jar";

/*
 * Cookie de organización activa (H0.7), serializada por la implementación
 * real de cookies de Next. Solo guarda un UUID de organización: nunca rol,
 * userId ni permisos.
 */

vi.mock("server-only", () => ({}));

const mocks = vi.hoisted(() => ({ jar: null as CookieJar | null }));

vi.mock("next/headers", () => ({
  cookies: async () => {
    if (!mocks.jar) throw new Error("no cookie jar");
    return mocks.jar.store;
  },
}));

const ORG = "00000000-0000-4000-8000-000000000001";

beforeEach(() => {
  mocks.jar = cookieJar();
});

afterEach(() => {
  vi.unstubAllEnvs();
});

function written(): string {
  const setCookies = mocks.jar?.setCookies() ?? [];
  expect(setCookies).toHaveLength(1);
  return setCookies[0] ?? "";
}

describe("cookie de organización activa", () => {
  it("tiene un nombre explícito de Porandú", () => {
    expect(ACTIVE_ORGANIZATION_COOKIE).toBe("porandu-active-organization");
  });

  it("se escribe HttpOnly, SameSite=Lax y Path=/, solo con el UUID", async () => {
    await writeActiveOrganization(ORG);

    const header = written();
    expect(header).toMatch(
      new RegExp(`^${ACTIVE_ORGANIZATION_COOKIE}=${ORG};`),
    );
    expect(header).toMatch(/; Path=\/(;|$)/);
    expect(header).toMatch(/; HttpOnly(;|$)/i);
    expect(header).toMatch(/; SameSite=Lax(;|$)/i);
    expect(header).toMatch(/; Max-Age=34560000(;|$)/);
    expect(header).not.toMatch(/; Domain=/i);
    // Fuera de producción no exige HTTPS (http://localhost).
    expect(header).not.toMatch(/; Secure(;|$)/i);
    expect(header).not.toMatch(/admin|seller|role|user/i);
  });

  it("en producción es Secure", async () => {
    vi.stubEnv("NODE_ENV", "production");
    expect(activeOrganizationCookieOptions().secure).toBe(true);

    await writeActiveOrganization(ORG);

    expect(written()).toMatch(/; Secure(;|$)/i);
  });

  it("el logout la borra con los mismos atributos", async () => {
    vi.stubEnv("NODE_ENV", "production");
    mocks.jar = cookieJar({ [ACTIVE_ORGANIZATION_COOKIE]: ORG });

    await clearActiveOrganization();

    const header = written();
    expect(header).toMatch(new RegExp(`^${ACTIVE_ORGANIZATION_COOKIE}=;`));
    expect(header).toMatch(/; Expires=Thu, 01 Jan 1970 00:00:00 GMT(;|$)/);
    expect(header).toMatch(/; Path=\/(;|$)/);
    expect(header).toMatch(/; HttpOnly(;|$)/i);
    expect(header).toMatch(/; SameSite=Lax(;|$)/i);
    expect(header).toMatch(/; Secure(;|$)/i);
    expect(await readActiveOrganization()).toBe("");
  });

  it("se lee cruda, como preferencia sin validar", async () => {
    mocks.jar = cookieJar({ [ACTIVE_ORGANIZATION_COOKIE]: "cualquier-cosa" });
    expect(await readActiveOrganization()).toBe("cualquier-cosa");

    mocks.jar = cookieJar();
    expect(await readActiveOrganization()).toBeNull();
  });
});
