import { describe, expect, expectTypeOf, it } from "vitest";

import type { ActiveMembership } from "@/db/queries/memberships";
import type { AuthenticatedUser } from "@/lib/auth/claims";
import {
  isTenantContext,
  parseOrganizationId,
  resolveTenant,
  type TenantContext,
  type TenantResolution,
} from "@/lib/tenant/resolution";

/*
 * Algoritmo de Tenant Resolution (H0.7), puro: memberships activas del
 * usuario + organización preferida (cookie) → organización activa. La
 * integración con la base, la cookie real y los redirects está en
 * tests/db/tenant-resolution.test.ts. Valores ficticios.
 */

const USER = "00000000-0000-4000-8000-00000000000c";
const ORG_1 = "00000000-0000-4000-8000-000000000001";
const ORG_2 = "00000000-0000-4000-8000-000000000002";
const ORG_3 = "00000000-0000-4000-8000-000000000003";

const user: AuthenticatedUser = {
  userId: USER,
  claims: {
    sub: USER,
    role: "authenticated",
    aud: "authenticated",
    iss: "https://testref.supabase.co/auth/v1",
    iat: 1_899_996_400,
    exp: 1_900_000_000,
    aal: "aal1",
    session_id: "00000000-0000-4000-8000-0000000000e1",
  },
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

function contextOf(resolution: TenantResolution): TenantContext {
  if (resolution.kind !== "resolved") {
    throw new Error(`expected a tenant, got ${resolution.kind}`);
  }
  return resolution.context;
}

function tenantOf(resolution: TenantResolution) {
  const { userId, organizationId, role } = contextOf(resolution);
  return { userId, organizationId, role };
}

describe("resolveTenant", () => {
  it("0 memberships activas → no-access, con o sin cookie", () => {
    expect(resolveTenant(user, [], undefined)).toEqual({ kind: "no-access" });
    expect(resolveTenant(user, [], ORG_1)).toEqual({ kind: "no-access" });
  });

  it("1 membership sin cookie → ese tenant", () => {
    expect(tenantOf(resolveTenant(user, [seller1], null))).toEqual({
      userId: USER,
      organizationId: ORG_1,
      role: "seller",
    });
  });

  it.each([
    ["de otra organización", ORG_2],
    ["con un UUID inexistente", "00000000-0000-4000-8000-0000000000ff"],
    ["que no es un UUID", "ORG_2"],
    ["vacía", ""],
    ["con inyección", "' OR 1=1 --"],
  ])(
    "1 membership + cookie %s → el tenant real, nunca el de la cookie",
    (_, cookie) => {
      expect(tenantOf(resolveTenant(user, [seller1], cookie))).toEqual({
        userId: USER,
        organizationId: ORG_1,
        role: "seller",
      });
    },
  );

  it("varias memberships + cookie válida → la organización de la cookie, con su rol", () => {
    expect(tenantOf(resolveTenant(user, [seller1, admin3], ORG_3))).toEqual({
      userId: USER,
      organizationId: ORG_3,
      role: "admin",
    });
    expect(tenantOf(resolveTenant(user, [seller1, admin3], ORG_1))).toEqual({
      userId: USER,
      organizationId: ORG_1,
      role: "seller",
    });
  });

  it.each([
    ["sin cookie (undefined)", undefined],
    ["sin cookie (null)", null],
    ["cookie de una organización ajena", ORG_2],
    ["cookie inexistente", "00000000-0000-4000-8000-0000000000ff"],
    ["cookie que no es UUID", "not-a-uuid"],
    ["cookie con espacios (no canónica)", ` ${ORG_3}`],
  ])("varias memberships + %s → selector", (_, cookie) => {
    expect(resolveTenant(user, [seller1, admin3], cookie)).toEqual({
      kind: "select-organization",
    });
  });

  it("el rol sale de la membership, nunca de los claims", () => {
    const claimsWithRole: AuthenticatedUser = {
      userId: USER,
      claims: {
        ...user.claims,
        user_role: "admin",
        app_metadata: { role: "admin", organization_id: ORG_2 },
      },
    };
    expect(
      contextOf(resolveTenant(claimsWithRole, [seller1], ORG_2)).role,
    ).toBe("seller");
  });

  it("la identidad del contexto es la del usuario verificado", () => {
    const context = contextOf(resolveTenant(user, [seller1], undefined));
    expect(context.userId).toBe(USER);
    expect(context.claims).toEqual(user.claims);
  });

  it.each<[string, ActiveMembership]>([
    [
      "organizationId que no es UUID",
      { organizationId: "ORG_2", organizationName: "x", role: "admin" },
    ],
    [
      "rol desconocido",
      {
        organizationId: ORG_2,
        organizationName: "x",
        role: "owner" as ActiveMembership["role"],
      },
    ],
  ])(
    "una membership con forma inesperada (%s) no concede acceso",
    (_, malformed) => {
      expect(resolveTenant(user, [malformed], ORG_2)).toEqual({
        kind: "no-access",
      });
      expect(
        tenantOf(resolveTenant(user, [seller1, malformed], ORG_2)),
      ).toEqual({ userId: USER, organizationId: ORG_1, role: "seller" });
    },
  );
});

describe("TenantContext emitido", () => {
  it("es reconocido por isTenantContext y queda congelado", () => {
    const context = contextOf(resolveTenant(user, [seller1], undefined));
    expect(isTenantContext(context)).toBe(true);
    expect(Object.isFrozen(context)).toBe(true);
    expect(Object.keys(context).sort()).toEqual([
      "claims",
      "organizationId",
      "role",
      "userId",
    ]);
  });

  it("un objeto plano, un AuthenticatedUser o una copia no lo son", () => {
    const context = contextOf(resolveTenant(user, [seller1], undefined));
    expect(isTenantContext({ ...context })).toBe(false);
    expect(isTenantContext(user)).toBe(false);
    expect(isTenantContext(null)).toBe(false);
    expect(isTenantContext("ctx")).toBe(false);
  });

  it("por tipo, AuthenticatedUser no es un TenantContext", () => {
    expectTypeOf<AuthenticatedUser>().not.toExtend<TenantContext>();
    expectTypeOf<
      AuthenticatedUser & { organizationId: string; role: "admin" }
    >().not.toExtend<TenantContext>();
  });
});

describe("parseOrganizationId (input del selector)", () => {
  it("acepta un UUID y lo normaliza a minúsculas", () => {
    const hex = "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";
    expect(parseOrganizationId(ORG_1)).toBe(ORG_1);
    expect(parseOrganizationId(hex.toUpperCase())).toBe(hex);
  });

  it.each([
    ["null", null],
    ["un File", new File(["x"], "org.txt")],
    ["vacío", ""],
    ["no UUID", "org-1"],
    ["UUID con espacios", ` ${ORG_1} `],
    ["UUID sin guiones", ORG_1.replaceAll("-", "")],
    ["inyección", `${ORG_1}' OR '1'='1`],
  ])("rechaza %s", (_, raw) => {
    expect(parseOrganizationId(raw)).toBeNull();
  });
});
