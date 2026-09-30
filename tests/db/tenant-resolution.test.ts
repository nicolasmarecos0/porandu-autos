import { randomUUID } from "node:crypto";

import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { listActiveMemberships } from "@/db/queries/memberships";
import { memberships, organizations } from "@/db/schema";
import {
  TenantContextError,
  withTenant,
  withUser,
  type TenantContext,
} from "@/db/tenant";
import { selectOrganization } from "@/lib/tenant/actions";
import { ACTIVE_ORGANIZATION_COOKIE } from "@/lib/tenant/cookie";
import { getActiveMemberships, requireTenant } from "@/lib/tenant/session";

import { cookieJar, type CookieJar } from "../unit/support/cookie-jar";
import {
  runMigrations,
  startTestServer,
  type TestDatabase,
  type TestServer,
} from "./support/postgres";
import { closeRuntimePool } from "./support/runtime";
import {
  MEMBERSHIPS,
  ORG_1,
  ORG_2,
  ORG_3,
  seedTenants,
  USER_A,
  USER_B,
  USER_C,
  USER_D,
  USER_E,
  userContext,
  USERS,
} from "./support/tenants";

/*
 * Tenant Resolution (H0.7) de punta a punta contra PostgreSQL 17 con las
 * migraciones aplicadas: requireTenant(), la query de memberships propias
 * (withUser() como app_runtime, con RLS) y el selector. Supabase Auth
 * (claims ya verificados), la cookie y el redirect de Next son simulados;
 * la cookie usa la implementación real de Next.
 *
 * Tenants de tests/db/support/tenants.ts:
 *   A: admin de ORG_1 · B: admin de ORG_2 · C: seller de ORG_1, admin de
 *   ORG_3 e inactivo en ORG_2 · D: solo inactivo en ORG_1 · E: sin memberships.
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
    claims: null as Record<string, unknown> | null,
    jar: null as CookieJar | null,
    redirect: (path: string): never => {
      throw new RedirectSignal(path);
    },
  };
});

vi.mock("@/lib/supabase/server", () => ({
  createAuthClient: async () => ({
    getClaims: async () =>
      mocks.claims
        ? { data: { claims: mocks.claims }, error: null }
        : { data: null, error: null },
  }),
}));
vi.mock("next/headers", () => ({
  cookies: async () => {
    if (!mocks.jar) throw new Error("no cookie jar");
    return mocks.jar.store;
  },
}));
vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));

let server: TestServer;
let db: TestDatabase;

beforeAll(async () => {
  server = await startTestServer();
  db = await server.createDatabase();
  await runMigrations(db.migrationUrl);
  await seedTenants(db.admin);
  vi.stubEnv("RUNTIME_DATABASE_URL", await db.runtimeUrl());
});

afterAll(async () => {
  await closeRuntimePool();
  vi.unstubAllEnvs();
  await server?.close();
});

const ORG_NAMES: Record<string, string> = {
  [ORG_1]: "Organización 1",
  [ORG_2]: "Organización 2",
  [ORG_3]: "Organización 3",
};

/** Claims de un access token verificado por Supabase Auth para `userId`. */
function claimsFor(userId: string, extra: Record<string, unknown> = {}) {
  return {
    iss: "https://testref.supabase.co/auth/v1",
    sub: userId,
    aud: "authenticated",
    exp: 1_900_000_000,
    iat: 1_899_996_400,
    role: "authenticated",
    aal: "aal1",
    session_id: "00000000-0000-4000-8000-0000000000e1",
    ...extra,
  };
}

/** Nueva request: usuario autenticado (o ninguno) y cookie de organización. */
function request(
  userId: string | null,
  options: { cookie?: string; claims?: Record<string, unknown> } = {},
): void {
  mocks.claims = userId ? claimsFor(userId, options.claims) : null;
  mocks.jar = cookieJar(
    options.cookie === undefined
      ? {}
      : { [ACTIVE_ORGANIZATION_COOKIE]: options.cookie },
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

/** Lo que un loader tenant-scoped vería con ese contexto. */
async function tenantData(ctx: TenantContext) {
  return withTenant(ctx, async (tx) => ({
    organizations: (
      await tx
        .select({ id: organizations.id })
        .from(organizations)
        .where(eq(organizations.id, ctx.organizationId))
    ).map((o) => o.id),
    members: (
      await tx
        .select({ userId: memberships.userId })
        .from(memberships)
        .where(eq(memberships.organizationId, ctx.organizationId))
        .orderBy(memberships.userId)
    ).map((m) => m.userId),
  }));
}

function form(fields: Record<string, string>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) data.append(key, value);
  return data;
}

function writtenOrganizationCookie(): string | null {
  const header = (mocks.jar?.setCookies() ?? []).find((h) =>
    h.startsWith(`${ACTIVE_ORGANIZATION_COOKIE}=`),
  );
  if (!header) return null;
  return header.slice(ACTIVE_ORGANIZATION_COOKIE.length + 1).split(";")[0]!;
}

async function setActive(
  userId: string,
  organizationId: string,
  active: boolean,
): Promise<void> {
  await db.admin`
    UPDATE public.memberships SET active = ${active}
    WHERE organization_id = ${organizationId} AND user_id = ${userId}
  `;
}

describe("memberships propias (listActiveMemberships)", () => {
  it.each(USERS)(
    "%s ve exactamente sus memberships activas, con nombre y rol",
    async (userId) => {
      const expected = MEMBERSHIPS.filter(
        (m) => m.userId === userId && m.active,
      )
        .map((m) => ({
          organizationId: m.organizationId,
          organizationName: ORG_NAMES[m.organizationId],
          role: m.role,
        }))
        .sort((a, b) =>
          (a.organizationName ?? "").localeCompare(b.organizationName ?? ""),
        );

      expect(await listActiveMemberships(userContext(userId))).toEqual(
        expected,
      );
    },
  );

  it("filtra por user_id: RLS le muestra a A memberships ajenas de ORG_1 que la query no devuelve", async () => {
    const visibleByRls = await withUser(userContext(USER_A), (tx) =>
      tx
        .select({ userId: memberships.userId })
        .from(memberships)
        .orderBy(memberships.userId),
    );
    expect(visibleByRls.map((m) => m.userId)).toEqual([USER_A, USER_C, USER_D]);

    expect(await listActiveMemberships(userContext(USER_A))).toEqual([
      {
        organizationId: ORG_1,
        organizationName: "Organización 1",
        role: "admin",
      },
    ]);
  });

  it("un usuario sin perfil ni memberships no ve nada", async () => {
    expect(await listActiveMemberships(userContext(randomUUID()))).toEqual([]);
  });

  it("el selector lista solo las memberships propias y activas de C", async () => {
    request(USER_C);
    expect(await getActiveMemberships()).toEqual([
      {
        organizationId: ORG_1,
        organizationName: "Organización 1",
        role: "seller",
      },
      {
        organizationId: ORG_3,
        organizationName: "Organización 3",
        role: "admin",
      },
    ]);
  });
});

describe("requireTenant contra la base", () => {
  it("sin usuario → /login", async () => {
    request(null, { cookie: ORG_1 });
    expect(await redirectOf(requireTenant())).toBe("/login");
  });

  it("0 memberships → /no-access (E)", async () => {
    request(USER_E);
    expect(await redirectOf(requireTenant())).toBe("/no-access");
  });

  it("solo una membership inactiva → /no-access, aun con la cookie de esa organización (D)", async () => {
    request(USER_D, { cookie: ORG_1 });
    expect(await redirectOf(requireTenant())).toBe("/no-access");
  });

  it("1 membership sin cookie → tenant único, rol de la base (A)", async () => {
    request(USER_A);
    expect(await tenant()).toEqual({
      userId: USER_A,
      organizationId: ORG_1,
      role: "admin",
    });
  });

  it.each([
    ["de otra organización (ORG_2, de B)", ORG_2],
    ["con un UUID inexistente", randomUUID()],
    ["falsificada (no UUID)", "ORG_2"],
  ])("1 membership + cookie %s → el tenant real de A", async (_, cookie) => {
    request(USER_A, { cookie });
    expect((await tenant()).organizationId).toBe(ORG_1);
  });

  it("varias memberships + cookie válida → esa organización con su rol (C)", async () => {
    request(USER_C, { cookie: ORG_3 });
    expect(await tenant()).toEqual({
      userId: USER_C,
      organizationId: ORG_3,
      role: "admin",
    });

    request(USER_C, { cookie: ORG_1 });
    expect(await tenant()).toEqual({
      userId: USER_C,
      organizationId: ORG_1,
      role: "seller",
    });
  });

  it.each([
    ["sin cookie", undefined],
    ["con la cookie de su membership inactiva (ORG_2)", ORG_2],
    ["con una cookie inexistente", randomUUID()],
    ["con una cookie inválida", "not-a-uuid"],
  ])("varias memberships %s → /select-organization (C)", async (_, cookie) => {
    request(USER_C, { cookie });
    expect(await redirectOf(requireTenant())).toBe("/select-organization");
  });

  it("ninguna organización ni rol se derivan del JWT", async () => {
    const orgClaims = {
      organization_id: ORG_2,
      role_in_org: "admin",
      app_metadata: {
        provider: "email",
        organization_id: ORG_2,
        role: "admin",
      },
      user_metadata: { organization_id: ORG_2, role: "admin" },
    };

    request(USER_C, { claims: orgClaims });
    expect(await redirectOf(requireTenant())).toBe("/select-organization");

    request(USER_C, { claims: orgClaims, cookie: ORG_1 });
    const context = await requireTenant();
    expect(context.organizationId).toBe(ORG_1);
    expect(context.role).toBe("seller");
    expect(JSON.stringify(context.claims)).not.toContain(ORG_2);
  });

  it("el contexto resuelto abre withTenant() y solo ve su organización", async () => {
    request(USER_C, { cookie: ORG_3 });
    expect(await tenantData(await requireTenant())).toEqual({
      organizations: [ORG_3],
      members: [USER_C],
    });

    request(USER_A);
    expect(await tenantData(await requireTenant())).toEqual({
      organizations: [ORG_1],
      members: [USER_A, USER_C, USER_D],
    });
  });

  it("withTenant() no acepta un contexto armado a mano, ni con la forma exacta", async () => {
    request(USER_A);
    const resolved = await requireTenant();
    const forged = { ...resolved, organizationId: ORG_2 };

    await expect(tenantData(forged)).rejects.toBeInstanceOf(TenantContextError);
    await expect(
      tenantData({ ...resolved } as TenantContext),
    ).rejects.toBeInstanceOf(TenantContextError);
  });
});

describe("selector (selectOrganization) contra la base", () => {
  it("una selección válida escribe la cookie y el request siguiente usa esa organización", async () => {
    request(USER_C);
    expect(
      await redirectOf(
        selectOrganization(null, form({ organizationId: ORG_3 })),
      ),
    ).toBe("/cockpit");
    const cookie = writtenOrganizationCookie();
    expect(cookie).toBe(ORG_3);

    request(USER_C, { cookie: cookie ?? undefined });
    expect(await tenant()).toEqual({
      userId: USER_C,
      organizationId: ORG_3,
      role: "admin",
    });
  });

  it.each([
    ["A no puede seleccionar ORG_2 (de B)", USER_A, ORG_2],
    ["B no puede seleccionar ORG_1 (de A)", USER_B, ORG_1],
    ["C no puede seleccionar ORG_2 (membership inactiva)", USER_C, ORG_2],
    ["D no puede seleccionar ORG_1 (membership inactiva)", USER_D, ORG_1],
    [
      "C no puede seleccionar una organización inexistente",
      USER_C,
      randomUUID(),
    ],
  ])("%s: error genérico y sin cookie", async (_, userId, organizationId) => {
    request(userId);
    await expect(
      selectOrganization(null, form({ organizationId })),
    ).resolves.toEqual({ error: "invalid_selection" });
    expect(mocks.jar?.setCookies()).toEqual([]);
  });

  it("un UUID inválido falla igual", async () => {
    request(USER_C);
    await expect(
      selectOrganization(null, form({ organizationId: "ORG_3" })),
    ).resolves.toEqual({ error: "invalid_selection" });
    expect(mocks.jar?.setCookies()).toEqual([]);
  });

  it("role y userId maliciosos en el form se ignoran: el rol sale de la base", async () => {
    request(USER_C);
    await redirectOf(
      selectOrganization(
        null,
        form({ organizationId: ORG_1, role: "admin", userId: USER_A }),
      ),
    );
    const cookie = writtenOrganizationCookie();
    expect(cookie).toBe(ORG_1);

    request(USER_C, { cookie: cookie ?? undefined });
    expect(await tenant()).toEqual({
      userId: USER_C,
      organizationId: ORG_1,
      role: "seller",
    });
  });
});

describe("revocación: rige desde el request siguiente, aunque la cookie siga", () => {
  it("active=false: A pierde el acceso y el contexto viejo ya no ve nada", async () => {
    request(USER_A, { cookie: ORG_1 });
    const before = await requireTenant();
    expect(before.organizationId).toBe(ORG_1);

    await setActive(USER_A, ORG_1, false);
    try {
      request(USER_A, { cookie: ORG_1 });
      expect(await redirectOf(requireTenant())).toBe("/no-access");
      // Un contexto emitido antes de la revocación: RLS lo corta (A-09).
      expect(await tenantData(before)).toEqual({
        organizations: [],
        members: [],
      });
    } finally {
      await setActive(USER_A, ORG_1, true);
    }

    request(USER_A, { cookie: ORG_1 });
    expect((await tenant()).organizationId).toBe(ORG_1);
  });

  it("active=false en la organización de la cookie: C cae en su única membership restante, nunca en la revocada", async () => {
    request(USER_C, { cookie: ORG_3 });
    const before = await requireTenant();
    expect(before.organizationId).toBe(ORG_3);

    await setActive(USER_C, ORG_3, false);
    try {
      request(USER_C, { cookie: ORG_3 });
      expect(await tenant()).toEqual({
        userId: USER_C,
        organizationId: ORG_1,
        role: "seller",
      });
      expect(await tenantData(before)).toEqual({
        organizations: [],
        members: [],
      });
      // Tampoco puede volver a elegirla.
      await expect(
        selectOrganization(null, form({ organizationId: ORG_3 })),
      ).resolves.toEqual({ error: "invalid_selection" });
    } finally {
      await setActive(USER_C, ORG_3, true);
    }
  });

  it("membership borrada: C pierde ORG_3 aunque conserve la cookie vieja", async () => {
    await db.admin`
      DELETE FROM public.memberships
      WHERE organization_id = ${ORG_3} AND user_id = ${USER_C}
    `;
    try {
      request(USER_C, { cookie: ORG_3 });
      expect((await tenant()).organizationId).toBe(ORG_1);
    } finally {
      await db.admin`
        INSERT INTO public.memberships (organization_id, user_id, role, active)
        VALUES (${ORG_3}, ${USER_C}, 'admin', true)
      `;
    }

    request(USER_C, { cookie: ORG_3 });
    expect((await tenant()).organizationId).toBe(ORG_3);
  });

  it("un cambio de rol en la base rige desde el request siguiente", async () => {
    await db.admin`
      UPDATE public.memberships SET role = 'seller'
      WHERE organization_id = ${ORG_1} AND user_id = ${USER_A}
    `;
    try {
      request(USER_A);
      expect((await tenant()).role).toBe("seller");
    } finally {
      await db.admin`
        UPDATE public.memberships SET role = 'admin'
        WHERE organization_id = ${ORG_1} AND user_id = ${USER_A}
      `;
    }
    request(USER_A);
    expect((await tenant()).role).toBe("admin");
  });
});

describe("sin bypass del boundary", () => {
  it("la resolución corre como app_runtime con rol authenticated, nunca con privilegios", async () => {
    const [identity] = await withUser(userContext(USER_C), (tx) =>
      tx.execute<{ currentUser: string; sessionUser: string; uid: string }>(
        sql`SELECT current_user AS "currentUser", session_user AS "sessionUser", auth.uid() AS uid`,
      ),
    );
    expect(identity).toEqual({
      currentUser: "authenticated",
      sessionUser: "app_runtime",
      uid: USER_C,
    });
  });
});
