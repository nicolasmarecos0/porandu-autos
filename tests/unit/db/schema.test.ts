import { readFileSync } from "node:fs";

import { generateDrizzleJson, generateMigration } from "drizzle-kit/api";
import { is } from "drizzle-orm";
import {
  getTableConfig,
  PgDialect,
  PgRole,
  PgTable,
} from "drizzle-orm/pg-core";
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
  it("define las tablas de H0, las de H1.1 (contacts, opportunities) y la de H1.3A (vehicles)", () => {
    expect(tables.map((t) => t.name).sort()).toEqual([
      "contacts",
      "memberships",
      "opportunities",
      "organizations",
      "profiles",
      "vehicles",
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

  it("profiles: el PK es el id de auth.users y full_name es opcional", () => {
    expect(column("profiles", "id")).toMatchObject({
      columnType: "PgUUID",
      primary: true,
      hasDefault: false,
    });
    expect(foreignKeys("profiles")).toEqual([
      "id -> auth.users(id) ON DELETE cascade",
    ]);
    expect(column("profiles", "full_name")).toMatchObject({
      notNull: false,
      hasDefault: false,
    });
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

  it("cada tabla declara su policy de lectura para authenticated y solo contacts, opportunities y vehicles, la de alta con WITH CHECK (ADR-001 §4)", () => {
    const dialect = new PgDialect();
    const declared = tables
      .flatMap((t) =>
        t.policies.map((p) => ({
          table: t.name,
          name: p.name,
          as: p.as ?? "permissive",
          for: p.for,
          to: [p.to].flat().map((r) => (is(r, PgRole) ? r.name : r)),
          using: p.using && dialect.sqlToQuery(p.using).sql,
          withCheck: p.withCheck && dialect.sqlToQuery(p.withCheck).sql,
        })),
      )
      .sort(
        (a, b) =>
          a.table.localeCompare(b.table) || a.name.localeCompare(b.name),
      );

    expect(declared).toEqual([
      {
        table: "contacts",
        name: "contacts_insert_member",
        as: "permissive",
        for: "insert",
        to: ["authenticated"],
        using: undefined,
        withCheck:
          '"contacts"."organization_id" IN (SELECT private.user_org_ids())',
      },
      {
        table: "contacts",
        name: "contacts_select_member",
        as: "permissive",
        for: "select",
        to: ["authenticated"],
        using:
          '"contacts"."organization_id" IN (SELECT private.user_org_ids())',
        withCheck: undefined,
      },
      {
        table: "memberships",
        name: "memberships_select_member",
        as: "permissive",
        for: "select",
        to: ["authenticated"],
        using:
          '"memberships"."organization_id" IN (SELECT private.user_org_ids())',
        withCheck: undefined,
      },
      {
        table: "opportunities",
        name: "opportunities_insert_member",
        as: "permissive",
        for: "insert",
        to: ["authenticated"],
        using: undefined,
        withCheck: `"opportunities"."organization_id" IN (SELECT private.user_org_ids()) AND "opportunities"."stage" = 'new'`,
      },
      {
        table: "opportunities",
        name: "opportunities_select_member",
        as: "permissive",
        for: "select",
        to: ["authenticated"],
        using:
          '"opportunities"."organization_id" IN (SELECT private.user_org_ids())',
        withCheck: undefined,
      },
      {
        table: "organizations",
        name: "organizations_select_member",
        as: "permissive",
        for: "select",
        to: ["authenticated"],
        using: '"organizations"."id" IN (SELECT private.user_org_ids())',
        withCheck: undefined,
      },
      {
        table: "profiles",
        name: "profiles_select_own",
        as: "permissive",
        for: "select",
        to: ["authenticated"],
        using: '"profiles"."id" = (select auth.uid())',
        withCheck: undefined,
      },
      {
        table: "vehicles",
        name: "vehicles_insert_member",
        as: "permissive",
        for: "insert",
        to: ["authenticated"],
        using: undefined,
        withCheck: `"vehicles"."organization_id" IN (SELECT private.user_org_ids()) AND "vehicles"."status" = 'in_preparation'`,
      },
      {
        table: "vehicles",
        name: "vehicles_select_member",
        as: "permissive",
        for: "select",
        to: ["authenticated"],
        using:
          '"vehicles"."organization_id" IN (SELECT private.user_org_ids())',
        withCheck: undefined,
      },
    ]);
  });

  it("contacts: nombre obligatorio, teléfono (original y E.164) y ciudad opcionales, unique para la FK compuesta", () => {
    expect(
      table("contacts").columns.map((c) => [c.name, c.notNull, c.hasDefault]),
    ).toEqual([
      ["id", true, true],
      ["organization_id", true, false],
      ["name", true, false],
      ["phone", false, false],
      ["phone_normalized", false, false],
      ["city", false, false],
      ["created_at", true, true],
      ["updated_at", true, true],
    ]);
    expect(foreignKeys("contacts")).toEqual([
      "organization_id -> public.organizations(id) ON DELETE restrict",
    ]);
    expect(
      table("contacts").uniqueConstraints.map((u) => ({
        name: u.name,
        columns: u.columns.map((c) => c.name),
      })),
    ).toEqual([
      {
        name: "contacts_organization_id_id_key",
        columns: ["organization_id", "id"],
      },
    ]);
    // H1.2: identidad por teléfono, única por organización (no global) y
    // solo para los contactos con teléfono normalizado.
    const dialect = new PgDialect();
    expect(
      table("contacts").indexes.map((i) => ({
        name: i.config.name,
        unique: i.config.unique,
        columns: i.config.columns.map((c) => ("name" in c ? c.name : c)),
        where: i.config.where && dialect.sqlToQuery(i.config.where).sql,
      })),
    ).toEqual([
      {
        name: "contacts_organization_id_phone_normalized_key",
        unique: true,
        columns: ["organization_id", "phone_normalized"],
        where: '"contacts"."phone_normalized" IS NOT NULL',
      },
    ]);
    expect(
      table("contacts").checks.map((c) => ({
        name: c.name,
        sql: dialect.sqlToQuery(c.value).sql,
      })),
    ).toEqual([
      {
        name: "contacts_phone_normalized_check",
        sql: `"contacts"."phone_normalized" IS NULL OR ("contacts"."phone" IS NOT NULL AND "contacts"."phone_normalized" ~ '^\\+[1-9][0-9]{1,14}$')`,
      },
    ]);
  });

  it("opportunities: contacto de la misma organización, stage y source con CHECK, sin persistir inteligencia", () => {
    expect(
      table("opportunities").columns.map((c) => [
        c.name,
        c.notNull,
        c.hasDefault,
      ]),
    ).toEqual([
      ["id", true, true],
      ["organization_id", true, false],
      ["contact_id", true, false],
      ["stage", true, false],
      ["source", true, false],
      ["interest_model", false, false],
      ["interest_version", false, false],
      ["last_activity_at", true, true],
      ["created_at", true, true],
      ["updated_at", true, true],
    ]);
    expect(foreignKeys("opportunities")).toEqual([
      "organization_id -> public.organizations(id) ON DELETE restrict",
      "organization_id,contact_id -> public.contacts(organization_id,id) ON DELETE restrict",
    ]);
    const dialect = new PgDialect();
    expect(
      table("opportunities").checks.map((c) => ({
        name: c.name,
        sql: dialect.sqlToQuery(c.value).sql,
      })),
    ).toEqual([
      {
        name: "opportunities_stage_check",
        sql: `"opportunities"."stage" IN ('new', 'qualified', 'test_drive', 'negotiation')`,
      },
      {
        name: "opportunities_source_check",
        sql: `"opportunities"."source" IN ('whatsapp', 'meta_ads', 'web', 'showroom', 'referral')`,
      },
    ]);
    expect(schema.opportunityStages).toEqual([
      "new",
      "qualified",
      "test_drive",
      "negotiation",
    ]);
    expect(
      table("opportunities").indexes.map((i) => ({
        name: i.config.name,
        columns: i.config.columns.map((c) => ("name" in c ? c.name : c)),
      })),
    ).toEqual([
      {
        name: "opportunities_organization_id_last_activity_at_idx",
        columns: ["organization_id", "last_activity_at"],
      },
      {
        name: "opportunities_organization_id_contact_id_idx",
        columns: ["organization_id", "contact_id"],
      },
    ]);
    // H1.1: scores, urgencia, NBA, señales, matches, trade-in y responsable
    // no tienen fuente todavía y no se persisten.
    const names = table("opportunities").columns.map((c) => c.name);
    for (const absent of [
      "score",
      "porandu_score",
      "bucket",
      "urgency",
      "assigned_user_id",
      "nba",
      "drivers",
    ]) {
      expect(names).not.toContain(absent);
    }
  });

  it("vehicles: identificación, año y estado obligatorios; precio exacto con su moneda; sin datos sin fuente", () => {
    expect(
      table("vehicles").columns.map((c) => [
        c.name,
        c.columnType,
        c.notNull,
        c.hasDefault,
      ]),
    ).toEqual([
      ["id", "PgUUID", true, true],
      ["organization_id", "PgUUID", true, false],
      ["brand", "PgText", true, false],
      ["model", "PgText", true, false],
      ["version", "PgText", false, false],
      ["year", "PgSmallInt", true, false],
      ["km", "PgInteger", false, false],
      // Exacto: Drizzle lo lee como texto, nunca como float.
      ["price", "PgNumeric", false, false],
      ["currency", "PgText", false, false],
      ["status", "PgText", true, false],
      ["created_at", "PgTimestamp", true, true],
      ["updated_at", "PgTimestamp", true, true],
    ]);
    expect(column("vehicles", "price")).toMatchObject({
      precision: 14,
      scale: 2,
    });
    expect(foreignKeys("vehicles")).toEqual([
      "organization_id -> public.organizations(id) ON DELETE restrict",
    ]);
    const dialect = new PgDialect();
    expect(
      table("vehicles").checks.map((c) => ({
        name: c.name,
        sql: dialect.sqlToQuery(c.value).sql,
      })),
    ).toEqual([
      {
        name: "vehicles_status_check",
        sql: `"vehicles"."status" IN ('in_preparation', 'available', 'reserved', 'sold')`,
      },
      {
        name: "vehicles_currency_check",
        sql: `"vehicles"."currency" IN ('PYG', 'USD')`,
      },
      {
        name: "vehicles_price_check",
        sql: `("vehicles"."price" IS NULL) = ("vehicles"."currency" IS NULL) AND ("vehicles"."price" IS NULL OR ("vehicles"."price" > 0 AND ("vehicles"."currency" <> 'PYG' OR "vehicles"."price" = trunc("vehicles"."price"))))`,
      },
      {
        name: "vehicles_year_check",
        sql: `"vehicles"."year" BETWEEN 1900 AND 2100`,
      },
      {
        name: "vehicles_km_check",
        sql: `"vehicles"."km" IS NULL OR "vehicles"."km" >= 0`,
      },
    ]);
    expect(schema.vehicleStatuses).toEqual([
      "in_preparation",
      "available",
      "reserved",
      "sold",
    ]);
    expect(schema.vehicleCurrencies).toEqual(["PYG", "USD"]);
    expect(
      table("vehicles").indexes.map((i) => ({
        name: i.config.name,
        columns: i.config.columns.map((c) => ("name" in c ? c.name : c)),
      })),
    ).toEqual([
      {
        name: "vehicles_organization_id_created_at_idx",
        columns: ["organization_id", "created_at"],
      },
    ]);
    // H1.3A y H1.3B: fotos, sucursal, matches, interesados, trade-in,
    // entrega y datos técnicos no tienen fuente ni consumidor todavía.
    const names = table("vehicles").columns.map((c) => c.name);
    for (const absent of [
      "branch_id",
      "photo_url",
      "image",
      "match_count",
      "interested",
      "source_trade_in",
      "min_down_payment",
      "transmission",
      "fuel",
      "color",
      "vin",
      "plate",
    ]) {
      expect(names).not.toContain(absent);
    }
  });

  it("toda tabla tenant-scoped tiene organization_id NOT NULL, FK e índice que empieza por él", () => {
    const tenantScoped = tables.filter(
      (t) => !NOT_TENANT_OWNED.includes(t.name),
    );
    expect(tenantScoped.map((t) => t.name).sort()).toEqual([
      "contacts",
      "memberships",
      "opportunities",
      "vehicles",
    ]);

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
