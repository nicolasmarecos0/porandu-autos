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

/*
 * withUser()/withTenant() sin base de datos: validación del contexto y
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

const user: UserContext = {
  userId: USER,
  claims: { sub: USER, role: "authenticated" },
};
const tenant: TenantContext = { ...user, organizationId: ORG };

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
