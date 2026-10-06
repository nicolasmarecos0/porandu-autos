import { fileURLToPath } from "node:url";

import { readMigrationFiles } from "drizzle-orm/migrator";
import { describe, expect, it } from "vitest";

import {
  compareHistory,
  expectedFootprint,
  MIGRATIONS_FOLDER,
  parseExpectedMigrations,
  pendingMismatch,
  readRepoMigrations,
  type AppliedMigration,
} from "../../../scripts/staging/migrations.mts";

/*
 * Migraciones oficiales frente al historial de drizzle
 * (scripts/staging/migrations.mts).
 */

const REPO = readRepoMigrations();

function applied(count: number): AppliedMigration[] {
  return REPO.slice(0, count).map((m, i) => ({
    id: i + 1,
    hash: m.hash,
    createdAt: m.when,
  }));
}

describe("readRepoMigrations", () => {
  it("lee exactamente las migraciones oficiales, en orden", () => {
    expect(REPO.map((m) => [m.idx, m.tag])).toEqual([
      [0, "0000_saas_core_schema"],
      [1, "0001_tenant_isolation"],
      [2, "0002_opportunities_persistence"],
      [3, "0003_contact_identity_opportunity_create"],
      [4, "0004_vehicles_stock_persistence"],
      [5, "0005_vehicle_quick_create"],
      [6, "0006_vehicle_availability"],
      [7, "0007_opportunity_demand_facts"],
    ]);
  });

  it("calcula hash y created_at igual que drizzle-orm al migrar", () => {
    const drizzle = readMigrationFiles({
      migrationsFolder: fileURLToPath(MIGRATIONS_FOLDER),
    });
    expect(REPO.map((m) => [m.hash, m.when])).toEqual(
      drizzle.map((m) => [m.hash, m.folderMillis]),
    );
  });
});

describe("compareHistory", () => {
  it("sin historial: todo pendiente", () => {
    expect(compareHistory(REPO, [])).toEqual({
      kind: "consistent",
      applied: [],
      pending: REPO,
    });
  });

  it("un prefijo exacto del journal es consistente", () => {
    expect(compareHistory(REPO, applied(1))).toEqual({
      kind: "consistent",
      applied: [REPO[0]],
      pending: REPO.slice(1),
    });
    // Staging hoy (H1.3C): solo 0007 pendiente.
    expect(compareHistory(REPO, applied(7))).toEqual({
      kind: "consistent",
      applied: REPO.slice(0, 7),
      pending: [REPO[7]],
    });
    expect(compareHistory(REPO, [...applied(8)].reverse())).toMatchObject({
      kind: "consistent",
      pending: [],
    });
  });

  it.each([
    [
      "un hash distinto",
      [{ ...applied(1)[0]!, hash: "edited" }],
      "different hash",
    ],
    [
      "una migración desconocida",
      [{ id: 1, hash: "x", createdAt: 1 }],
      "is not 0000_saas_core_schema",
    ],
    ["un hueco", [applied(2)[1]!], "is not 0000_saas_core_schema"],
    [
      "más filas que el repositorio",
      [...applied(8), { id: 9, hash: "x", createdAt: 9_999_999_999_999 }],
      "the repository only 8",
    ],
  ])("inconsistente con %s", (_, rows, reason) => {
    const status = compareHistory(REPO, rows);
    expect(status.kind).toBe("inconsistent");
    expect(status.kind === "inconsistent" && status.reason).toContain(reason);
  });
});

describe("migraciones esperadas (input expected_migrations)", () => {
  it("parsea tags separados por coma", () => {
    expect(
      parseExpectedMigrations(
        " 0000_saas_core_schema , 0001_tenant_isolation,",
      ),
    ).toEqual(["0000_saas_core_schema", "0001_tenant_isolation"]);
    expect(parseExpectedMigrations(undefined)).toEqual([]);
    expect(() => parseExpectedMigrations("a,a")).toThrow(/duplicated/);
  });

  it("lo pendiente tiene que ser exactamente lo declarado", () => {
    const tags = REPO.map((m) => m.tag);
    expect(pendingMismatch(REPO, tags)).toBeNull();
    expect(pendingMismatch(REPO, [])).toMatch(/required/);
    expect(pendingMismatch(REPO, [tags[0]!])).toMatch(/expected/);
    expect(pendingMismatch(REPO, [...tags].reverse())).toMatch(/expected/);
    expect(pendingMismatch([], tags)).toMatch(/pending migrations are \[\]/);
  });
});

describe("expectedFootprint", () => {
  it("sin migraciones aplicadas, public queda vacío", () => {
    expect(expectedFootprint([])).toEqual({
      tables: [],
      enums: [],
      policies: [],
    });
  });

  it("con 0000 a 0007: tablas, enum y policies de su snapshot", () => {
    expect(expectedFootprint(REPO.slice(0, 1))).toEqual({
      tables: ["memberships", "organizations", "profiles"],
      enums: ["membership_role"],
      policies: [],
    });
    expect(expectedFootprint(REPO.slice(0, 2))).toEqual({
      tables: ["memberships", "organizations", "profiles"],
      enums: ["membership_role"],
      policies: [
        "memberships.memberships_select_member",
        "organizations.organizations_select_member",
        "profiles.profiles_select_own",
      ],
    });
    const h11 = {
      tables: [
        "contacts",
        "memberships",
        "opportunities",
        "organizations",
        "profiles",
      ],
      enums: ["membership_role"],
      policies: [
        "contacts.contacts_select_member",
        "memberships.memberships_select_member",
        "opportunities.opportunities_select_member",
        "organizations.organizations_select_member",
        "profiles.profiles_select_own",
      ],
    };
    expect(expectedFootprint(REPO.slice(0, 3))).toEqual(h11);
    // 0003 no crea tablas: suma las policies de alta.
    const h12 = {
      ...h11,
      policies: [
        "contacts.contacts_insert_member",
        "contacts.contacts_select_member",
        "memberships.memberships_select_member",
        "opportunities.opportunities_insert_member",
        "opportunities.opportunities_select_member",
        "organizations.organizations_select_member",
        "profiles.profiles_select_own",
      ],
    };
    expect(expectedFootprint(REPO.slice(0, 4))).toEqual(h12);
    // 0004 suma vehicles, con su única policy (lectura).
    const h13a = {
      ...h12,
      tables: [...h12.tables, "vehicles"],
      policies: [...h12.policies, "vehicles.vehicles_select_member"],
    };
    expect(expectedFootprint(REPO.slice(0, 5))).toEqual(h13a);
    // 0005 no crea tablas: suma la policy de alta de vehicles.
    const h13b = {
      ...h13a,
      policies: [
        ...h12.policies,
        "vehicles.vehicles_insert_member",
        "vehicles.vehicles_select_member",
      ],
    };
    expect(expectedFootprint(REPO.slice(0, 6))).toEqual(h13b);
    // 0006 no crea tablas: suma la policy de disponibilidad de vehicles.
    const h13c = {
      ...h13b,
      policies: [...h13b.policies, "vehicles.vehicles_update_mark_available"],
    };
    expect(expectedFootprint(REPO.slice(0, 7))).toEqual(h13c);
    // 0007 suma el ledger de demanda, con sus policies de lectura y alta.
    expect(expectedFootprint(REPO)).toEqual({
      ...h13c,
      tables: [
        "contacts",
        "memberships",
        "opportunities",
        "opportunity_demand_facts",
        "organizations",
        "profiles",
        "vehicles",
      ],
      policies: [
        "contacts.contacts_insert_member",
        "contacts.contacts_select_member",
        "memberships.memberships_select_member",
        "opportunities.opportunities_insert_member",
        "opportunities.opportunities_select_member",
        "opportunity_demand_facts.opportunity_demand_facts_insert_member",
        "opportunity_demand_facts.opportunity_demand_facts_select_member",
        "organizations.organizations_select_member",
        "profiles.profiles_select_own",
        "vehicles.vehicles_insert_member",
        "vehicles.vehicles_select_member",
        "vehicles.vehicles_update_mark_available",
      ],
    });
  });
});
