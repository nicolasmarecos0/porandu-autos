import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { sql as dsql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import type { VerifiedClaims } from "../src/claims";
import { tenantProbe } from "../src/probe-schema";
import { createRuntimeDb } from "../src/runtime";
import { withTenant, type TenantContext } from "../src/tenant";
import { resolveTenant } from "../src/tenant-context";
import { verifiedClaimsFor } from "./support/claims";
import { runtimeConnections } from "./support/connections";
import { connectionIdentity, openSql } from "./support/db";
import { env, isLoopbackUrl } from "./support/env";
import type { UserKey } from "./support/fixtures";

/*
 * C4 + C6 · los claims y el rol NO sobreviven a la transacción.
 *
 *   S-50  conexión reservada: después de COMMIT, ROLLBACK y error, la misma
 *         conexión vuelve a ser app_runtime sin claims.
 *   P3    carga concurrente A/B/uAB con MÁS clientes que backends (el pooler
 *         local tiene default_pool_size = 5): se prueba que los backends se
 *         reutilizan entre usuarios distintos y que nunca queda residuo.
 *   Control negativo (SOLO local): la variante incorrecta de sesión
 *         (set_config(..., false)) sí contamina, y el detector lo ve.
 *         Nunca se ejecuta contra un host que no sea loopback (E2/staging).
 */

const fixtures = inject("fixtures");
const { orgs, users } = fixtures;
const claims = {} as Record<UserKey, VerifiedClaims>;

beforeAll(async () => {
  for (const key of ["uA", "uB", "uAB"] as const) {
    claims[key] = await verifiedClaimsFor(users[key]);
  }
});

const TOTAL_TRANSACTIONS = 600;

describe("S-50 · alcance de la transacción en una conexión reservada", () => {
  const sql = openSql(env.runtimeUrl, "s50", 1);
  afterAll(() => sql.end({ timeout: 5 }));

  it.each(["commit", "rollback", "error"] as const)(
    "después de %s: current_user = app_runtime y claims vacíos",
    async (outcome) => {
      const conn = await sql.reserve();
      try {
        await conn.unsafe("begin");
        await conn.unsafe("set local role authenticated");
        await conn`select set_config('request.jwt.claims', ${JSON.stringify(claims.uA)}, true)`;
        const [inside] = await conn<
          { cu: string }[]
        >`select current_user as cu`;
        expect(inside?.cu).toBe("authenticated");
        if (outcome === "error") {
          await conn`select 1 / 0`.catch(() => undefined);
          await conn.unsafe("rollback");
        } else {
          await conn.unsafe(outcome);
        }
        const [after] = await conn<{ cu: string; claims: string }[]>`
          select current_user as cu, coalesce(current_setting('request.jwt.claims', true), '') as claims`;
        expect(after).toEqual({ cu: "app_runtime", claims: "" });
      } finally {
        conn.release();
      }
    },
  );
});

describe.each(runtimeConnections)(
  "P3 · carga concurrente sin residuos (conexión $name)",
  ({ name, url }) => {
    const max = name === "pooler" ? 20 : 8;
    const runtime = createRuntimeDb(url, { label: `leak-${name}`, max });
    afterAll(() => runtime.close());

    it(`${TOTAL_TRANSACTIONS} transacciones A/B/uAB con commit, rollback y error: sin contaminación`, async () => {
      const contexts: TenantContext[] = [];
      for (const [user, org] of [
        ["uA", orgs.A],
        ["uB", orgs.B],
        ["uAB", orgs.A],
        ["uAB", orgs.B],
      ] as const) {
        const resolution = await resolveTenant(runtime, claims[user], org);
        if (resolution.kind !== "ok") throw new Error("contexto inválido");
        contexts.push(resolution.ctx);
      }
      const allowed = new Map<string, Set<string>>([
        [users.uA.id, new Set([orgs.A])],
        [users.uB.id, new Set([orgs.B])],
        [users.uAB.id, new Set([orgs.A, orgs.B])],
      ]);

      const insideMismatches: string[] = [];
      const residues: string[] = [];
      const pidUsers = new Map<number, Set<string>>();
      const outcomes = { commit: 0, rollback: 0, error: 0 };

      let next = 0;
      async function worker(): Promise<void> {
        while (next < TOTAL_TRANSACTIONS) {
          const i = next;
          next += 1;
          const ctx = contexts[i % contexts.length];
          if (!ctx) throw new Error("ctx");
          const mode =
            i % 10 === 7 ? "rollback" : i % 10 === 8 ? "error" : "commit";
          try {
            await withTenant(runtime, ctx, async (tx) => {
              const identity = await tx.execute<{
                sub: string | null;
                cu: string;
                pid: number;
              }>(
                dsql`select nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub' as sub,
                          current_user as cu, pg_backend_pid() as pid`,
              );
              const row = identity[0];
              if (
                !row ||
                row.sub !== ctx.userId ||
                row.cu !== "authenticated"
              ) {
                insideMismatches.push(
                  `#${i} esperado ${ctx.userId} → ${JSON.stringify(row)}`,
                );
              }
              if (row) {
                const seen = pidUsers.get(row.pid) ?? new Set<string>();
                seen.add(ctx.userId);
                pidUsers.set(row.pid, seen);
              }
              const rows = await tx
                .select({ org: tenantProbe.organizationId })
                .from(tenantProbe);
              const permitted = allowed.get(ctx.userId) ?? new Set<string>();
              for (const r of rows) {
                if (!permitted.has(r.org))
                  insideMismatches.push(`#${i} vio org ajena ${r.org}`);
              }
              if (mode === "rollback") throw new Error("forced-rollback");
              if (mode === "error") await tx.execute(dsql`select 1 / 0`);
            });
            outcomes.commit += 1;
          } catch (error) {
            if (mode === "commit") throw error;
            outcomes[mode] += 1;
          }
          const after = await connectionIdentity(runtime.sql);
          if (after.currentUser !== "app_runtime" || after.claims !== "") {
            residues.push(`#${i} (${mode}) → ${JSON.stringify(after)}`);
          }
        }
      }
      await Promise.all(Array.from({ length: max }, () => worker()));

      const sharedAcrossUsers = [...pidUsers.values()].filter(
        (set) => set.size > 1,
      ).length;
      const report = {
        connection: name,
        clientPoolMax: max,
        transactions: TOTAL_TRANSACTIONS,
        outcomes,
        distinctBackends: pidUsers.size,
        backendsSharedAcrossUsers: sharedAcrossUsers,
        insideMismatches: insideMismatches.length,
        residues: residues.length,
      };
      await mkdir(env.resultsDir, { recursive: true });
      await writeFile(
        join(env.resultsDir, `leak-${name}.json`),
        `${JSON.stringify(report, null, 2)}\n`,
      );
      console.info(`[P3 ${name}]`, JSON.stringify(report));

      expect(insideMismatches, insideMismatches.slice(0, 5).join("\n")).toEqual(
        [],
      );
      expect(residues, residues.slice(0, 5).join("\n")).toEqual([]);
      expect(outcomes.commit + outcomes.rollback + outcomes.error).toBe(
        TOTAL_TRANSACTIONS,
      );
      expect(outcomes.rollback).toBeGreaterThan(0);
      expect(outcomes.error).toBeGreaterThan(0);
      // Reutilización real: muchos menos backends que transacciones, y backends
      // que atendieron a usuarios distintos.
      expect(pidUsers.size).toBeLessThan(TOTAL_TRANSACTIONS / 10);
      expect(sharedAcrossUsers).toBeGreaterThan(0);
    });
  },
);

const contaminationAllowed =
  (env.target === "e0" || env.target === "e1") && isLoopbackUrl(env.runtimeUrl);

describe.runIf(contaminationAllowed)(
  "P3 · control negativo de sesión (solo local, conexión directa)",
  () => {
    it("set_config(..., false) contamina la conexión, el detector lo ve y el fail-closed se pierde", async () => {
      const sql = openSql(env.runtimeUrl, "negative-control", 1);
      try {
        await sql.begin(
          (tx) => tx`select set_config('role', 'authenticated', false),
                          set_config('request.jwt.claims', ${JSON.stringify(claims.uA)}, false)`,
        );
        const after = await connectionIdentity(sql);
        expect(after.currentUser).toBe("authenticated");
        expect(after.claims).toContain(users.uA.id);
        // Consecuencia: una query SIN withTenant ahora devuelve datos de A.
        const [leak] = await sql<
          { n: number }[]
        >`select count(*)::int as n from public.tenant_probe`;
        expect(leak?.n).toBeGreaterThan(0);
        await sql.unsafe("reset role");
        await sql`select set_config('request.jwt.claims', '', false)`;
        const clean = await connectionIdentity(sql);
        expect(clean).toMatchObject({ currentUser: "app_runtime", claims: "" });
      } finally {
        await sql.end({ timeout: 5 });
      }
    });
  },
);
