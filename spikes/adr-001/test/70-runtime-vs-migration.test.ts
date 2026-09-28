import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { sql as dsql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import { createRuntimeDb } from "../src/runtime";
import { withTenant } from "../src/tenant";
import { resolveTenant } from "../src/tenant-context";
import { verifiedClaimsFor } from "./support/claims";
import { runtimeConnections } from "./support/connections";
import { openSql } from "./support/db";
import { env } from "./support/env";

/*
 * C7 · `postgres` migra, pero nunca aparece en el runtime.
 *   M-1 la credencial de migración es `postgres` y puede hacer DDL
 *       (drizzle-kit migrate ya lo demostró en el workflow).
 *   M-2 toda conexión de runtime es app_runtime (session_user y current_user).
 *   M-3 mientras el runtime trabaja, ningún backend del runtime es `postgres`.
 *   M-4 el código de runtime (src/) no referencia la credencial de migración.
 *   (S-43, en 30-fail-closed: el runtime no puede hacer DDL.)
 */

const fixtures = inject("fixtures");
// El label NO empieza con "runtime": M-3 filtra por application_name del runtime.
const migration = openSql(env.migrationUrl, "c7-migration-check", 2);
afterAll(() => migration.end({ timeout: 5 }));

describe("C7 · credencial de migración", () => {
  it("M-1 · migración = postgres, con DDL", async () => {
    const [who] = await migration<{ cu: string }[]>`select current_user as cu`;
    expect(who?.cu).toBe("postgres");
    await migration.unsafe("create table public.spike_ddl_check (id int)");
    await migration.unsafe("drop table public.spike_ddl_check");
  });
});

describe.each(runtimeConnections)(
  "C7 · runtime (conexión $name)",
  ({ name, url }) => {
    const runtime = createRuntimeDb(url, { label: `c7-${name}`, max: 4 });
    afterAll(() => runtime.close());

    let claimsA: Awaited<ReturnType<typeof verifiedClaimsFor>>;
    beforeAll(async () => {
      claimsA = await verifiedClaimsFor(fixtures.users.uA);
    });

    it("M-2 · session_user y current_user del runtime = app_runtime", async () => {
      const [row] = await runtime.sql<
        { su: string; cu: string }[]
      >`select session_user as su, current_user as cu`;
      expect(row).toEqual({ su: "app_runtime", cu: "app_runtime" });
    });

    it("M-3 · con el runtime ocupado, sus backends son app_runtime y ninguno es postgres", async () => {
      const resolution = await resolveTenant(runtime, claimsA, null);
      if (resolution.kind !== "ok") throw new Error("sin contexto");
      const ctx = resolution.ctx;
      const busy = Promise.all(
        Array.from({ length: 3 }, () =>
          withTenant(runtime, ctx, (tx) =>
            tx.execute(dsql`select pg_sleep(1.5)`),
          ),
        ),
      );
      await new Promise((resolve) => setTimeout(resolve, 600));
      // Sin pg_read_all_stats, pg_stat_activity oculta backend_type/state de
      // sesiones ajenas; usename y application_name sí son visibles.
      const backends = await migration<
        { usename: string; application_name: string }[]
      >`
      select usename, application_name from pg_stat_activity
      where pid <> pg_backend_pid()
        and (usename = 'app_runtime' or application_name like 'porandu-spike-runtime%')`;
      await busy;
      expect(backends.length).toBeGreaterThan(0);
      expect(
        backends.every((b) => b.usename === "app_runtime"),
        JSON.stringify(backends),
      ).toBe(true);
    });
  },
);

describe("C7 · código de runtime", () => {
  it("M-4 · src/ no referencia la credencial de migración; solo drizzle.config.ts y el harness la leen", async () => {
    const srcDir = fileURLToPath(new URL("../src/", import.meta.url));
    const files = (await readdir(srcDir)).filter((f) => f.endsWith(".ts"));
    expect(files.length).toBeGreaterThan(0);
    for (const file of files) {
      const text = await readFile(join(srcDir, file), "utf8");
      expect(text, file).not.toMatch(
        /MIGRATION|migrationUrl|postgres:postgres/,
      );
      expect(text, file).not.toMatch(/process\.env/);
    }
    const config = await readFile(
      fileURLToPath(new URL("../drizzle.config.ts", import.meta.url)),
      "utf8",
    );
    expect(config).toMatch(/SPIKE_MIGRATION_URL/);
  });
});
