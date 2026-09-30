import { randomUUID } from "node:crypto";

import { and, eq, sql } from "drizzle-orm";
import type { TransactionSql } from "postgres";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { memberships, organizations, profiles } from "@/db/schema";
import {
  TenantContextError,
  withTenant,
  withUser,
  type ScopedTransaction,
  type TenantContext,
  type UserContext,
} from "@/db/tenant";

import {
  runMigrations,
  startTestServer,
  type TestDatabase,
  type TestServer,
} from "./support/postgres";
import { closeRuntimePool, runtimePool } from "./support/runtime";
import {
  activeOrganizations,
  MEMBERSHIPS,
  ORG_1,
  ORG_2,
  ORG_3,
  seedTenants,
  tenantContext,
  USER_A,
  USER_B,
  USER_C,
  USER_D,
  userContext,
  USERS,
} from "./support/tenants";

// `server-only` lo resuelve Next; en Vitest (entorno node) es un no-op.
vi.mock("server-only", () => ({}));

/*
 * Aislamiento multi-tenant a través del boundary real (withUser/withTenant,
 * db/tenant.ts) conectado como app_runtime a PostgreSQL 17, con las
 * migraciones aplicadas. Criterios C1 y C2 de ADR-001.
 */

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

type Visible = {
  organizations: string[];
  memberships: string[];
  profiles: string[];
};

/** Todo lo que el usuario de la transacción ve, sin filtros explícitos. */
async function visible(tx: ScopedTransaction): Promise<Visible> {
  const orgs = await tx
    .select({ id: organizations.id })
    .from(organizations)
    .orderBy(organizations.id);
  const members = await tx
    .select({
      organizationId: memberships.organizationId,
      userId: memberships.userId,
    })
    .from(memberships)
    .orderBy(memberships.organizationId, memberships.userId);
  const profileRows = await tx
    .select({ id: profiles.id })
    .from(profiles)
    .orderBy(profiles.id);
  return {
    organizations: orgs.map((o) => o.id),
    memberships: members.map((m) => `${m.organizationId}/${m.userId}`),
    profiles: profileRows.map((p) => p.id),
  };
}

/** Lo que RLS debe dejar ver: organizaciones activas y el perfil propio. */
function expectedVisible(userId: string): Visible {
  const orgs = activeOrganizations(userId);
  return {
    organizations: orgs,
    memberships: MEMBERSHIPS.filter((m) => orgs.includes(m.organizationId))
      .map((m) => `${m.organizationId}/${m.userId}`)
      .sort(),
    profiles: [userId],
  };
}

/*
 * Forma de un loader tenant-scoped: filtro explícito por la organización
 * del contexto (defense in depth) sobre RLS.
 */
async function tenantData(ctx: TenantContext) {
  return withTenant(ctx, async (tx) => ({
    organizations: (
      await tx
        .select({ id: organizations.id })
        .from(organizations)
        .where(eq(organizations.id, ctx.organizationId))
    ).map((o) => o.id),
    memberships: (
      await tx
        .select({ userId: memberships.userId })
        .from(memberships)
        .where(eq(memberships.organizationId, ctx.organizationId))
        .orderBy(memberships.userId)
    ).map((m) => m.userId),
  }));
}

async function userOrgIds(ctx: UserContext): Promise<string[]> {
  const rows = await withUser(ctx, (tx) =>
    tx.execute<{ id: string }>(
      sql`SELECT private.user_org_ids() AS id ORDER BY 1`,
    ),
  );
  return rows.map((r) => r.id);
}

async function expectSqlError(
  promise: Promise<unknown>,
  code: string,
): Promise<void> {
  // Drizzle envuelve el error del driver: el SQLSTATE queda en `cause`.
  await expect(promise).rejects.toMatchObject({ cause: { code } });
}

describe("aislamiento entre tenants (C1)", () => {
  it("A (ORG_1) no lee nada de B (ORG_2)", async () => {
    await withTenant(tenantContext(USER_A, ORG_1), async (tx) => {
      expect(await visible(tx)).toEqual(expectedVisible(USER_A));
      expect(
        await tx
          .select()
          .from(organizations)
          .where(eq(organizations.id, ORG_2)),
      ).toEqual([]);
      expect(
        await tx
          .select()
          .from(memberships)
          .where(eq(memberships.organizationId, ORG_2)),
      ).toEqual([]);
      expect(
        await tx.select().from(profiles).where(eq(profiles.id, USER_B)),
      ).toEqual([]);
    });
  });

  it("B (ORG_2) no lee nada de A (ORG_1)", async () => {
    await withTenant(tenantContext(USER_B, ORG_2), async (tx) => {
      expect(await visible(tx)).toEqual(expectedVisible(USER_B));
      expect(
        await tx
          .select()
          .from(organizations)
          .where(eq(organizations.id, ORG_1)),
      ).toEqual([]);
      expect(
        await tx
          .select()
          .from(memberships)
          .where(eq(memberships.organizationId, ORG_1)),
      ).toEqual([]);
      expect(
        await tx.select().from(profiles).where(eq(profiles.id, USER_A)),
      ).toEqual([]);
    });
  });

  it.each(USERS)(
    "%s ve exactamente sus organizaciones activas, sus memberships y su perfil",
    async (userId) => {
      expect(await withUser(userContext(userId), visible)).toEqual(
        expectedVisible(userId),
      );
    },
  );

  it("con el filtro explícito, cada tenant ve solo su organización", async () => {
    expect(await tenantData(tenantContext(USER_A, ORG_1))).toEqual({
      organizations: [ORG_1],
      memberships: [USER_A, USER_C, USER_D],
    });
    expect(await tenantData(tenantContext(USER_B, ORG_2))).toEqual({
      organizations: [ORG_2],
      memberships: [USER_B, USER_C],
    });
  });

  it("un contexto falsificado (A con ORG_2) no ve datos de ORG_2 (A-03)", async () => {
    const forged = tenantContext(USER_A, ORG_2);
    expect(await tenantData(forged)).toEqual({
      organizations: [],
      memberships: [],
    });
    // RLS sigue limitando a las organizaciones reales de A.
    expect(await withTenant(forged, visible)).toEqual(expectedVisible(USER_A));
  });

  it("nadie escribe: sin grants ni policies de escritura (42501)", async () => {
    const ctx = tenantContext(USER_A, ORG_1);
    await expectSqlError(
      withTenant(ctx, (tx) =>
        tx
          .insert(memberships)
          .values({ organizationId: ORG_2, userId: USER_A, role: "admin" }),
      ),
      "42501",
    );
    await expectSqlError(
      withTenant(ctx, (tx) =>
        tx.insert(organizations).values({ name: "Intrusa" }),
      ),
      "42501",
    );
    await expectSqlError(
      withTenant(ctx, (tx) =>
        tx
          .update(organizations)
          .set({ name: "Renombrada" })
          .where(eq(organizations.id, ORG_1)),
      ),
      "42501",
    );
    await expectSqlError(
      withTenant(ctx, (tx) =>
        tx
          .update(profiles)
          .set({ fullName: "Otro" })
          .where(eq(profiles.id, USER_A)),
      ),
      "42501",
    );
    await expectSqlError(
      withTenant(ctx, (tx) =>
        tx.delete(memberships).where(eq(memberships.organizationId, ORG_1)),
      ),
      "42501",
    );
  });
});

describe("mismo usuario con varias memberships", () => {
  it("C opera ORG_1 y ORG_3 por separado", async () => {
    expect(await tenantData(tenantContext(USER_C, ORG_1))).toEqual({
      organizations: [ORG_1],
      memberships: [USER_A, USER_C, USER_D],
    });
    expect(await tenantData(tenantContext(USER_C, ORG_3))).toEqual({
      organizations: [ORG_3],
      memberships: [USER_C],
    });
  });

  it("RLS le deja ver ORG_1 y ORG_3, nunca ORG_2 (membership inactiva)", async () => {
    const seen = await withTenant(tenantContext(USER_C, ORG_1), visible);
    expect(seen).toEqual(expectedVisible(USER_C));
    expect(seen.organizations).toEqual([ORG_1, ORG_3]);
  });

  it("withUser lee sus memberships activas filtrando por su user_id", async () => {
    const ctx = userContext(USER_C);
    const rows = await withUser(ctx, (tx) =>
      tx
        .select({
          organizationId: memberships.organizationId,
          role: memberships.role,
        })
        .from(memberships)
        .where(
          and(eq(memberships.userId, ctx.userId), eq(memberships.active, true)),
        )
        .orderBy(memberships.organizationId),
    );
    expect(rows).toEqual([
      { organizationId: ORG_1, role: "seller" },
      { organizationId: ORG_3, role: "admin" },
    ]);
  });
});

describe("membership active = false corta el acceso", () => {
  it("D, con solo una membership inactiva, no ve ninguna organización", async () => {
    expect(await tenantData(tenantContext(USER_D, ORG_1))).toEqual({
      organizations: [],
      memberships: [],
    });
    expect(await withUser(userContext(USER_D), visible)).toEqual({
      organizations: [],
      memberships: [],
      profiles: [USER_D],
    });
  });

  it("la membership inactiva de C en ORG_2 no le da acceso a ORG_2", async () => {
    expect(await tenantData(tenantContext(USER_C, ORG_2))).toEqual({
      organizations: [],
      memberships: [],
    });
  });

  it("revocar tiene efecto inmediato, aun con un contexto viejo (A-09)", async () => {
    const ctx = tenantContext(USER_A, ORG_1);
    expect((await tenantData(ctx)).organizations).toEqual([ORG_1]);

    await db.admin`
      UPDATE public.memberships SET active = false
      WHERE organization_id = ${ORG_1} AND user_id = ${USER_A}
    `;
    try {
      expect(await tenantData(ctx)).toEqual({
        organizations: [],
        memberships: [],
      });
    } finally {
      await db.admin`
        UPDATE public.memberships SET active = true
        WHERE organization_id = ${ORG_1} AND user_id = ${USER_A}
      `;
    }
    expect((await tenantData(ctx)).organizations).toEqual([ORG_1]);
  });
});

describe("private.user_org_ids()", () => {
  it.each(USERS)(
    "para %s devuelve solo sus organizaciones con membership activa",
    async (userId) => {
      expect(await userOrgIds(userContext(userId))).toEqual(
        activeOrganizations(userId),
      );
    },
  );

  it("con un usuario sin perfil ni memberships devuelve vacío", async () => {
    expect(await userOrgIds(userContext(randomUUID()))).toEqual([]);
  });

  it("sin claims devuelve vacío y authenticated no ve filas", async () => {
    await runtimePool().begin(async (tx) => {
      await tx`SELECT set_config('role', 'authenticated', true)`;
      expect(await tx`SELECT private.user_org_ids()`).toHaveLength(0);
      for (const table of ["organizations", "memberships", "profiles"]) {
        expect(await tx`SELECT * FROM ${tx(`public.${table}`)}`).toHaveLength(
          0,
        );
      }
    });
  });

  it("se evalúa una vez por statement, no una vez por fila (S-04)", async () => {
    const calls = await db.admin.begin(async (tx: TransactionSql) => {
      await tx`SET LOCAL track_functions = 'all'`;
      await tx`
        SELECT
          set_config('request.jwt.claims', ${JSON.stringify(userContext(USER_C).claims)}, true),
          set_config('role', 'authenticated', true)
      `;
      const rows = await tx`SELECT id FROM public.memberships`;
      expect(rows.length).toBeGreaterThan(1);
      await tx`RESET ROLE`;
      const [stats] = await tx<{ calls: number }[]>`
        SELECT calls::int FROM pg_stat_xact_user_functions
        WHERE schemaname = 'private' AND funcname = 'user_org_ids'
      `;
      return stats?.calls;
    });
    expect(calls).toBe(1);
  });
});

describe("sin withTenant o sin contexto válido, falla cerrado (C2)", () => {
  it("app_runtime fuera del boundary no lee ni escribe ninguna tabla (42501)", async () => {
    const pool = runtimePool();
    for (const table of ["organizations", "memberships", "profiles"]) {
      await expect(
        pool`SELECT * FROM ${pool(`public.${table}`)}`,
      ).rejects.toMatchObject({ code: "42501" });
    }
    await expect(
      pool`INSERT INTO public.organizations (name) VALUES ('Intrusa')`,
    ).rejects.toMatchObject({ code: "42501" });
    await expect(pool`SELECT private.user_org_ids()`).rejects.toMatchObject({
      code: "42501",
    });
  });

  it("RESET ROLE dentro del boundary vuelve a app_runtime, que no lee nada", async () => {
    await expectSqlError(
      withTenant(tenantContext(USER_A, ORG_1), async (tx) => {
        await tx.execute(sql`RESET ROLE`);
        return tx.select().from(organizations);
      }),
      "42501",
    );
  });

  const valid = tenantContext(USER_A, ORG_1);
  const invalid: [string, unknown][] = [
    ["sin contexto", undefined],
    [
      "userId que no es UUID",
      { ...valid, userId: "a", claims: { sub: "a", role: "authenticated" } },
    ],
    ["sin claims", { userId: USER_A, organizationId: ORG_1 }],
    [
      "claims.sub de otro usuario",
      { ...valid, claims: { sub: USER_B, role: "authenticated" } },
    ],
    [
      "claims.role distinto de authenticated",
      { ...valid, claims: { sub: USER_A, role: "service_role" } },
    ],
    ["sin organizationId", userContext(USER_A)],
    ["organizationId que no es UUID", { ...valid, organizationId: "ORG_1" }],
  ];

  it.each(invalid)("withTenant rechaza un contexto %s", async (_, ctx) => {
    await expect(
      withTenant(ctx as TenantContext, visible),
    ).rejects.toBeInstanceOf(TenantContextError);
  });

  it.each(invalid.slice(0, 5))(
    "withUser rechaza un contexto %s",
    async (_, ctx) => {
      await expect(
        withUser(ctx as UserContext, visible),
      ).rejects.toBeInstanceOf(TenantContextError);
    },
  );
});
