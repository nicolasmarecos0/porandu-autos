import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import type { VerifiedClaims } from "../src/claims";
import { expectNoRowsOrError, expectPgError } from "./support/assert";
import { verifiedClaimsFor } from "./support/claims";
import { runtimeConnections } from "./support/connections";
import { asUser, openSql } from "./support/db";
import type { OrgKey, UserKey } from "./support/fixtures";

/*
 * C1 · matriz RLS a nivel SQL. Conexión de runtime (`app_runtime`) con la
 * identidad fijada A MANO (SET LOCAL ROLE authenticated + set_config): prueba
 * el contrato de la base sin depender de withTenant. Todo se revierte.
 */

const fixtures = inject("fixtures");
const { orgs, users, probe } = fixtures;
const claims = {} as Record<UserKey, VerifiedClaims>;

beforeAll(async () => {
  for (const key of ["uA", "uB", "uAB", "uC", "uD"] as const) {
    claims[key] = await verifiedClaimsFor(users[key]);
  }
});

function first(ids: readonly string[]): string {
  const id = ids[0];
  if (!id) throw new Error("fixture vacío");
  return id;
}

const directions = [
  { me: "uA", mine: "A", other: "B" },
  { me: "uB", mine: "B", other: "A" },
] as const satisfies readonly { me: UserKey; mine: OrgKey; other: OrgKey }[];

describe.each(runtimeConnections)(
  "C1 · matriz RLS (conexión $name)",
  ({ name, url }) => {
    const sql = openSql(url, `rls-${name}`, 3);
    afterAll(() => sql.end({ timeout: 5 }));

    describe.each(directions)(
      "$me → propia $mine / ajena $other",
      ({ me, mine, other }) => {
        it("S-10 · SELECT propio: solo filas de su organización", async () => {
          const result = await asUser(sql, claims[me], async (tx) => ({
            organizations: await tx<
              { id: string }[]
            >`select id from public.organizations`,
            memberships: await tx<
              { org: string }[]
            >`select organization_id as org from public.memberships`,
            profiles: await tx<
              { id: string }[]
            >`select id from public.profiles`,
            probe: await tx<
              { id: string }[]
            >`select id from public.tenant_probe order by id`,
          }));
          expect(result.organizations.map((r) => r.id)).toEqual([orgs[mine]]);
          expect(result.memberships.length).toBeGreaterThan(0);
          expect(new Set(result.memberships.map((r) => r.org))).toEqual(
            new Set([orgs[mine]]),
          );
          expect(result.profiles.map((r) => r.id)).toEqual([users[me].id]);
          expect(result.probe.map((r) => r.id)).toEqual(
            [...probe[mine]].sort(),
          );
        });

        it("S-11 · INSERT / UPDATE / DELETE propios: permitidos", async () => {
          const inserted = await asUser(
            sql,
            claims[me],
            (tx) =>
              tx`insert into public.tenant_probe (organization_id, label) values (${orgs[mine]}, 's11') returning id`,
          );
          expect(inserted).toHaveLength(1);
          const updated = await asUser(
            sql,
            claims[me],
            (tx) =>
              tx`update public.tenant_probe set label = 's11u' where id = ${first(probe[mine])}`,
          );
          expect(updated.count).toBe(1);
          const deleted = await asUser(
            sql,
            claims[me],
            (tx) =>
              tx`delete from public.tenant_probe where id = ${first(probe[mine])}`,
          );
          expect(deleted.count).toBe(1);
        });

        it("S-20 · SELECT cruzado: 0 filas en todas las tablas", async () => {
          const result = await asUser(sql, claims[me], async (tx) => ({
            organizations:
              await tx`select id from public.organizations where id = ${orgs[other]}`,
            memberships:
              await tx`select id from public.memberships where organization_id = ${orgs[other]}`,
            probe:
              await tx`select id from public.tenant_probe where organization_id = ${orgs[other]}`,
            probeById:
              await tx`select id from public.tenant_probe where id = ${first(probe[other])}`,
          }));
          expect(result.organizations).toHaveLength(0);
          expect(result.memberships).toHaveLength(0);
          expect(result.probe).toHaveLength(0);
          expect(result.probeById).toHaveLength(0);
        });

        it("S-21 · INSERT cruzado: rechazado por RLS (42501)", async () => {
          await expectPgError(
            asUser(
              sql,
              claims[me],
              (tx) =>
                tx`insert into public.tenant_probe (organization_id, label) values (${orgs[other]}, 's21')`,
            ),
            "42501",
            /row-level security/,
          );
        });

        it("S-22 · UPDATE cruzado: 0 filas afectadas", async () => {
          const updated = await asUser(
            sql,
            claims[me],
            (tx) =>
              tx`update public.tenant_probe set label = 's22' where id = ${first(probe[other])}`,
          );
          expect(updated.count).toBe(0);
        });

        it("S-23 · mover una fila propia a la otra organización: rechazado por WITH CHECK", async () => {
          await expectPgError(
            asUser(
              sql,
              claims[me],
              (tx) =>
                tx`update public.tenant_probe set organization_id = ${orgs[other]} where id = ${first(probe[mine])}`,
            ),
            "42501",
            /row-level security/,
          );
        });

        it("S-24 · DELETE cruzado: 0 filas afectadas", async () => {
          const deleted = await asUser(
            sql,
            claims[me],
            (tx) =>
              tx`delete from public.tenant_probe where id = ${first(probe[other])}`,
          );
          expect(deleted.count).toBe(0);
        });

        it("S-25 · auto-agregarse a la otra org o agregar a un tercero: sin permiso", async () => {
          await expectPgError(
            asUser(
              sql,
              claims[me],
              (tx) =>
                tx`insert into public.memberships (organization_id, user_id, role) values (${orgs[other]}, ${users[me].id}, 'admin')`,
            ),
            "42501",
            /permission denied/,
          );
          await expectPgError(
            asUser(
              sql,
              claims[me],
              (tx) =>
                tx`insert into public.memberships (organization_id, user_id, role) values (${orgs[mine]}, ${users.uC.id}, 'seller')`,
            ),
            "42501",
            /permission denied/,
          );
        });

        it("S-26 · escalar el propio rol o tocar organizations: sin permiso", async () => {
          await expectPgError(
            asUser(
              sql,
              claims[me],
              (tx) =>
                tx`update public.memberships set role = 'admin' where user_id = ${users[me].id}`,
            ),
            "42501",
            /permission denied/,
          );
          await expectPgError(
            asUser(
              sql,
              claims[me],
              (tx) =>
                tx`delete from public.organizations where id = ${orgs[other]}`,
            ),
            "42501",
            /permission denied/,
          );
        });
      },
    );

    describe("sin membership", () => {
      it.each(["uC", "uD"] as const)(
        "S-30 · %s: 0 filas de datos tenant, INSERT rechazado, UPDATE/DELETE sin efecto",
        async (user) => {
          const result = await asUser(sql, claims[user], async (tx) => ({
            organizations: await tx`select id from public.organizations`,
            memberships: await tx`select id from public.memberships`,
            probe: await tx`select id from public.tenant_probe`,
            updated: await tx`update public.tenant_probe set label = 's30'`,
            deleted: await tx`delete from public.tenant_probe`,
          }));
          expect(result.organizations).toHaveLength(0);
          expect(result.memberships).toHaveLength(0);
          expect(result.probe).toHaveLength(0);
          expect(result.updated.count).toBe(0);
          expect(result.deleted.count).toBe(0);
          await expectPgError(
            asUser(
              sql,
              claims[user],
              (tx) =>
                tx`insert into public.tenant_probe (organization_id, label) values (${orgs.A}, 's30')`,
            ),
            "42501",
            /row-level security/,
          );
        },
      );

      it("S-31 · authenticated sin claims: nunca filas; INSERT falla", async () => {
        for (const table of [
          "organizations",
          "memberships",
          "profiles",
          "tenant_probe",
        ]) {
          await expectNoRowsOrError(
            asUser(sql, null, (tx) =>
              tx.unsafe(`select * from public.${table}`),
            ),
          );
        }
        let failed = false;
        try {
          await asUser(
            sql,
            null,
            (tx) =>
              tx`insert into public.tenant_probe (organization_id, label) values (${orgs.A}, 's31')`,
          );
        } catch {
          failed = true;
        }
        expect(failed).toBe(true);
      });

      it("S-32 · claims con role=service_role pero SET LOCAL ROLE authenticated: RLS aplica igual", async () => {
        const forged = { ...claims.uA, role: "service_role" };
        const rows = await asUser(
          sql,
          forged,
          (tx) =>
            tx<
              { org: string }[]
            >`select organization_id as org from public.tenant_probe`,
        );
        expect(new Set(rows.map((r) => r.org))).toEqual(new Set([orgs.A]));
      });
    });
  },
);
