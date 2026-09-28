import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import type { VerifiedClaims } from "../src/claims";
import { expectNoRowsOrError, expectPgError } from "./support/assert";
import { verifiedClaimsFor } from "./support/claims";
import { asUser, openSql } from "./support/db";
import { env } from "./support/env";
import type { UserKey } from "./support/fixtures";

/*
 * private.user_org_ids(): la función sobre la que se apoyan todas las policies.
 * Se ejecuta como app_runtime con SET LOCAL ROLE authenticated a mano.
 */

const fixtures = inject("fixtures");
const runtime = openSql(env.runtimeUrl, "user-org-ids", 2);
const migration = openSql(env.migrationUrl, "user-org-ids-catalog", 1);
const claims = {} as Record<UserKey, VerifiedClaims>;

beforeAll(async () => {
  for (const key of ["uA", "uB", "uAB", "uC", "uD"] as const) {
    claims[key] = await verifiedClaimsFor(fixtures.users[key]);
  }
});
afterAll(async () => {
  await runtime.end({ timeout: 5 });
  await migration.end({ timeout: 5 });
});

async function orgIdsFor(
  userClaims: Record<string, unknown> | null,
): Promise<string[]> {
  const rows = await asUser(
    runtime,
    userClaims,
    (tx) => tx<{ id: string }[]>`select private.user_org_ids() as id`,
  );
  return rows.map((r) => r.id).sort();
}

describe("user_org_ids() · S-01", () => {
  it.each([
    ["uA", ["A"]],
    ["uB", ["B"]],
    ["uAB", ["A", "B"]],
    ["uC", []],
    ["uD", []],
  ] as const)("S-01 · %s → %j", async (user, expected) => {
    const ids = await orgIdsFor(claims[user]);
    expect(ids).toEqual(expected.map((org) => fixtures.orgs[org]).sort());
  });
});

describe("user_org_ids() · S-02 identidad ausente o inválida", () => {
  it("S-02a · sin claims → conjunto vacío o error, nunca organizaciones", async () => {
    await expectNoRowsOrError(orgIdsFor(null));
  });

  it("S-02b · sub inexistente → conjunto vacío", async () => {
    expect(
      await orgIdsFor({ sub: randomUUID(), role: "authenticated" }),
    ).toEqual([]);
  });

  it("S-02c · sub que no es UUID → error, nunca filas", async () => {
    await expectPgError(
      orgIdsFor({ sub: "not-a-uuid", role: "authenticated" }),
      "22P02",
    );
  });
});

describe("user_org_ids() · S-03 propiedades", () => {
  it("S-03 · security definer, stable, search_path fijado, schema private, EXECUTE solo authenticated", async () => {
    const [fn] = await migration<
      {
        schema: string;
        secdef: boolean;
        volatile: string;
        config: string[] | null;
        anon: boolean;
        authenticated: boolean;
        runtime: boolean;
        public_exec: boolean;
      }[]
    >`
      select n.nspname as schema, p.prosecdef as secdef, p.provolatile as volatile,
             p.proconfig as config,
             has_function_privilege('anon', p.oid, 'EXECUTE') as anon,
             has_function_privilege('authenticated', p.oid, 'EXECUTE') as authenticated,
             has_function_privilege('app_runtime', p.oid, 'EXECUTE') as runtime,
             exists (
               select 1 from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
               where a.grantee = 0 and a.privilege_type = 'EXECUTE'
             ) as public_exec
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where p.oid = 'private.user_org_ids()'::regprocedure`;
    expect(fn).toMatchObject({
      schema: "private",
      secdef: true,
      volatile: "s",
      anon: false,
      authenticated: true,
      runtime: false,
      public_exec: false,
    });
    expect(fn?.config).toContain('search_path=""');
  });
});

describe("user_org_ids() · S-04 plan", () => {
  it("S-04 · la función se evalúa una sola vez por statement (no por fila)", async () => {
    const plan = await asUser(runtime, claims.uA, async (tx) => {
      const rows = await tx<{ "QUERY PLAN": unknown }[]>`
        explain (analyze, format json) select * from public.tenant_probe`;
      const raw = rows[0]?.["QUERY PLAN"];
      return typeof raw === "string" ? raw : JSON.stringify(raw);
    });
    type PlanNode = {
      "Node Type"?: string;
      "Parent Relationship"?: string;
      "Actual Loops"?: number;
      "Actual Rows"?: number;
      Plans?: PlanNode[];
    };
    // La policy `organization_id IN (SELECT private.user_org_ids())` debe
    // planificarse como subplan (InitPlan / hashed SubPlan) ejecutado UNA vez,
    // no como una llamada por fila de la tabla.
    const subplans: PlanNode[] = [];
    const walk = (node: PlanNode) => {
      if (
        node["Parent Relationship"] === "SubPlan" ||
        node["Parent Relationship"] === "InitPlan"
      ) {
        subplans.push(node);
      }
      node.Plans?.forEach(walk);
    };
    const parsed = JSON.parse(plan) as { Plan: PlanNode }[];
    parsed.forEach((entry) => walk(entry.Plan));
    expect(subplans.length, plan).toBeGreaterThan(0);
    for (const node of subplans) expect(node["Actual Loops"], plan).toBe(1);
    expect(plan).toMatch(/hashed SubPlan|InitPlan/);
    expect(parsed[0]?.Plan["Actual Rows"], plan).toBeGreaterThan(1);
    await mkdir(env.resultsDir, { recursive: true });
    await writeFile(join(env.resultsDir, "s04-plan.json"), `${plan}\n`);
  });
});
