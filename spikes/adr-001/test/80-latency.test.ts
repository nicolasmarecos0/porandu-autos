import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { performance } from "node:perf_hooks";
import { and, eq, sql as dsql } from "drizzle-orm";
import { afterAll, describe, expect, inject, it } from "vitest";
import { tenantProbe } from "../src/probe-schema";
import { createRuntimeDb } from "../src/runtime";
import { withTenant } from "../src/tenant";
import { resolveTenant } from "../src/tenant-context";
import { verifiedClaimsFor } from "./support/claims";
import { runtimeConnections } from "./support/connections";
import { openSql } from "./support/db";
import { env } from "./support/env";

/*
 * C5 · SOLO MEDICIÓN. No hay umbral: D19 no está aprobada y este test no
 * falla por latencia. En E1 la base corre en el mismo host que los tests, así
 * que los números miden el costo relativo de withTenant, no la latencia
 * Vercel → Supabase (eso queda para E3).
 *
 *   B0  select 1 como app_runtime, sin transacción        (piso de red)
 *   W0  withTenant(select 1)                               (costo del wrapper)
 *   B1  SELECT por PK como postgres, sin tx ni RLS         (misma query sin withTenant)
 *   W1  withTenant(SELECT por PK + filtro org) con RLS     (costo total)
 */

const fixtures = inject("fixtures");
// e2 corre desde un runner de GitHub (EE. UU.) contra sa-east-1: cada round trip
// cuesta ~100+ ms, así que el workflow baja las iteraciones (SPIKE_LATENCY_ITERATIONS).
// Ese número NO representa Vercel → Supabase en la misma región (eso es E3).
const ITERATIONS = Number(process.env.SPIKE_LATENCY_ITERATIONS ?? "400");
const WARMUP = Math.max(5, Math.floor(ITERATIONS / 10));

type Stats = { p50: number; p95: number; mean: number; n: number };

function stats(samples: number[]): Stats {
  const sorted = [...samples].sort((a, b) => a - b);
  const at = (q: number) =>
    sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))] ?? NaN;
  const round = (v: number) => Math.round(v * 1000) / 1000;
  return {
    p50: round(at(0.5)),
    p95: round(at(0.95)),
    mean: round(sorted.reduce((sum, v) => sum + v, 0) / sorted.length),
    n: sorted.length,
  };
}

async function measure(fn: () => Promise<unknown>): Promise<Stats> {
  for (let i = 0; i < WARMUP; i += 1) await fn();
  const samples: number[] = [];
  for (let i = 0; i < ITERATIONS; i += 1) {
    const start = performance.now();
    await fn();
    samples.push(performance.now() - start);
  }
  return stats(samples);
}

const report: Record<
  string,
  Record<string, Stats | Record<string, number>>
> = {};

afterAll(async () => {
  await mkdir(env.resultsDir, { recursive: true });
  await writeFile(
    join(env.resultsDir, "latency.json"),
    `${JSON.stringify(report, null, 2)}\n`,
  );
});

describe.each(runtimeConnections)(
  "C5 · latencia (conexión $name)",
  ({ name, url }) => {
    const runtime = createRuntimeDb(url, { label: `latency-${name}`, max: 1 });
    const baselineUrl =
      name === "pooler" ? env.postgresPoolerUrl : env.migrationUrl;
    const baseline = baselineUrl
      ? openSql(baselineUrl, `latency-baseline-${name}`, 1)
      : undefined;
    afterAll(async () => {
      await runtime.close();
      await baseline?.end({ timeout: 5 });
    });

    it("mide p50/p95 de baseline y withTenant (sin umbral)", async () => {
      const claims = await verifiedClaimsFor(fixtures.users.uA);
      const resolution = await resolveTenant(runtime, claims, null);
      if (resolution.kind !== "ok") throw new Error("sin contexto");
      const ctx = resolution.ctx;
      const probeId = fixtures.probe.A[0];
      if (!probeId) throw new Error("sin probe");

      const B0 = await measure(() => runtime.sql`select 1`);
      const W0 = await measure(() =>
        withTenant(runtime, ctx, (tx) => tx.execute(dsql`select 1`)),
      );
      const W1 = await measure(() =>
        withTenant(runtime, ctx, (tx) =>
          tx
            .select({ id: tenantProbe.id })
            .from(tenantProbe)
            .where(
              and(
                eq(tenantProbe.id, probeId),
                eq(tenantProbe.organizationId, ctx.organizationId),
              ),
            ),
        ),
      );
      const B1 = baseline
        ? await measure(
            () =>
              baseline`select id from public.tenant_probe where id = ${probeId}`,
          )
        : undefined;

      const entry: Record<string, Stats | Record<string, number>> = {
        B0,
        W0,
        W1,
      };
      const overhead: Record<string, number> = {
        wrapper_p50: Math.round((W0.p50 - B0.p50) * 1000) / 1000,
        wrapper_p95: Math.round((W0.p95 - B0.p95) * 1000) / 1000,
      };
      if (B1) {
        entry.B1 = B1;
        overhead.full_p50 = Math.round((W1.p50 - B1.p50) * 1000) / 1000;
        overhead.full_p95 = Math.round((W1.p95 - B1.p95) * 1000) / 1000;
      }
      entry.overhead = overhead;
      report[name] = entry;
      console.info(`[C5 ${name}]`, JSON.stringify(entry));

      for (const value of [B0.p50, B0.p95, W0.p50, W0.p95, W1.p50, W1.p95]) {
        expect(Number.isFinite(value)).toBe(true);
      }
    });
  },
);
