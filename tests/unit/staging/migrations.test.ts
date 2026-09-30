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
      pending: [REPO[1]],
    });
    expect(compareHistory(REPO, [...applied(2)].reverse())).toMatchObject({
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
      [...applied(2), { id: 3, hash: "x", createdAt: 9_999_999_999_999 }],
      "the repository only 2",
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

  it("con 0000 y con 0001: tablas, enum y policies de su snapshot", () => {
    expect(expectedFootprint(REPO.slice(0, 1))).toEqual({
      tables: ["memberships", "organizations", "profiles"],
      enums: ["membership_role"],
      policies: [],
    });
    expect(expectedFootprint(REPO)).toEqual({
      tables: ["memberships", "organizations", "profiles"],
      enums: ["membership_role"],
      policies: [
        "memberships.memberships_select_member",
        "organizations.organizations_select_member",
        "profiles.profiles_select_own",
      ],
    });
  });
});
