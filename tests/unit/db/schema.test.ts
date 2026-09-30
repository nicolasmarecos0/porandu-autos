import { readFileSync } from "node:fs";

import { generateDrizzleJson, generateMigration } from "drizzle-kit/api";
import { is } from "drizzle-orm";
import { getTableConfig, PgTable } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";

import * as schema from "@/db/schema";

/*
 * Schema de Drizzle (db/schema), sin base de datos. El catálogo real que
 * deja la migración se prueba contra PostgreSQL 17 en tests/db/.
 */

// Tablas que no pertenecen a una organización (ADR-001 §3.6).
const NOT_TENANT_OWNED = ["organizations", "profiles"];

const tables = (Object.values(schema) as unknown[])
  .filter((value): value is PgTable => is(value, PgTable))
  .map((table) => getTableConfig(table));

function table(name: string) {
  const config = tables.find((t) => t.name === name);
  if (!config) throw new Error(`table ${name} is not exported`);
  return config;
}

function column(tableName: string, columnName: string) {
  const found = table(tableName).columns.find((c) => c.name === columnName);
  if (!found) throw new Error(`column ${tableName}.${columnName} not found`);
  return found;
}

/** FKs de la tabla como `columna -> schema.tabla(columna) ON DELETE acción`. */
function foreignKeys(name: string): string[] {
  return table(name)
    .foreignKeys.map((fk) => {
      const { columns, foreignColumns, foreignTable } = fk.reference();
      const target = getTableConfig(foreignTable);
      return `${columns.map((c) => c.name).join(",")} -> ${target.schema ?? "public"}.${target.name}(${foreignColumns.map((c) => c.name).join(",")}) ON DELETE ${fk.onDelete}`;
    })
    .sort();
}

describe("db/schema", () => {
  it("define solo organizations, profiles y memberships", () => {
    expect(tables.map((t) => t.name).sort()).toEqual([
      "memberships",
      "organizations",
      "profiles",
    ]);
  });

  it("toda tabla habilita RLS", () => {
    expect(tables.filter((t) => !t.enableRLS).map((t) => t.name)).toEqual([]);
  });

  it("organizations: UUID PK generado, nombre obligatorio, sin FKs", () => {
    expect(column("organizations", "id")).toMatchObject({
      columnType: "PgUUID",
      primary: true,
      hasDefault: true,
    });
    expect(column("organizations", "name").notNull).toBe(true);
    expect(foreignKeys("organizations")).toEqual([]);
  });

  it("profiles: el PK es el id de auth.users", () => {
    expect(column("profiles", "id")).toMatchObject({
      columnType: "PgUUID",
      primary: true,
      hasDefault: false,
    });
    expect(foreignKeys("profiles")).toEqual([
      "id -> auth.users(id) ON DELETE cascade",
    ]);
  });

  it("organizations y profiles no tienen organization_id", () => {
    for (const name of NOT_TENANT_OWNED) {
      expect(table(name).columns.map((c) => c.name)).not.toContain(
        "organization_id",
      );
    }
  });

  it("memberships: FKs a organizations y profiles, unique e índice por usuario", () => {
    expect(column("memberships", "organization_id").notNull).toBe(true);
    expect(column("memberships", "user_id").notNull).toBe(true);
    expect(foreignKeys("memberships")).toEqual([
      "organization_id -> public.organizations(id) ON DELETE restrict",
      "user_id -> public.profiles(id) ON DELETE cascade",
    ]);
    expect(
      table("memberships").uniqueConstraints.map((u) => ({
        name: u.name,
        columns: u.columns.map((c) => c.name),
      })),
    ).toEqual([
      {
        name: "memberships_organization_id_user_id_key",
        columns: ["organization_id", "user_id"],
      },
    ]);
    expect(
      table("memberships").indexes.map((i) => ({
        name: i.config.name,
        unique: i.config.unique,
        columns: i.config.columns.map((c) => ("name" in c ? c.name : c)),
      })),
    ).toEqual([
      { name: "memberships_user_id_idx", unique: false, columns: ["user_id"] },
    ]);
  });

  it("role: enum membership_role (admin | seller), obligatorio y sin default", () => {
    expect(schema.membershipRole.enumName).toBe("membership_role");
    expect(schema.membershipRole.enumValues).toEqual(["admin", "seller"]);
    expect(column("memberships", "role")).toMatchObject({
      columnType: "PgEnumColumn",
      notNull: true,
      hasDefault: false,
      enumValues: ["admin", "seller"],
    });
  });

  it("toda tabla tenant-scoped tiene organization_id NOT NULL, FK e índice que empieza por él", () => {
    const tenantScoped = tables.filter(
      (t) => !NOT_TENANT_OWNED.includes(t.name),
    );
    expect(tenantScoped.map((t) => t.name)).toEqual(["memberships"]);

    for (const t of tenantScoped) {
      expect(column(t.name, "organization_id").notNull).toBe(true);
      expect(foreignKeys(t.name)).toContain(
        "organization_id -> public.organizations(id) ON DELETE restrict",
      );
      const leading = [
        ...t.indexes.map((i) => i.config.columns[0]),
        ...t.uniqueConstraints.map((u) => u.columns[0]),
      ].map((c) => (c && "name" in c ? c.name : undefined));
      expect(leading).toContain("organization_id");
    }
  });
});

describe("db/migrations", () => {
  it("la última migración está al día con el schema (sin cambios pendientes)", async () => {
    const migrations = new URL("../../../db/migrations/", import.meta.url);
    const journal = JSON.parse(
      readFileSync(new URL("meta/_journal.json", migrations), "utf8"),
    ) as { entries: { idx: number; tag: string }[] };
    expect(journal.entries[0]?.tag).toBe("0000_saas_core_schema");
    const latest = journal.entries.at(-1);

    const snapshotFile = `meta/${String(latest?.idx).padStart(4, "0")}_snapshot.json`;
    const snapshot = JSON.parse(
      readFileSync(new URL(snapshotFile, migrations), "utf8"),
    ) as Parameters<typeof generateMigration>[0] & { id: string };

    const current = generateDrizzleJson(schema, snapshot.id);
    expect(await generateMigration(snapshot, current)).toEqual([]);
  });
});
