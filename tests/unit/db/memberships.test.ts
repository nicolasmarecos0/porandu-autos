import { drizzle } from "drizzle-orm/postgres-js";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { listActiveMemberships } from "@/db/queries/memberships";
import type { AuthenticatedUser } from "@/lib/auth/claims";

/*
 * Forma de la query de memberships propias (H0.7), sin base de datos. RLS ya
 * oculta las memberships de organizaciones sin membership activa; los
 * filtros explícitos por `user_id` y `active` son defensa en profundidad y
 * RLS no alcanza para detectar si faltan, así que se verifican acá sobre el
 * SQL generado. El comportamiento contra PostgreSQL real está en
 * tests/db/tenant-resolution.test.ts.
 */

vi.mock("server-only", () => ({}));

const mocks = vi.hoisted(() => ({
  queries: [] as { sql: string; params: unknown[] }[],
  withUser: vi.fn(),
}));

vi.mock("@/db/tenant", () => ({ withUser: mocks.withUser }));

const USER = "00000000-0000-4000-8000-00000000000c";
const user: AuthenticatedUser = {
  userId: USER,
  claims: { sub: USER, role: "authenticated" },
};

beforeEach(() => {
  mocks.queries.length = 0;
  mocks.withUser.mockReset();
  mocks.withUser.mockImplementation(
    async (
      _ctx: unknown,
      fn: (tx: unknown) => { toSQL(): { sql: string; params: unknown[] } },
    ) => {
      mocks.queries.push(fn(drizzle.mock()).toSQL());
      return [];
    },
  );
});

describe("listActiveMemberships", () => {
  it("corre con withUser() y la identidad verificada", async () => {
    await listActiveMemberships(user);

    expect(mocks.withUser).toHaveBeenCalledTimes(1);
    expect(mocks.withUser.mock.calls[0]?.[0]).toBe(user);
  });

  it("filtra explícitamente por user_id del usuario verificado y active = true", async () => {
    await listActiveMemberships(user);

    const [query] = mocks.queries;
    expect(query?.sql).toContain(
      'where ("memberships"."user_id" = $1 and "memberships"."active" = $2)',
    );
    expect(query?.params).toEqual([USER, true]);
  });

  it("solo selecciona lo necesario para resolver el tenant", async () => {
    await listActiveMemberships(user);

    const [query] = mocks.queries;
    expect(query?.sql).toMatch(
      /^select "memberships"\."organization_id", "organizations"\."name", "memberships"\."role" from "memberships" inner join "organizations"/,
    );
    expect(query?.sql).toContain(
      'order by "organizations"."name" asc, "organizations"."id" asc',
    );
  });
});
