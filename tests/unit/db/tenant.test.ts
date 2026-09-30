import type { SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  TenantContextError,
  withTenant,
  withUser,
  type TenantContext,
  type UserContext,
} from "@/db/tenant";
import type { AuthenticatedUser } from "@/lib/auth/claims";
import { isTenantContext, resolveTenant } from "@/lib/tenant/resolution";

/*
 * withUser()/withTenant() sin base de datos: validación del contexto, que
 * withTenant() solo acepte un TenantContext emitido por Tenant Resolution y
 * forma exacta del statement que fija rol y claims. El comportamiento contra
 * PostgreSQL real está en tests/db/tenant-*.test.ts.
 */

// `server-only` lo resuelve Next; en Vitest (entorno node) es un no-op.
vi.mock("server-only", () => ({}));

const mocks = vi.hoisted(() => {
  const executed: unknown[] = [];
  const tx = {
    execute: async (query: unknown) => {
      executed.push(query);
      return [];
    },
  };
  const transaction = vi.fn(
    async (fn: (transaction: typeof tx) => Promise<unknown>) => fn(tx),
  );
  const getDb = vi.fn(() => ({ transaction }));
  return { executed, tx, transaction, getDb };
});

vi.mock("@/db/client", () => ({ getDb: mocks.getDb }));

const USER = "00000000-0000-4000-8000-00000000000a";
const OTHER = "00000000-0000-4000-8000-00000000000b";
const ORG = "00000000-0000-4000-8000-000000000001";
const OTHER_ORG = "00000000-0000-4000-8000-000000000002";

const user: UserContext = {
  userId: USER,
  claims: { sub: USER, role: "authenticated" },
};

/** TenantContext emitido por Tenant Resolution para `identity` en `ORG`. */
function issued(identity: AuthenticatedUser = user): TenantContext {
  const resolution = resolveTenant(
    identity,
    [{ organizationId: ORG, organizationName: "Org", role: "seller" }],
    undefined,
  );
  if (resolution.kind !== "resolved") throw new Error("unresolved");
  return resolution.context;
}

const tenant = issued();

function rendered(query: unknown) {
  return new PgDialect().sqlToQuery(query as SQL);
}

beforeEach(() => {
  mocks.executed.length = 0;
  mocks.transaction.mockClear();
  mocks.getDb.mockClear();
});

describe("withTenant / withUser", () => {
  it.each([
    ["withTenant", () => withTenant(tenant, async (tx) => tx)],
    ["withUser", () => withUser(user, async (tx) => tx)],
  ])(
    "%s abre una transacción y ejecuta fn con la transacción",
    async (_, run) => {
      await expect(run()).resolves.toBe(mocks.tx);
      expect(mocks.transaction).toHaveBeenCalledTimes(1);
    },
  );

  it("el primer statement fija claims y rol con alcance de transacción, en uno solo", async () => {
    await withTenant(tenant, async () => undefined);

    expect(mocks.executed).toHaveLength(1);
    expect(rendered(mocks.executed[0])).toMatchObject({
      sql: "SELECT set_config('request.jwt.claims', $1, true), set_config('role', 'authenticated', true)",
      params: [JSON.stringify(tenant.claims)],
    });
  });

  it("los claims viajan como parámetro, nunca interpolados (A-13)", async () => {
    const hostile = "'); SELECT set_config('role', 'postgres', false); --";
    await withUser(
      { userId: USER, claims: { sub: USER, role: "authenticated", hostile } },
      async () => undefined,
    );

    const { sql, params } = rendered(mocks.executed[0]);
    expect(sql).not.toContain(hostile);
    expect(sql).not.toMatch(/false\)/);
    expect(JSON.parse(params[0] as string)).toMatchObject({ hostile });
  });

  it("propaga el resultado y los errores de fn", async () => {
    await expect(withTenant(tenant, async () => 42)).resolves.toBe(42);
    await expect(
      withTenant(tenant, async () => {
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");
  });

  const invalid: [string, unknown][] = [
    ["sin contexto", null],
    ["userId que no es UUID", { ...tenant, userId: "user-a" }],
    ["sin claims", { userId: USER, organizationId: ORG }],
    [
      "claims.sub de otro usuario",
      { ...tenant, claims: { sub: OTHER, role: "authenticated" } },
    ],
    [
      "claims.role distinto de authenticated",
      { ...tenant, claims: { sub: USER, role: "service_role" } },
    ],
    ["sin organizationId", user],
    ["organizationId que no es UUID", { ...tenant, organizationId: "org" }],
  ];

  it.each(invalid)(
    "withTenant rechaza un contexto %s sin tocar la base",
    async (_, ctx) => {
      await expect(
        withTenant(ctx as TenantContext, async () => undefined),
      ).rejects.toBeInstanceOf(TenantContextError);
      expect(mocks.getDb).not.toHaveBeenCalled();
    },
  );

  it.each(invalid.slice(0, 5))(
    "withUser rechaza un contexto %s sin tocar la base",
    async (_, ctx) => {
      await expect(
        withUser(ctx as UserContext, async () => undefined),
      ).rejects.toBeInstanceOf(TenantContextError);
      expect(mocks.getDb).not.toHaveBeenCalled();
    },
  );
});

describe("withTenant solo acepta un TenantContext de Tenant Resolution", () => {
  it("un contexto emitido por resolveTenant() pasa", async () => {
    expect(isTenantContext(tenant)).toBe(true);
    await expect(withTenant(tenant, async () => "ok")).resolves.toBe("ok");
  });

  it("un objeto plano con la forma correcta no es un TenantContext (tipo y runtime)", async () => {
    const plain = {
      userId: USER,
      claims: { sub: USER, role: "authenticated" as const },
      organizationId: ORG,
      role: "admin" as const,
    };
    // @ts-expect-error: un objeto literal no tiene la marca de Tenant Resolution.
    const forged: TenantContext = plain;

    await expect(withTenant(forged, async () => "ok")).rejects.toThrow(
      "not issued by Tenant Resolution",
    );
    expect(mocks.getDb).not.toHaveBeenCalled();
  });

  it("un AuthenticatedUser no alcanza para una operación tenant-scoped", async () => {
    const authenticated: AuthenticatedUser = user;
    const withOrganization = { ...authenticated, organizationId: ORG };

    // @ts-expect-error: AuthenticatedUser no tiene organización ni marca.
    const fromUser: TenantContext = authenticated;
    // @ts-expect-error: agregarle una organización tampoco lo convierte.
    const fromUserWithOrganization: TenantContext = withOrganization;

    for (const ctx of [fromUser, fromUserWithOrganization]) {
      await expect(withTenant(ctx, async () => "ok")).rejects.toThrow(
        TenantContextError,
      );
    }
    expect(mocks.getDb).not.toHaveBeenCalled();
  });

  it("forzar el tipo con `as` no engaña al runtime", async () => {
    const cast = {
      userId: USER,
      claims: { sub: USER, role: "authenticated" },
      organizationId: ORG,
      role: "admin",
    } as unknown as TenantContext;

    await expect(withTenant(cast, async () => "ok")).rejects.toThrow(
      TenantContextError,
    );
    expect(mocks.getDb).not.toHaveBeenCalled();
  });

  it("una copia de un contexto válido con otra organización se rechaza", async () => {
    const copy = { ...tenant, organizationId: OTHER_ORG };

    await expect(withTenant(copy, async () => "ok")).rejects.toThrow(
      "not issued by Tenant Resolution",
    );
    expect(mocks.getDb).not.toHaveBeenCalled();
  });

  it("un contexto emitido es inmutable", () => {
    expect(Object.isFrozen(tenant)).toBe(true);
    expect(Object.isFrozen(tenant.claims)).toBe(true);
    expect(() => {
      (tenant as { organizationId: string }).organizationId = OTHER_ORG;
    }).toThrow(TypeError);
    expect(tenant.organizationId).toBe(ORG);
  });

  it.each<[string, AuthenticatedUser]>([
    [
      "userId que no es UUID",
      { userId: "user-a", claims: { sub: "user-a", role: "authenticated" } },
    ],
    [
      "claims.sub de otro usuario",
      { userId: USER, claims: { sub: OTHER, role: "authenticated" } },
    ],
    [
      "claims.role distinto de authenticated",
      {
        userId: USER,
        claims: { sub: USER, role: "service_role" as "authenticated" },
      },
    ],
  ])(
    "aun emitido, un contexto con identidad inválida (%s) falla cerrado",
    async (_, identity) => {
      await expect(
        withTenant(issued(identity), async () => undefined),
      ).rejects.toBeInstanceOf(TenantContextError);
      expect(mocks.getDb).not.toHaveBeenCalled();
    },
  );
});
