import { afterAll, beforeAll, describe, inject, it } from "vitest";
import type { VerifiedClaims } from "../src/claims";
import { tenantProbe } from "../src/probe-schema";
import { createRuntimeDb } from "../src/runtime";
import { organizations } from "../src/schema";
import { expectPgError } from "./support/assert";
import { verifiedClaimsFor } from "./support/claims";
import { runtimeConnections } from "./support/connections";
import { asRole, asUser, openSql } from "./support/db";
import { env } from "./support/env";

/*
 * C2 · falla cerrada. Sin withTenant (o sin SET ROLE), app_runtime no tiene
 * ningún privilegio sobre las tablas de la aplicación.
 */

const fixtures = inject("fixtures");
let claimsA: VerifiedClaims;
beforeAll(async () => {
  claimsA = await verifiedClaimsFor(fixtures.users.uA);
});

const APP_TABLES = ["organizations", "profiles", "memberships", "tenant_probe"];

describe.each(runtimeConnections)(
  "C2 · falla cerrada (conexión $name)",
  ({ name, url }) => {
    const sql = openSql(url, `fail-closed-${name}`, 2);
    const runtime = createRuntimeDb(url, {
      label: `fail-closed-${name}`,
      max: 2,
    });
    afterAll(async () => {
      await sql.end({ timeout: 5 });
      await runtime.close();
    });

    it.each(APP_TABLES)(
      "S-40 · app_runtime sin SET ROLE: SELECT %s → permission denied",
      async (table) => {
        await expectPgError(
          sql.unsafe(`select * from public.${table}`),
          "42501",
          /permission denied/,
        );
      },
    );

    it("S-40b · con claims pero sin SET ROLE: sigue sin permiso (los claims solos no dan acceso)", async () => {
      await expectPgError(
        sql.begin(async (tx) => {
          await tx`select set_config('request.jwt.claims', ${JSON.stringify(claimsA)}, true)`;
          return tx`select * from public.tenant_probe`;
        }),
        "42501",
        /permission denied/,
      );
    });

    it("S-40c · app_runtime sin SET ROLE: INSERT → permission denied", async () => {
      await expectPgError(
        sql`insert into public.tenant_probe (organization_id, label) values (${fixtures.orgs.A}, 's40')`,
        "42501",
        /permission denied/,
      );
    });

    it.each(["service_role", "postgres", "anon", "supabase_admin"])(
      "S-41 · app_runtime no puede asumir %s",
      async (role) => {
        await expectPgError(
          sql.begin((tx) => tx.unsafe(`set local role ${role}`)),
          "42501",
        );
        await expectPgError(
          sql.begin((tx) => tx`select set_config('role', ${role}, true)`),
          "42501",
        );
      },
    );

    it("A-10 · Drizzle sobre la conexión de runtime sin withTenant: SELECT e INSERT fallan", async () => {
      await expectPgError(
        runtime.db.select().from(organizations),
        "42501",
        /permission denied/,
      );
      await expectPgError(
        runtime.db
          .insert(tenantProbe)
          .values({ organizationId: fixtures.orgs.A, label: "a10" }),
        "42501",
        /permission denied/,
      );
    });

    it("S-43 · ni app_runtime ni authenticated pueden crear objetos (el runtime no migra)", async () => {
      await expectPgError(
        sql.unsafe("create table public.spike_evil (id int)"),
        "42501",
      );
      await expectPgError(sql.unsafe("create schema spike_evil"), "42501");
      await expectPgError(
        asUser(sql, claimsA, (tx) =>
          tx.unsafe("create table public.spike_evil (id int)"),
        ),
        "42501",
      );
    });
  },
);

describe("C2 · anon", () => {
  const migration = openSql(env.migrationUrl, "anon-check", 1);
  afterAll(() => migration.end({ timeout: 5 }));

  it.each(APP_TABLES)(
    "S-42 · anon: SELECT %s → permission denied",
    async (table) => {
      await expectPgError(
        asRole(migration, "anon", null, (tx) =>
          tx.unsafe(`select * from public.${table}`),
        ),
        "42501",
        /permission denied/,
      );
    },
  );
});
