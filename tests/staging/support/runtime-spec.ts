import { randomUUID } from "node:crypto";

import { eq, sql } from "drizzle-orm";
import postgres, { type Sql } from "postgres";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { memberships, organizations, profiles } from "@/db/schema";
import {
  withTenant,
  withUser,
  type ScopedTransaction,
  type UserContext,
} from "@/db/tenant";
import { resolveTenant } from "@/lib/tenant/resolution";

import { closeRuntimePool, runtimePool } from "../../db/support/runtime";

/*
 * Acceptance del runtime oficial (ADR-001 §2, §3.1, §3.2 y §7.2): la
 * aplicación como app_runtime, por db/client.ts y db/tenant.ts, sin ningún
 * dato de la aplicación. Corre contra staging por Supavisor en modo
 * transacción (tests/staging/runtime.test.ts) y contra el PostgreSQL 17
 * desechable (tests/db/staging-acceptance.test.ts), que mantiene validado
 * este mismo spec en CI.
 *
 * Solo controles que no dejan estado: todo intento de cambiar rol o claims
 * es local a una transacción (`set_config(..., true)`) y termina en
 * ROLLBACK. Nunca SET de sesión ni `set_config(..., false)` contra staging
 * (ADR-001 Hallazgo 2).
 */

export type RuntimeAcceptanceOptions = Readonly<{
  /** URL de app_runtime; se resuelve en el beforeAll del spec. */
  runtimeUrl: () => Promise<string> | string;
  /** Transacciones secuenciales del chequeo de residuos. */
  iterations: number;
}>;

type SessionState = {
  pid: number;
  currentUser: string;
  sessionUser: string;
  role: string;
  claims: string;
};

const CLEAN = {
  currentUser: "app_runtime",
  sessionUser: "app_runtime",
  role: "none",
  claims: "",
};

/** Roles que app_runtime nunca puede asumir (los que existan en la base). */
const FORBIDDEN_ROLES = [
  "postgres",
  "service_role",
  "anon",
  "authenticator",
  "supabase_admin",
  "supabase_auth_admin",
  "supabase_storage_admin",
  "dashboard_user",
  "pg_read_all_data",
  "pg_write_all_data",
  "pg_execute_server_program",
  "pg_signal_backend",
];

async function sessionState(conn: Sql): Promise<SessionState> {
  const [state] = await conn<SessionState[]>`
    SELECT pg_backend_pid() AS pid, current_user AS "currentUser",
      session_user AS "sessionUser", current_setting('role') AS role,
      coalesce(current_setting('request.jwt.claims', true), '') AS claims
  `;
  if (!state) throw new Error("no session state");
  return state;
}

function withoutPid(state: SessionState): Omit<SessionState, "pid"> {
  const { currentUser, sessionUser, role, claims } = state;
  return { currentUser, sessionUser, role, claims };
}

type Identity = {
  currentUser: string;
  sessionUser: string;
  uid: string | null;
  organizations: number;
  memberships: number;
  profiles: number;
};

async function identity(tx: ScopedTransaction): Promise<Identity> {
  const [row] = await tx.execute<
    Pick<Identity, "currentUser" | "sessionUser" | "uid">
  >(sql`
    SELECT current_user AS "currentUser", session_user AS "sessionUser",
      auth.uid() AS uid
  `);
  if (!row) throw new Error("no identity");
  return {
    ...row,
    organizations: (await tx.select().from(organizations)).length,
    memberships: (await tx.select().from(memberships)).length,
    profiles: (await tx.select().from(profiles)).length,
  };
}

/** Un usuario autenticado sin memberships: el runtime no ve nada. */
function syntheticUser(): UserContext {
  const userId = randomUUID();
  return { userId, claims: { sub: userId, role: "authenticated" } };
}

export function describeRuntimeAcceptance(
  options: RuntimeAcceptanceOptions,
): void {
  describe("runtime oficial: app_runtime", () => {
    /** Conexión propia como app_runtime, fuera del boundary. */
    let raw: Sql;
    let forbidden: string[] = [];

    beforeAll(async () => {
      const url = await options.runtimeUrl();
      vi.stubEnv("RUNTIME_DATABASE_URL", url);
      raw = postgres(url, { max: 1, prepare: false, onnotice: () => {} });
      const existing = await raw<{ name: string }[]>`
        SELECT rolname AS name FROM pg_roles
        WHERE rolname = ANY(${FORBIDDEN_ROLES}::text[])
      `;
      forbidden = existing.map((r) => r.name).sort();
    });

    afterAll(async () => {
      await raw?.end({ timeout: 5 });
      await closeRuntimePool();
      vi.unstubAllEnvs();
    });

    it("se conecta como app_runtime, que no es superuser ni ignora RLS", async () => {
      const [row] = await raw`
        SELECT current_user AS "currentUser", session_user AS "sessionUser",
          r.rolsuper AS super, r.rolbypassrls AS "bypassRls",
          r.rolinherit AS inherit,
          current_setting('server_version_num')::int / 10000 AS major
        FROM pg_roles r WHERE r.rolname = current_user
      `;
      expect(row).toEqual({
        currentUser: "app_runtime",
        sessionUser: "app_runtime",
        super: false,
        bypassRls: false,
        inherit: false,
        major: 17,
      });
    });

    it("sin contexto falla cerrado (42501) en las tablas y en private", async () => {
      for (const table of ["organizations", "profiles", "memberships"]) {
        await expect(
          raw.unsafe(`SELECT 1 FROM public.${table} LIMIT 1`),
        ).rejects.toMatchObject({ code: "42501" });
      }
      await expect(raw`SELECT private.user_org_ids()`).rejects.toMatchObject({
        code: "42501",
      });
      expect(withoutPid(await sessionState(raw))).toEqual(CLEAN);
    });

    it("los claims solos, sin asumir authenticated, no dan acceso", async () => {
      const { claims } = syntheticUser();
      await expect(
        raw.begin(async (tx) => {
          await tx`SELECT set_config('request.jwt.claims', ${JSON.stringify(claims)}, true)`;
          await tx`SELECT 1 FROM public.organizations LIMIT 1`;
        }),
      ).rejects.toMatchObject({ code: "42501" });
      expect(withoutPid(await sessionState(raw))).toEqual(CLEAN);
    });

    it("withUser(): rol authenticated y claims solo dentro de la transacción", async () => {
      const ctx = syntheticUser();
      const seen = await withUser(ctx, identity);
      expect(seen).toEqual({
        currentUser: "authenticated",
        sessionUser: "app_runtime",
        uid: ctx.userId,
        organizations: 0,
        memberships: 0,
        profiles: 0,
      });
      expect(withoutPid(await sessionState(runtimePool()))).toEqual(CLEAN);
    });

    it("un contexto de una organización sin membership no ve nada (RLS)", async () => {
      const user = syntheticUser();
      const organizationId = randomUUID();
      const resolution = resolveTenant(
        user,
        [{ organizationId, organizationName: "Sintética", role: "admin" }],
        undefined,
      );
      if (resolution.kind !== "resolved") throw new Error("unresolved");
      const rows = await withTenant(resolution.context, (tx) =>
        tx
          .select()
          .from(organizations)
          .where(eq(organizations.id, organizationId)),
      );
      expect(rows).toEqual([]);
    });

    /** `null` = la transacción hace COMMIT. */
    type Expected = { code: string } | { message: string } | null;
    const outcomes: [
      string,
      (tx: ScopedTransaction) => Promise<unknown>,
      Expected,
    ][] = [
      ["COMMIT", async () => "ok", null],
      [
        "excepción de la aplicación (ROLLBACK)",
        async () => {
          throw new Error("boom");
        },
        { message: "boom" },
      ],
      [
        "error de SQL",
        (tx) => tx.execute(sql`SELECT 1 / 0`),
        { code: "22012" },
      ],
      [
        "escritura denegada",
        (tx) => tx.insert(organizations).values({ name: "Intrusa" }),
        { code: "42501" },
      ],
      [
        "intento de asumir postgres",
        (tx) => tx.execute(sql`SELECT set_config('role', 'postgres', true)`),
        { code: "42501" },
      ],
    ];

    it.each(outcomes)(
      "contexto limpio después de: %s",
      async (_, fn, expected) => {
        const ctx = syntheticUser();
        let inside: Identity | undefined;
        const result = withUser(ctx, async (tx) => {
          inside = await identity(tx);
          return fn(tx);
        });
        if (expected === null) {
          await expect(result).resolves.toBe("ok");
        } else if ("message" in expected) {
          await expect(result).rejects.toThrow(expected.message);
        } else {
          await expect(result).rejects.toMatchObject({ cause: expected });
        }
        expect(inside?.uid).toBe(ctx.userId);
        expect(withoutPid(await sessionState(runtimePool()))).toEqual(CLEAN);
      },
    );

    it("transacciones secuenciales y concurrentes: ningún residuo de rol ni claims", async () => {
      const pool = runtimePool();
      const users = [syntheticUser(), syntheticUser(), syntheticUser()];
      let residues = 0;
      for (let i = 0; i < options.iterations; i++) {
        const ctx = users[i % users.length]!;
        const kind = i % 3;
        const run = withUser(ctx, async (tx) => {
          const seen = await identity(tx);
          expect(seen.uid).toBe(ctx.userId);
          if (kind === 1) throw new Error("rollback");
          if (kind === 2) await tx.execute(sql`SELECT 1 / 0`);
          return seen;
        });
        if (kind === 0) await run;
        else await expect(run).rejects.toBeDefined();
        const after = withoutPid(await sessionState(pool));
        if (JSON.stringify(after) !== JSON.stringify(CLEAN)) residues++;
      }
      expect(residues).toBe(0);

      const seen = await Promise.all(
        Array.from({ length: 6 }, (_, i) => {
          const ctx = users[i % users.length]!;
          return withUser(ctx, identity).then((id) => ({ id, ctx }));
        }),
      );
      for (const { id, ctx } of seen) {
        expect(id.uid).toBe(ctx.userId);
        expect(id.currentUser).toBe("authenticated");
      }
      expect(withoutPid(await sessionState(pool))).toEqual(CLEAN);
    });

    it("no puede asumir postgres, service_role, anon ni roles administrativos", async () => {
      expect(forbidden).toEqual(
        expect.arrayContaining(["anon", "postgres", "service_role"]),
      );
      for (const role of forbidden) {
        await expect(
          raw.begin((tx) => tx`SELECT set_config('role', ${role}, true)`),
        ).rejects.toMatchObject({ code: "42501" });
        await expect(
          raw.begin(async (tx) => {
            await tx`SELECT set_config('role', 'authenticated', true)`;
            await tx`SELECT set_config('role', ${role}, true)`;
          }),
        ).rejects.toMatchObject({ code: "42501" });
      }
      expect(withoutPid(await sessionState(raw))).toEqual(CLEAN);
    });
  });
}
