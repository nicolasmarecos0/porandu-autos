import { randomUUID } from "node:crypto";
import { eq, sql as dsql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import { createProbe, InputValidationError } from "../src/actions";
import type { VerifiedClaims } from "../src/claims";
import { tenantProbe } from "../src/probe-schema";
import { createRuntimeDb } from "../src/runtime";
import { withTenant, type TenantContext } from "../src/tenant";
import { resolveTenant } from "../src/tenant-context";
import { expectPgError } from "./support/assert";
import { verifiedClaimsFor, verifyToken } from "./support/claims";
import { runtimeConnections } from "./support/connections";
import { openSql } from "./support/db";
import { env, usesSupabase } from "./support/env";
import type { OrgKey, UserKey } from "./support/fixtures";
import { decodeJwtPart, signHs256, tamperPayload } from "./support/jwt-hs256";

/*
 * C1/C2 a nivel aplicación: claims verificados → resolveTenant → withTenant.
 * En e1 los claims salen de un login real contra Supabase Auth + getClaims().
 */

const fixtures = inject("fixtures");
const { orgs, users, probe } = fixtures;
const claims = {} as Record<UserKey, VerifiedClaims>;
const migration = openSql(env.migrationUrl, "app-isolation-check", 1);

beforeAll(async () => {
  for (const key of ["uA", "uB", "uAB", "uC", "uD"] as const) {
    claims[key] = await verifiedClaimsFor(users[key]);
  }
});
afterAll(() => migration.end({ timeout: 5 }));

function first(ids: readonly string[]): string {
  const id = ids[0];
  if (!id) throw new Error("fixture vacío");
  return id;
}

/** Contexto armado a mano, salteando resolveTenant (solo para tests). */
function forgedContext(
  user: UserKey,
  org: OrgKey,
  userClaims: VerifiedClaims,
): TenantContext {
  return {
    userId: users[user].id,
    organizationId: orgs[org],
    role: "admin",
    claims: userClaims,
  } as unknown as TenantContext;
}

async function countProbeRows(): Promise<number> {
  const [row] = await migration<
    { n: number }[]
  >`select count(*)::int as n from public.tenant_probe`;
  return row?.n ?? -1;
}

describe.each(runtimeConnections)(
  "aplicación (conexión $name)",
  ({ name, url }) => {
    const runtime = createRuntimeDb(url, { label: `app-${name}`, max: 4 });
    afterAll(() => runtime.close());

    async function contextFor(
      user: UserKey,
      requested: string | null,
    ): Promise<TenantContext> {
      const resolution = await resolveTenant(runtime, claims[user], requested);
      if (resolution.kind !== "ok")
        throw new Error(`sin contexto: ${resolution.kind}`);
      return resolution.ctx;
    }

    const selectProbe = (ctx: TenantContext, org?: string) =>
      withTenant(runtime, ctx, (tx) => {
        const query = tx
          .select({ id: tenantProbe.id, org: tenantProbe.organizationId })
          .from(tenantProbe);
        return org ? query.where(eq(tenantProbe.organizationId, org)) : query;
      });

    it("A-01 · acceso propio: lectura, alta, edición y baja dentro de su organización", async () => {
      const ctx = await contextFor("uA", null);
      expect(ctx).toMatchObject({ organizationId: orgs.A, role: "admin" });
      const rows = await selectProbe(ctx, ctx.organizationId);
      expect(rows.map((r) => r.id).sort()).toEqual([...probe.A].sort());

      const created = await createProbe(runtime, ctx, { label: "a01" });
      expect(created.organizationId).toBe(orgs.A);
      const updated = await withTenant(runtime, ctx, (tx) =>
        tx
          .update(tenantProbe)
          .set({ label: "a01u" })
          .where(eq(tenantProbe.id, created.id))
          .returning({ id: tenantProbe.id }),
      );
      expect(updated).toHaveLength(1);
      const deleted = await withTenant(runtime, ctx, (tx) =>
        tx
          .delete(tenantProbe)
          .where(eq(tenantProbe.id, created.id))
          .returning({ id: tenantProbe.id }),
      );
      expect(deleted).toHaveLength(1);
    });

    it.each([
      ["uA", "B"],
      ["uB", "A"],
    ] as const)(
      "A-02 · %s sobre la org %s: SELECT vacío, INSERT rechazado, UPDATE/DELETE sin efecto",
      async (user, other) => {
        const ctx = await contextFor(user, null);
        expect(await selectProbe(ctx, orgs[other])).toHaveLength(0);
        await expectPgError(
          withTenant(runtime, ctx, (tx) =>
            tx
              .insert(tenantProbe)
              .values({ organizationId: orgs[other], label: "a02" }),
          ),
          "42501",
          /row-level security/,
        );
        const updated = await withTenant(runtime, ctx, (tx) =>
          tx
            .update(tenantProbe)
            .set({ label: "a02" })
            .where(eq(tenantProbe.id, first(probe[other])))
            .returning({ id: tenantProbe.id }),
        );
        expect(updated).toHaveLength(0);
        const deleted = await withTenant(runtime, ctx, (tx) =>
          tx
            .delete(tenantProbe)
            .where(eq(tenantProbe.id, first(probe[other])))
            .returning({ id: tenantProbe.id }),
        );
        expect(deleted).toHaveLength(0);
      },
    );

    it("A-03 · contexto falsificado {uA, org B}: la base no confía en la aplicación", async () => {
      const forged = forgedContext("uA", "B", claims.uA);
      expect(await selectProbe(forged, orgs.B)).toHaveLength(0);
      await expectPgError(
        withTenant(runtime, forged, (tx) =>
          tx
            .insert(tenantProbe)
            .values({ organizationId: orgs.B, label: "a03" }),
        ),
        "42501",
        /row-level security/,
      );
    });

    it.each(["uC", "uD"] as const)(
      "A-04 · %s sin membership activa → no-access",
      async (user) => {
        expect(await resolveTenant(runtime, claims[user], null)).toEqual({
          kind: "no-access",
        });
        expect(await resolveTenant(runtime, claims[user], orgs.A)).toEqual({
          kind: "no-access",
        });
      },
    );

    it("A-05 · organization_id enviado por el cliente: rechazado y nada se escribe", async () => {
      const ctx = await contextFor("uA", null);
      const before = await countProbeRows();
      await expect(
        createProbe(runtime, ctx, { label: "a05", organization_id: orgs.B }),
      ).rejects.toBeInstanceOf(InputValidationError);
      expect(await countProbeRows()).toBe(before);
    });

    it("A-06 · org solicitada ajena o inválida (cookie manipulada): nunca devuelve esa org", async () => {
      for (const requested of [orgs.B, "not-a-uuid", randomUUID()]) {
        const ctx = await contextFor("uA", requested);
        expect(ctx.organizationId).toBe(orgs.A);
      }
    });

    it("A-07 · cambio de organización de uAB: el contexto sigue la selección; el filtro explícito fija la org activa", async () => {
      const inA = await contextFor("uAB", orgs.A);
      const inB = await contextFor("uAB", orgs.B);
      expect(inA).toMatchObject({ organizationId: orgs.A, role: "seller" });
      expect(inB).toMatchObject({ organizationId: orgs.B, role: "admin" });
      expect(
        new Set((await selectProbe(inA, inA.organizationId)).map((r) => r.org)),
      ).toEqual(new Set([orgs.A]));
      expect(
        new Set((await selectProbe(inB, inB.organizationId)).map((r) => r.org)),
      ).toEqual(new Set([orgs.B]));
      // Sin filtro explícito RLS muestra ambas: RLS garantiza "orgs del usuario",
      // la org ACTIVA la garantiza la aplicación (hipótesis D7).
      expect(new Set((await selectProbe(inA)).map((r) => r.org))).toEqual(
        new Set([orgs.A, orgs.B]),
      );
    });

    it("A-08 · uAB con org solicitada inexistente o sin cookie → debe elegir organización", async () => {
      for (const requested of [randomUUID(), null]) {
        const resolution = await resolveTenant(runtime, claims.uAB, requested);
        expect(resolution.kind).toBe("select-organization");
        if (resolution.kind === "select-organization") {
          expect([...resolution.organizationIds].sort()).toEqual(
            [orgs.A, orgs.B].sort(),
          );
        }
      }
    });

    it("A-09 · membership revocada: efecto inmediato, incluso con un contexto viejo", async () => {
      const staleB = await contextFor("uAB", orgs.B);
      await migration`update public.memberships set active = false
                    where user_id = ${users.uAB.id} and organization_id = ${orgs.B}`;
      try {
        const ctx = await contextFor("uAB", orgs.B);
        expect(ctx.organizationId).toBe(orgs.A);
        expect(await selectProbe(staleB, orgs.B)).toHaveLength(0);
      } finally {
        await migration`update public.memberships set active = true
                      where user_id = ${users.uAB.id} and organization_id = ${orgs.B}`;
      }
    });

    it("A-13 · claims con comillas y SQL: viajan parametrizados, sin inyección", async () => {
      const payload = `'); drop table public.organizations; --`;
      const tricky = {
        ...claims.uA,
        x: payload,
        q: 'a"b\\c',
      } as VerifiedClaims;
      const ctx = { ...forgedContext("uA", "A", tricky) } as TenantContext;
      const rows = await withTenant(runtime, ctx, (tx) =>
        tx.execute<{ x: string; q: string }>(
          dsql`select current_setting('request.jwt.claims', true)::jsonb ->> 'x' as x,
                    current_setting('request.jwt.claims', true)::jsonb ->> 'q' as q`,
        ),
      );
      expect(rows[0]).toEqual({ x: payload, q: 'a"b\\c' });
      const [exists] = await migration<
        { ok: boolean }[]
      >`select to_regclass('public.organizations') is not null as ok`;
      expect(exists?.ok).toBe(true);
    });
  },
);

describe("A-14 · verificación del token", () => {
  it("token adulterado (sub de otro usuario, firma original): rechazado", async () => {
    const tampered = tamperPayload(users.uA.accessToken, { sub: users.uB.id });
    await expect(verifyToken(tampered)).rejects.toThrow();
  });

  it("token con firma válida pero vencido: rechazado", async (context) => {
    const header = decodeJwtPart(users.uA.accessToken, 0);
    if (usesSupabase && (header.alg !== "HS256" || !env.jwtSecret)) {
      context.skip(
        `Auth local firma con ${String(header.alg)}: no se puede firmar un token vencido válido`,
      );
    }
    if (!env.jwtSecret) throw new Error("falta SPIKE_JWT_SECRET");
    const payload = decodeJwtPart(users.uA.accessToken, 1);
    const now = Math.floor(Date.now() / 1000);
    const expired = signHs256(
      { ...payload, iat: now - 7200, exp: now - 3600 },
      env.jwtSecret,
    );
    await expect(verifyToken(expired)).rejects.toThrow();
  });
});
