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
import {
  CONVERSATION_CHANNELS,
  CONVERSATION_STATUSES,
  MESSAGE_PREVIEW_MAX_LENGTH,
} from "@/domains/conversations/conversations";
import { DELIVERY_STATUSES as MESSAGE_DELIVERY_STATUSES } from "@/domains/conversations/delivery";
import {
  MESSAGE_CHANNELS,
  MESSAGE_DIRECTIONS,
  MESSAGE_MAX_LENGTH,
} from "@/domains/conversations/messages";
import { DEMAND_FACTS, PURCHASE_TYPES } from "@/domains/demand/facts";
import {
  DEMAND_FACT_STATUSES,
  IMPLEMENTED_SOURCE_KINDS,
} from "@/domains/demand/resolver";
import { CURRENCIES } from "@/domains/money";
import {
  DELIVERY_CHECKLIST_ITEMS,
  DELIVERY_RECORD_STATUSES,
} from "@/domains/opportunities/deliveries";
import {
  DELIVERY_DATE_RANGE,
  DELIVERY_STATUSES,
  LOSS_NOTES_MAX_LENGTH,
  LOSS_REASONS,
  PAYMENT_METHODS,
} from "@/domains/opportunities/closure";
import { NOTE_MAX_LENGTH } from "@/domains/opportunities/notes";
import { OPPORTUNITY_STAGES } from "@/domains/opportunities/stages";
import {
  ACTIVE_TRADE_IN_STATUSES,
  TRADE_IN_MAX_LENGTH,
  TRADE_IN_OPEN_STAGES,
  TRADE_IN_STATUSES,
} from "@/domains/opportunities/trade-ins";
import { VEHICLE_HOLDING_STAGES } from "@/domains/opportunities/vehicle-link";
import { EXTERNAL_ID_MAX_LENGTH } from "@/domains/webhooks/inbound-message";

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
  it("define las tablas de H0, las de H1.1 (contacts, opportunities), la de H1.3A (vehicles), la de H1.4 (opportunity_demand_facts), la del Hito 2 (opportunity_notes), la del Hito 4 (messages), las del Hito 7 (conversations, whatsapp_lines), la del Hito 9 (test_drives), la del Hito 10 (quotes), la del Hito 12B (conversation_reads), la del Hito 12C (message_statuses), la del Hito 20 (trade_ins) y la del Hito 21 (deliveries)", () => {
    expect(tables.map((t) => t.name).sort()).toEqual([
      "contacts",
      "conversation_reads",
      "conversations",
      "deliveries",
      "memberships",
      "message_statuses",
      "messages",
      "opportunities",
      "opportunity_demand_facts",
      "opportunity_notes",
      "organizations",
      "profiles",
      "quotes",
      "test_drives",
      "trade_ins",
      "vehicles",
      "whatsapp_lines",
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

  it("cada tabla declara su policy de lectura para authenticated (whatsapp_lines desde el Hito 8, DEC-040 §4; conversation_reads, solo las filas propias, desde el Hito 12B; message_statuses desde el Hito 12C) y solo contacts, opportunities, vehicles, opportunity_demand_facts, opportunity_notes, messages, memberships (admin), test_drives (Hito 9), quotes (Hito 10), trade_ins (Hito 20) y deliveries (Hito 21) la de alta con WITH CHECK (ADR-001 §4)", () => {
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
        // Hito 12B (DEC-044 §2.9): solo las filas propias, de las
        // organizaciones con membership activa.
        table: "conversation_reads",
        name: "conversation_reads_select_own",
        as: "permissive",
        for: "select",
        to: ["authenticated"],
        using:
          '"conversation_reads"."organization_id" IN (SELECT private.user_org_ids()) AND "conversation_reads"."user_id" = (select auth.uid())',
        withCheck: undefined,
      },
      {
        table: "conversations",
        name: "conversations_select_member",
        as: "permissive",
        for: "select",
        to: ["authenticated"],
        using:
          '"conversations"."organization_id" IN (SELECT private.user_org_ids())',
        withCheck: undefined,
      },
      {
        table: "deliveries",
        name: "deliveries_insert_member",
        as: "permissive",
        for: "insert",
        to: ["authenticated"],
        using: undefined,
        withCheck:
          '"deliveries"."organization_id" IN (SELECT private.user_org_ids()) AND "deliveries"."created_by" = (select auth.uid()) AND "deliveries"."status" = \'pending\' AND "deliveries"."completed_at" IS NULL AND "deliveries"."completed_by" IS NULL AND "deliveries"."checklist" = \'{"keys":false,"manuals":false,"spare_tire":false,"cleaning":false,"documents":false}\'::jsonb AND "deliveries"."created_at" = now() AND "deliveries"."updated_at" = now() AND EXISTS (SELECT FROM "opportunities" WHERE "opportunities"."organization_id" = "deliveries"."organization_id" AND "opportunities"."id" = "deliveries"."opportunity_id" AND "opportunities"."stage" = \'won\' AND "opportunities"."vehicle_id" = "deliveries"."vehicle_id") AND EXISTS (SELECT FROM "vehicles" WHERE "vehicles"."organization_id" = "deliveries"."organization_id" AND "vehicles"."id" = "deliveries"."vehicle_id" AND "vehicles"."status" = \'sold\')',
      },
      {
        table: "deliveries",
        name: "deliveries_select_member",
        as: "permissive",
        for: "select",
        to: ["authenticated"],
        using:
          '"deliveries"."organization_id" IN (SELECT private.user_org_ids())',
        withCheck: undefined,
      },
      {
        table: "deliveries",
        name: "deliveries_update_member",
        as: "permissive",
        for: "update",
        to: ["authenticated"],
        using:
          '"deliveries"."organization_id" IN (SELECT private.user_org_ids())',
        withCheck:
          '"deliveries"."organization_id" IN (SELECT private.user_org_ids())',
      },
      {
        table: "memberships",
        name: "memberships_insert_admin",
        as: "permissive",
        for: "insert",
        to: ["authenticated"],
        using: undefined,
        withCheck:
          '"memberships"."organization_id" IN (SELECT private.user_admin_org_ids()) AND "memberships"."active" AND "memberships"."created_at" = now() AND "memberships"."updated_at" = now()',
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
        table: "memberships",
        name: "memberships_update_admin",
        as: "permissive",
        for: "update",
        to: ["authenticated"],
        using:
          '"memberships"."organization_id" IN (SELECT private.user_admin_org_ids())',
        withCheck:
          '"memberships"."organization_id" IN (SELECT private.user_admin_org_ids())',
      },
      {
        // Hito 12C (DEC-044 §3.3): lectura de los miembros; la escribe la
        // función de ingesta de estados.
        table: "message_statuses",
        name: "message_statuses_select_member",
        as: "permissive",
        for: "select",
        to: ["authenticated"],
        using:
          '"message_statuses"."organization_id" IN (SELECT private.user_org_ids())',
        withCheck: undefined,
      },
      {
        table: "messages",
        name: "messages_insert_member",
        as: "permissive",
        for: "insert",
        to: ["authenticated"],
        using: undefined,
        withCheck: `"messages"."organization_id" IN (SELECT private.user_org_ids()) AND "messages"."recorded_by" = (select auth.uid()) AND "messages"."created_at" = now() AND "messages"."conversation_id" IS NULL`,
      },
      {
        table: "messages",
        name: "messages_select_member",
        as: "permissive",
        for: "select",
        to: ["authenticated"],
        using:
          '"messages"."organization_id" IN (SELECT private.user_org_ids())',
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
        table: "opportunities",
        name: "opportunities_update_stage",
        as: "permissive",
        for: "update",
        to: ["authenticated"],
        using:
          '"opportunities"."organization_id" IN (SELECT private.user_org_ids())',
        withCheck:
          '"opportunities"."organization_id" IN (SELECT private.user_org_ids())',
      },
      {
        table: "opportunity_demand_facts",
        name: "opportunity_demand_facts_insert_member",
        as: "permissive",
        for: "insert",
        to: ["authenticated"],
        using: undefined,
        withCheck: `"opportunity_demand_facts"."organization_id" IN (SELECT private.user_org_ids()) AND "opportunity_demand_facts"."source_kind" = 'member' AND "opportunity_demand_facts"."status" IN ('confirmed', 'corrected', 'rejected') AND "opportunity_demand_facts"."recorded_by" = (select auth.uid()) AND "opportunity_demand_facts"."recorded_at" = now()`,
      },
      {
        table: "opportunity_demand_facts",
        name: "opportunity_demand_facts_select_member",
        as: "permissive",
        for: "select",
        to: ["authenticated"],
        using:
          '"opportunity_demand_facts"."organization_id" IN (SELECT private.user_org_ids())',
        withCheck: undefined,
      },
      {
        table: "opportunity_notes",
        name: "opportunity_notes_insert_member",
        as: "permissive",
        for: "insert",
        to: ["authenticated"],
        using: undefined,
        withCheck: `"opportunity_notes"."organization_id" IN (SELECT private.user_org_ids()) AND "opportunity_notes"."recorded_by" = (select auth.uid()) AND "opportunity_notes"."recorded_at" = now()`,
      },
      {
        table: "opportunity_notes",
        name: "opportunity_notes_select_member",
        as: "permissive",
        for: "select",
        to: ["authenticated"],
        using:
          '"opportunity_notes"."organization_id" IN (SELECT private.user_org_ids())',
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
        table: "organizations",
        name: "organizations_update_admin",
        as: "permissive",
        for: "update",
        to: ["authenticated"],
        using: '"organizations"."id" IN (SELECT private.user_admin_org_ids())',
        withCheck:
          '"organizations"."id" IN (SELECT private.user_admin_org_ids())',
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
        table: "quotes",
        name: "quotes_insert_member",
        as: "permissive",
        for: "insert",
        to: ["authenticated"],
        using: undefined,
        withCheck:
          '"quotes"."organization_id" IN (SELECT private.user_org_ids()) AND "quotes"."created_by" = (select auth.uid()) AND "quotes"."status" = \'draft\' AND "quotes"."approved_by" IS NULL AND "quotes"."approved_at" IS NULL AND "quotes"."sent_at" IS NULL AND "quotes"."decided_at" IS NULL AND "quotes"."created_at" = now() AND "quotes"."updated_at" = now() AND EXISTS (SELECT FROM "opportunities" WHERE "opportunities"."organization_id" = "quotes"."organization_id" AND "opportunities"."id" = "quotes"."opportunity_id" AND "opportunities"."stage" IN (\'qualifying\', \'negotiating\')) AND EXISTS (SELECT FROM "vehicles" WHERE "vehicles"."organization_id" = "quotes"."organization_id" AND "vehicles"."id" = "quotes"."vehicle_id" AND "vehicles"."status" IN (\'available\', \'reserved\') AND "vehicles"."price" = "quotes"."list_price" AND "vehicles"."currency" = "quotes"."currency")',
      },
      {
        table: "quotes",
        name: "quotes_select_member",
        as: "permissive",
        for: "select",
        to: ["authenticated"],
        using: '"quotes"."organization_id" IN (SELECT private.user_org_ids())',
        withCheck: undefined,
      },
      {
        table: "quotes",
        name: "quotes_update_member",
        as: "permissive",
        for: "update",
        to: ["authenticated"],
        using: '"quotes"."organization_id" IN (SELECT private.user_org_ids())',
        withCheck:
          '"quotes"."organization_id" IN (SELECT private.user_org_ids())',
      },
      {
        table: "test_drives",
        name: "test_drives_insert_member",
        as: "permissive",
        for: "insert",
        to: ["authenticated"],
        using: undefined,
        withCheck:
          '"test_drives"."organization_id" IN (SELECT private.user_org_ids()) AND "test_drives"."created_by" = (select auth.uid()) AND "test_drives"."status" = \'scheduled\' AND "test_drives"."created_at" = now() AND "test_drives"."updated_at" = now() AND "test_drives"."scheduled_at" >= now() - interval \'5 minutes\'',
      },
      {
        table: "test_drives",
        name: "test_drives_select_member",
        as: "permissive",
        for: "select",
        to: ["authenticated"],
        using:
          '"test_drives"."organization_id" IN (SELECT private.user_org_ids())',
        withCheck: undefined,
      },
      {
        table: "test_drives",
        name: "test_drives_update_member",
        as: "permissive",
        for: "update",
        to: ["authenticated"],
        using:
          '"test_drives"."organization_id" IN (SELECT private.user_org_ids())',
        withCheck:
          '"test_drives"."organization_id" IN (SELECT private.user_org_ids())',
      },
      {
        table: "trade_ins",
        name: "trade_ins_insert_member",
        as: "permissive",
        for: "insert",
        to: ["authenticated"],
        using: undefined,
        withCheck:
          '"trade_ins"."organization_id" IN (SELECT private.user_org_ids()) AND "trade_ins"."created_by" = (select auth.uid()) AND "trade_ins"."status" = \'pending\' AND "trade_ins"."currency" IS NULL AND "trade_ins"."estimated_repair_cost" IS NULL AND "trade_ins"."offer_price" IS NULL AND "trade_ins"."appraised_by" IS NULL AND "trade_ins"."appraised_at" IS NULL AND "trade_ins"."converted_vehicle_id" IS NULL AND "trade_ins"."created_at" = now() AND "trade_ins"."updated_at" = now() AND EXISTS (SELECT FROM "opportunities" WHERE "opportunities"."organization_id" = "trade_ins"."organization_id" AND "opportunities"."id" = "trade_ins"."opportunity_id" AND "opportunities"."stage" IN (\'new\', \'qualifying\', \'negotiating\'))',
      },
      {
        table: "trade_ins",
        name: "trade_ins_select_member",
        as: "permissive",
        for: "select",
        to: ["authenticated"],
        using:
          '"trade_ins"."organization_id" IN (SELECT private.user_org_ids())',
        withCheck: undefined,
      },
      {
        table: "trade_ins",
        name: "trade_ins_update_member",
        as: "permissive",
        for: "update",
        to: ["authenticated"],
        using:
          '"trade_ins"."organization_id" IN (SELECT private.user_org_ids())',
        withCheck:
          '"trade_ins"."organization_id" IN (SELECT private.user_org_ids())',
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
      {
        table: "vehicles",
        name: "vehicles_update_status",
        as: "permissive",
        for: "update",
        to: ["authenticated"],
        using:
          '"vehicles"."organization_id" IN (SELECT private.user_org_ids())',
        withCheck:
          '"vehicles"."organization_id" IN (SELECT private.user_org_ids())',
      },
      {
        table: "whatsapp_lines",
        name: "whatsapp_lines_select_member",
        as: "permissive",
        for: "select",
        to: ["authenticated"],
        using:
          '"whatsapp_lines"."organization_id" IN (SELECT private.user_org_ids())',
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
      ["loss_reason", false, false],
      ["vehicle_id", false, false],
      ["loss_notes", false, false],
      ["sale_price", false, false],
      ["sale_currency", false, false],
      ["payment_method", false, false],
      ["delivery_status", false, false],
      ["delivery_date", false, false],
      ["interest_model", false, false],
      ["interest_version", false, false],
      ["last_activity_at", true, true],
      ["created_at", true, true],
      ["updated_at", true, true],
    ]);
    expect(foreignKeys("opportunities")).toEqual([
      "organization_id -> public.organizations(id) ON DELETE restrict",
      "organization_id,contact_id -> public.contacts(organization_id,id) ON DELETE restrict",
      "organization_id,vehicle_id -> public.vehicles(organization_id,id) ON DELETE restrict",
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
        sql: `"opportunities"."stage" IN ('new', 'qualifying', 'negotiating', 'won', 'lost')`,
      },
      {
        name: "opportunities_source_check",
        sql: `"opportunities"."source" IN ('whatsapp', 'meta_ads', 'web', 'showroom', 'referral')`,
      },
      {
        name: "opportunities_loss_reason_check",
        sql: `"opportunities"."loss_reason" IN ('price', 'vehicle_unavailable', 'competitor', 'financing_rejected', 'ghosted', 'other')`,
      },
      {
        name: "opportunities_loss_reason_stage_check",
        sql: `("opportunities"."stage" = 'lost' AND "opportunities"."loss_reason" IS NOT NULL) OR ("opportunities"."stage" <> 'lost' AND "opportunities"."loss_reason" IS NULL)`,
      },
      {
        name: "opportunities_vehicle_stage_check",
        sql: `"opportunities"."vehicle_id" IS NULL OR "opportunities"."stage" IN ('negotiating', 'won', 'lost')`,
      },
      {
        name: "opportunities_loss_notes_check",
        sql: `char_length("opportunities"."loss_notes") BETWEEN 1 AND 500 AND "opportunities"."loss_notes" = btrim("opportunities"."loss_notes", ' ' || chr(10)) AND translate("opportunities"."loss_notes", chr(10), '') !~ '[[:cntrl:]]'`,
      },
      {
        name: "opportunities_loss_notes_stage_check",
        sql: `"opportunities"."loss_notes" IS NULL OR "opportunities"."stage" = 'lost'`,
      },
      {
        name: "opportunities_sale_currency_check",
        sql: `"opportunities"."sale_currency" IN ('PYG', 'USD')`,
      },
      {
        name: "opportunities_sale_price_check",
        sql: `("opportunities"."sale_price" IS NULL) = ("opportunities"."sale_currency" IS NULL) AND ("opportunities"."sale_price" IS NULL OR ("opportunities"."sale_price" > 0 AND ("opportunities"."sale_currency" <> 'PYG' OR "opportunities"."sale_price" = trunc("opportunities"."sale_price"))))`,
      },
      {
        name: "opportunities_payment_method_check",
        sql: `"opportunities"."payment_method" IN ('cash', 'financing', 'trade_in', 'mixed')`,
      },
      {
        name: "opportunities_delivery_status_check",
        sql: `"opportunities"."delivery_status" IN ('scheduled', 'delivered')`,
      },
      {
        name: "opportunities_delivery_date_check",
        sql: `"opportunities"."delivery_date" BETWEEN '2000-01-01' AND '2100-12-31'`,
      },
      {
        name: "opportunities_won_closure_check",
        sql: `("opportunities"."stage" = 'won' AND "opportunities"."vehicle_id" IS NOT NULL AND "opportunities"."sale_price" IS NOT NULL AND "opportunities"."sale_currency" IS NOT NULL AND "opportunities"."payment_method" IS NOT NULL AND "opportunities"."delivery_status" IS NOT NULL AND "opportunities"."delivery_date" IS NOT NULL) OR ("opportunities"."stage" <> 'won' AND "opportunities"."sale_price" IS NULL AND "opportunities"."sale_currency" IS NULL AND "opportunities"."payment_method" IS NULL AND "opportunities"."delivery_status" IS NULL AND "opportunities"."delivery_date" IS NULL)`,
      },
    ]);
    expect(schema.opportunityStages).toEqual([
      "new",
      "qualifying",
      "negotiating",
      "won",
      "lost",
    ]);
    expect(schema.opportunityLossReasons).toEqual([
      "price",
      "vehicle_unavailable",
      "competitor",
      "financing_rejected",
      "ghosted",
      "other",
    ]);
    // El schema y el dominio (H1.6, DEC-034) hablan de las mismas etapas,
    // motivos, formas de pago, estados de entrega, monedas y fechas.
    expect(schema.opportunityStages).toEqual([...OPPORTUNITY_STAGES]);
    expect(schema.opportunityLossReasons).toEqual([...LOSS_REASONS]);
    expect(schema.opportunityPaymentMethods).toEqual([...PAYMENT_METHODS]);
    expect(schema.opportunityDeliveryStatuses).toEqual([...DELIVERY_STATUSES]);
    expect(schema.opportunitySaleCurrencies).toEqual([...CURRENCIES]);
    expect(schema.opportunityDeliveryDateRange).toEqual(DELIVERY_DATE_RANGE);
    // El CHECK de las notas usa el mismo largo máximo que el dominio.
    expect(LOSS_NOTES_MAX_LENGTH).toBe(500);
    // Hito 2: la unidad vinculada existe en las mismas etapas en la base y
    // en el dominio.
    expect(schema.opportunityVehicleStages).toEqual([
      ...VEHICLE_HOLDING_STAGES,
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
      {
        name: "opportunities_organization_id_vehicle_id_idx",
        columns: ["organization_id", "vehicle_id"],
      },
      // DEC-043 §7: los cierres de un rango del Dashboard Directivo.
      {
        name: "opportunities_organization_id_closed_at_idx",
        columns: ["organization_id", "updated_at"],
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
        sql: `"vehicles"."status" IN ('in_preparation', 'available', 'reserved', 'sold', 'delivered')`,
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
      "delivered",
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
    // Hito 2: destino de la FK compuesta de la unidad vinculada.
    expect(
      table("vehicles").uniqueConstraints.map((u) => ({
        name: u.getName(),
        columns: u.columns.map((c) => c.name),
      })),
    ).toEqual([
      {
        name: "vehicles_organization_id_id_key",
        columns: ["organization_id", "id"],
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

  it("opportunity_demand_facts: ledger append-only con el contrato de demanda del dominio (H1.4)", () => {
    expect(
      table("opportunity_demand_facts").columns.map((c) => [
        c.name,
        c.columnType,
        c.notNull,
        c.hasDefault,
      ]),
    ).toEqual([
      ["id", "PgUUID", true, true],
      ["organization_id", "PgUUID", true, false],
      ["opportunity_id", "PgUUID", true, false],
      ["fact", "PgText", true, false],
      ["status", "PgText", true, false],
      ["source_kind", "PgText", true, false],
      ["recorded_by", "PgUUID", false, false],
      // Reloj de la base: `defaultNow()`, nunca `$defaultFn`.
      ["recorded_at", "PgTimestamp", true, true],
      ["target_fact_id", "PgUUID", false, false],
      ["previous_member_fact_id", "PgUUID", false, false],
      ["brand", "PgText", false, false],
      ["model", "PgText", false, false],
      ["year_min", "PgSmallInt", false, false],
      ["year_max", "PgSmallInt", false, false],
      ["amount", "PgNumeric", false, false],
      ["currency", "PgText", false, false],
      ["purchase_type", "PgText", false, false],
      ["trade_in", "PgBoolean", false, false],
      ["evidence_text", "PgText", false, false],
    ]);
    const recordedAt = column("opportunity_demand_facts", "recorded_at");
    expect(recordedAt.defaultFn).toBeUndefined();
    expect(recordedAt).toMatchObject({
      withTimezone: true,
      precision: undefined,
    });
    expect(column("opportunity_demand_facts", "amount")).toMatchObject({
      precision: 14,
      scale: 2,
    });
    expect(foreignKeys("opportunity_demand_facts")).toEqual([
      "organization_id -> public.organizations(id) ON DELETE restrict",
      "organization_id,opportunity_id -> public.opportunities(organization_id,id) ON DELETE restrict",
      "organization_id,opportunity_id,fact,source_kind,previous_member_fact_id -> public.opportunity_demand_facts(organization_id,opportunity_id,fact,source_kind,id) ON DELETE restrict",
      "organization_id,opportunity_id,fact,target_fact_id -> public.opportunity_demand_facts(organization_id,opportunity_id,fact,id) ON DELETE restrict",
      "recorded_by -> public.profiles(id) ON DELETE restrict",
    ]);
    expect(table("opportunity_demand_facts").checks.map((c) => c.name)).toEqual(
      [
        "opportunity_demand_facts_fact_check",
        "opportunity_demand_facts_status_check",
        "opportunity_demand_facts_source_kind_check",
        "opportunity_demand_facts_currency_check",
        "opportunity_demand_facts_purchase_type_check",
        "opportunity_demand_facts_value_check",
        "opportunity_demand_facts_status_target_check",
        "opportunity_demand_facts_source_status_check",
        "opportunity_demand_facts_member_author_check",
        "opportunity_demand_facts_member_chain_check",
        "opportunity_demand_facts_self_reference_check",
        "opportunity_demand_facts_text_check",
      ],
    );
    // Nombres de constraints e índices dentro del límite de PostgreSQL.
    for (const name of [
      ...table("opportunity_demand_facts").checks.map((c) => c.name),
      ...table("opportunity_demand_facts").indexes.map((i) => i.config.name),
      ...table("opportunity_demand_facts").uniqueConstraints.map((u) =>
        u.getName(),
      ),
      ...table("opportunity_demand_facts").foreignKeys.map((fk) =>
        fk.getName(),
      ),
    ]) {
      expect(Buffer.byteLength(name ?? "")).toBeLessThanOrEqual(63);
    }
    // El schema y el dominio comparten el contrato.
    expect(schema.demandFacts).toEqual(DEMAND_FACTS);
    expect(schema.demandFactStatuses).toEqual(DEMAND_FACT_STATUSES);
    expect(schema.demandSourceKinds).toEqual(IMPLEMENTED_SOURCE_KINDS);
    expect(schema.demandPurchaseTypes).toEqual(PURCHASE_TYPES);
    expect(schema.demandCurrencies).toEqual(CURRENCIES);
    expect(schema.demandMemberStatuses).toEqual([
      "confirmed",
      "corrected",
      "rejected",
    ]);
    // Sin Origin, confianza ni conversaciones en H1.4 (C-5, C-14).
    const names = table("opportunity_demand_facts").columns.map((c) => c.name);
    for (const absent of [
      "origin",
      "confidence",
      "basis",
      "observed_at",
      "message_id",
      "media_id",
      "version",
      "conversation",
      "updated_at",
    ]) {
      expect(names).not.toContain(absent);
    }
  });

  it("opportunity_notes: bitácora append-only, de la oportunidad y el autor, con el texto acotado (Hito 2)", () => {
    expect(
      table("opportunity_notes").columns.map((c) => [
        c.name,
        c.columnType,
        c.notNull,
        c.hasDefault,
      ]),
    ).toEqual([
      ["id", "PgUUID", true, true],
      ["organization_id", "PgUUID", true, false],
      ["opportunity_id", "PgUUID", true, false],
      ["body", "PgText", true, false],
      ["recorded_by", "PgUUID", true, false],
      ["recorded_at", "PgTimestamp", true, true],
    ]);
    // Reloj de la base, nunca de la aplicación.
    const recordedAt = column("opportunity_notes", "recorded_at");
    expect(recordedAt.defaultFn).toBeUndefined();
    expect(foreignKeys("opportunity_notes")).toEqual([
      "organization_id -> public.organizations(id) ON DELETE restrict",
      "organization_id,opportunity_id -> public.opportunities(organization_id,id) ON DELETE restrict",
      "recorded_by -> public.profiles(id) ON DELETE restrict",
    ]);
    const dialect = new PgDialect();
    expect(
      table("opportunity_notes").checks.map((c) => ({
        name: c.name,
        sql: dialect.sqlToQuery(c.value).sql,
      })),
    ).toEqual([
      {
        name: "opportunity_notes_body_check",
        sql: `char_length("opportunity_notes"."body") BETWEEN 1 AND 1000 AND "opportunity_notes"."body" = btrim("opportunity_notes"."body", ' ' || chr(10)) AND translate("opportunity_notes"."body", chr(10), '') !~ '[[:cntrl:]]'`,
      },
    ]);
    // El largo máximo de la base es el del dominio.
    expect(schema.opportunityNoteMaxLength).toBe(NOTE_MAX_LENGTH);
    expect(
      table("opportunity_notes").indexes.map((i) => ({
        name: i.config.name,
        columns: i.config.columns.map((c) => ("name" in c ? c.name : c)),
      })),
    ).toEqual([
      {
        name: "opportunity_notes_organization_id_opportunity_id_idx",
        columns: ["organization_id", "opportunity_id", "recorded_at"],
      },
    ]);
    // Append-only: no hay updated_at ni nada que se edite.
    expect(table("opportunity_notes").columns.map((c) => c.name)).not.toContain(
      "updated_at",
    );
  });

  it("messages: append-only, del contacto y opcionalmente de una oportunidad de ese contacto, con canal, dirección y texto acotados (Hito 4)", () => {
    expect(
      table("messages").columns.map((c) => [
        c.name,
        c.columnType,
        c.notNull,
        c.hasDefault,
      ]),
    ).toEqual([
      ["id", "PgUUID", true, true],
      ["organization_id", "PgUUID", true, false],
      ["contact_id", "PgUUID", true, false],
      ["opportunity_id", "PgUUID", false, false],
      ["channel", "PgText", true, false],
      ["direction", "PgText", true, false],
      ["content", "PgText", true, false],
      // Opcional desde el Hito 7: un mensaje ingerido no tiene autor.
      ["recorded_by", "PgUUID", false, false],
      ["created_at", "PgTimestamp", true, true],
      ["conversation_id", "PgUUID", false, false],
      ["external_id", "PgText", false, false],
      ["sent_at", "PgTimestamp", false, false],
    ]);
    // Reloj de la base, nunca de la aplicación.
    expect(column("messages", "created_at").defaultFn).toBeUndefined();
    expect(foreignKeys("messages")).toEqual([
      "organization_id -> public.organizations(id) ON DELETE restrict",
      "organization_id,contact_id -> public.contacts(organization_id,id) ON DELETE restrict",
      "organization_id,conversation_id,contact_id -> public.conversations(organization_id,id,contact_id) ON DELETE restrict",
      "organization_id,opportunity_id,contact_id -> public.opportunities(organization_id,id,contact_id) ON DELETE restrict",
      "recorded_by -> public.profiles(id) ON DELETE restrict",
    ]);
    const dialect = new PgDialect();
    expect(
      table("messages").checks.map((c) => ({
        name: c.name,
        sql: dialect.sqlToQuery(c.value).sql,
      })),
    ).toEqual([
      {
        name: "messages_channel_check",
        sql: `"messages"."channel" IN ('whatsapp', 'email', 'manual')`,
      },
      {
        name: "messages_direction_check",
        sql: `"messages"."direction" IN ('inbound', 'outbound')`,
      },
      {
        name: "messages_content_check",
        sql: `char_length("messages"."content") BETWEEN 1 AND 4096 AND "messages"."content" = btrim("messages"."content", ' ' || chr(10)) AND translate("messages"."content", chr(10), '') !~ '[[:cntrl:]]'`,
      },
      {
        name: "messages_external_id_check",
        sql: `char_length("messages"."external_id") BETWEEN 1 AND 256 AND "messages"."external_id" !~ '[[:space:][:cntrl:]]'`,
      },
      {
        // DEC-039 §10 y DEC-040 §7: o lo registró un miembro, o es un
        // WhatsApp entrante ingerido, o es un WhatsApp que envió un miembro.
        name: "messages_source_check",
        sql: `("messages"."recorded_by" IS NOT NULL AND "messages"."conversation_id" IS NULL AND "messages"."external_id" IS NULL AND "messages"."sent_at" IS NULL) OR ("messages"."recorded_by" IS NULL AND "messages"."conversation_id" IS NOT NULL AND "messages"."external_id" IS NOT NULL AND "messages"."sent_at" IS NOT NULL AND "messages"."channel" = 'whatsapp' AND "messages"."direction" = 'inbound') OR ("messages"."recorded_by" IS NOT NULL AND "messages"."conversation_id" IS NOT NULL AND "messages"."external_id" IS NOT NULL AND "messages"."sent_at" IS NOT NULL AND "messages"."channel" = 'whatsapp' AND "messages"."direction" = 'outbound')`,
      },
    ]);
    // Las listas y los largos máximos de la base son los del dominio.
    expect(schema.messageChannels).toEqual(MESSAGE_CHANNELS);
    expect(schema.messageDirections).toEqual(MESSAGE_DIRECTIONS);
    expect(schema.messageMaxLength).toBe(MESSAGE_MAX_LENGTH);
    expect(schema.messageExternalIdMaxLength).toBe(EXTERNAL_ID_MAX_LENGTH);
    expect(
      table("messages").indexes.map((i) => ({
        name: i.config.name,
        columns: i.config.columns.map((c) => ("name" in c ? c.name : c)),
      })),
    ).toEqual([
      // Idempotencia de la ingesta (DEC-039 §8), única y parcial.
      {
        name: "messages_organization_id_external_id_key",
        columns: ["organization_id", "external_id"],
      },
      {
        name: "messages_organization_id_opportunity_id_idx",
        columns: ["organization_id", "opportunity_id", "created_at"],
      },
      {
        name: "messages_organization_id_contact_id_idx",
        columns: ["organization_id", "contact_id", "created_at"],
      },
      // Los no leídos de la bandeja (DEC-044 §2.9), parcial sobre los
      // mensajes de una conversación.
      {
        name: "messages_organization_id_conversation_id_idx",
        columns: ["organization_id", "conversation_id", "created_at"],
      },
    ]);
    expect(
      table("messages")
        .indexes.filter(
          (i) =>
            i.config.name === "messages_organization_id_conversation_id_idx",
        )
        .map((i) => ({
          unique: i.config.unique,
          where: i.config.where && dialect.sqlToQuery(i.config.where).sql,
        })),
    ).toEqual([
      { unique: false, where: '"messages"."conversation_id" IS NOT NULL' },
    ]);
    // Destino de la FK compuesta de message_statuses (Hito 12C).
    expect(
      table("messages").uniqueConstraints.map((u) => ({
        name: u.getName(),
        columns: u.columns.map((c) => c.name),
      })),
    ).toEqual([
      {
        name: "messages_organization_id_id_key",
        columns: ["organization_id", "id"],
      },
    ]);
    // Append-only: no hay updated_at ni nada que se edite.
    expect(table("messages").columns.map((c) => c.name)).not.toContain(
      "updated_at",
    );
    // El estado de entrega no es una columna del mensaje (C-11, DEC-044
    // §3.3): vive en message_statuses.
    expect(table("messages").columns.map((c) => c.name)).not.toContain(
      "status",
    );
  });

  it("conversations: una abierta por contacto y canal, con el último mensaje en una línea (Hito 7)", () => {
    expect(
      table("conversations").columns.map((c) => [
        c.name,
        c.columnType,
        c.notNull,
        c.hasDefault,
      ]),
    ).toEqual([
      ["id", "PgUUID", true, true],
      ["organization_id", "PgUUID", true, false],
      ["contact_id", "PgUUID", true, false],
      ["channel", "PgText", true, false],
      ["status", "PgText", true, true],
      ["last_message_at", "PgTimestamp", false, false],
      ["last_message_preview", "PgText", false, false],
      ["created_at", "PgTimestamp", true, true],
      ["updated_at", "PgTimestamp", true, true],
    ]);
    expect(foreignKeys("conversations")).toEqual([
      "organization_id -> public.organizations(id) ON DELETE restrict",
      "organization_id,contact_id -> public.contacts(organization_id,id) ON DELETE restrict",
    ]);
    const dialect = new PgDialect();
    expect(
      table("conversations").checks.map((c) => ({
        name: c.name,
        sql: dialect.sqlToQuery(c.value).sql,
      })),
    ).toEqual([
      {
        name: "conversations_channel_check",
        sql: `"conversations"."channel" IN ('whatsapp')`,
      },
      {
        name: "conversations_status_check",
        sql: `"conversations"."status" IN ('open', 'closed')`,
      },
      {
        name: "conversations_last_message_check",
        sql: `("conversations"."last_message_at" IS NULL) = ("conversations"."last_message_preview" IS NULL)`,
      },
      {
        name: "conversations_last_message_preview_check",
        sql: `char_length("conversations"."last_message_preview") BETWEEN 1 AND 160 AND "conversations"."last_message_preview" = btrim("conversations"."last_message_preview") AND "conversations"."last_message_preview" !~ '[[:cntrl:]]'`,
      },
    ]);
    // Las listas y el largo del preview de la base son los del dominio.
    expect(schema.conversationChannels).toEqual(CONVERSATION_CHANNELS);
    expect(schema.conversationStatuses).toEqual(CONVERSATION_STATUSES);
    expect(schema.conversationPreviewMaxLength).toBe(
      MESSAGE_PREVIEW_MAX_LENGTH,
    );
    expect(
      table("conversations").indexes.map((i) => ({
        name: i.config.name,
        unique: i.config.unique,
        columns: i.config.columns.map((c) => ("name" in c ? c.name : c)),
        where: i.config.where && dialect.sqlToQuery(i.config.where).sql,
      })),
    ).toEqual([
      {
        name: "conversations_open_contact_channel_key",
        unique: true,
        columns: ["organization_id", "contact_id", "channel"],
        where: `"conversations"."status" = 'open'`,
      },
    ]);
    expect(
      table("conversations").uniqueConstraints.map((u) => ({
        name: u.getName(),
        columns: u.columns.map((c) => c.name),
      })),
    ).toEqual([
      {
        name: "conversations_organization_id_id_contact_id_key",
        columns: ["organization_id", "id", "contact_id"],
      },
      // Destino de la FK compuesta de conversation_reads (Hito 12B).
      {
        name: "conversations_organization_id_id_key",
        columns: ["organization_id", "id"],
      },
    ]);
  });

  it("conversation_reads: un cursor por miembro y conversación, de la misma organización, que solo leen sus dueños (Hito 12B)", () => {
    expect(
      table("conversation_reads").columns.map((c) => [
        c.name,
        c.columnType,
        c.notNull,
        c.hasDefault,
      ]),
    ).toEqual([
      ["organization_id", "PgUUID", true, false],
      ["conversation_id", "PgUUID", true, false],
      ["user_id", "PgUUID", true, false],
      ["read_up_to", "PgTimestamp", true, false],
      ["updated_at", "PgTimestamp", true, true],
    ]);
    // El cursor y su sello los pone la base (la función), nunca la app.
    expect(
      column("conversation_reads", "read_up_to").defaultFn,
    ).toBeUndefined();
    expect(
      column("conversation_reads", "updated_at").defaultFn,
    ).toBeUndefined();
    expect(
      table("conversation_reads").primaryKeys.map((pk) => ({
        name: pk.getName(),
        columns: pk.columns.map((c) => c.name),
      })),
    ).toEqual([
      {
        name: "conversation_reads_pkey",
        columns: ["organization_id", "conversation_id", "user_id"],
      },
    ]);
    // CASCADE al perfil: el cursor es estado del miembro, como memberships.
    expect(foreignKeys("conversation_reads")).toEqual([
      "organization_id -> public.organizations(id) ON DELETE restrict",
      "organization_id,conversation_id -> public.conversations(organization_id,id) ON DELETE restrict",
      "user_id -> public.profiles(id) ON DELETE cascade",
    ]);
    expect(table("conversation_reads").checks).toEqual([]);
    // Lectura de las filas propias; ninguna escritura de authenticated.
    expect(
      table("conversation_reads").policies.map((p) => `${p.name} ${p.for}`),
    ).toEqual(["conversation_reads_select_own select"]);
  });

  it("message_statuses: un estado de entrega por saliente y estado, append-only, de la misma organización y de solo lectura para los miembros (Hito 12C)", () => {
    expect(
      table("message_statuses").columns.map((c) => [
        c.name,
        c.columnType,
        c.notNull,
        c.hasDefault,
      ]),
    ).toEqual([
      ["organization_id", "PgUUID", true, false],
      ["message_id", "PgUUID", true, false],
      ["status", "PgText", true, false],
      ["occurred_at", "PgTimestamp", true, false],
      ["created_at", "PgTimestamp", true, true],
    ]);
    // Reloj de la base, nunca de la aplicación.
    expect(column("message_statuses", "created_at").defaultFn).toBeUndefined();
    // La PK es la autoridad de la idempotencia (DEC-044 §3.3).
    expect(
      table("message_statuses").primaryKeys.map((pk) => ({
        name: pk.getName(),
        columns: pk.columns.map((c) => c.name),
      })),
    ).toEqual([
      {
        name: "message_statuses_pkey",
        columns: ["organization_id", "message_id", "status"],
      },
    ]);
    expect(foreignKeys("message_statuses")).toEqual([
      "organization_id -> public.organizations(id) ON DELETE restrict",
      "organization_id,message_id -> public.messages(organization_id,id) ON DELETE restrict",
    ]);
    const dialect = new PgDialect();
    expect(
      table("message_statuses").checks.map((c) => ({
        name: c.name,
        sql: dialect.sqlToQuery(c.value).sql,
      })),
    ).toEqual([
      {
        name: "message_statuses_status_check",
        sql: `"message_statuses"."status" IN ('sent', 'delivered', 'read', 'failed')`,
      },
    ]);
    // Los estados de la base son los del dominio (DEC-044 §3.1).
    expect(schema.messageStatusValues).toEqual(MESSAGE_DELIVERY_STATUSES);
    // Lectura de los miembros; ninguna escritura de authenticated.
    expect(
      table("message_statuses").policies.map((p) => `${p.name} ${p.for}`),
    ).toEqual(["message_statuses_select_member select"]);
    // Append-only: no hay updated_at ni nada que se edite.
    expect(table("message_statuses").columns.map((c) => c.name)).not.toContain(
      "updated_at",
    );
  });

  it("trade_ins: la toma de una oportunidad con el usado, su tasación con moneda, el estado, los sellos y la unidad en la que se convirtió (Hito 20)", () => {
    expect(
      table("trade_ins").columns.map((c) => [
        c.name,
        c.columnType,
        c.notNull,
        c.hasDefault,
      ]),
    ).toEqual([
      ["id", "PgUUID", true, true],
      ["organization_id", "PgUUID", true, false],
      ["opportunity_id", "PgUUID", true, false],
      ["brand", "PgText", true, false],
      ["model", "PgText", true, false],
      ["version", "PgText", false, false],
      ["year", "PgSmallInt", true, false],
      ["km", "PgInteger", false, false],
      ["plate", "PgText", false, false],
      ["currency", "PgText", false, false],
      ["estimated_repair_cost", "PgNumeric", false, false],
      ["offer_price", "PgNumeric", false, false],
      ["status", "PgText", true, true],
      ["created_by", "PgUUID", true, false],
      ["appraised_by", "PgUUID", false, false],
      ["appraised_at", "PgTimestamp", false, false],
      ["converted_vehicle_id", "PgUUID", false, false],
      ["created_at", "PgTimestamp", true, true],
      ["updated_at", "PgTimestamp", true, true],
    ]);
    // Dinero exacto (DEC-025 §5): numeric(14, 2), nunca float.
    for (const name of ["offer_price", "estimated_repair_cost"]) {
      expect(column("trade_ins", name)).toMatchObject({
        precision: 14,
        scale: 2,
      });
    }
    // Los estados, las vigentes, las etapas abiertas, las monedas y los
    // largos de la base son los del dominio (DEC-052 §2).
    expect(schema.tradeInStatuses).toEqual(TRADE_IN_STATUSES);
    expect(schema.activeTradeInStatuses).toEqual(ACTIVE_TRADE_IN_STATUSES);
    expect(schema.tradeInOpenStages).toEqual(TRADE_IN_OPEN_STAGES);
    expect(schema.tradeInCurrencies).toEqual(CURRENCIES);
    expect(schema.tradeInMaxLength).toEqual(TRADE_IN_MAX_LENGTH);
    // Nace pendiente; los sellos y el reloj los pone la base.
    expect(column("trade_ins", "status").default).toBe("pending");
    expect(column("trade_ins", "created_at").defaultFn).toBeUndefined();
    expect(foreignKeys("trade_ins")).toEqual([
      "appraised_by -> public.profiles(id) ON DELETE restrict",
      "created_by -> public.profiles(id) ON DELETE restrict",
      "organization_id -> public.organizations(id) ON DELETE restrict",
      "organization_id,converted_vehicle_id -> public.vehicles(organization_id,id) ON DELETE restrict",
      "organization_id,opportunity_id -> public.opportunities(organization_id,id) ON DELETE restrict",
    ]);
    expect(table("trade_ins").checks.map((c) => c.name)).toEqual([
      "trade_ins_status_check",
      "trade_ins_currency_check",
      "trade_ins_brand_check",
      "trade_ins_model_check",
      "trade_ins_version_check",
      "trade_ins_year_check",
      "trade_ins_km_check",
      "trade_ins_plate_check",
      "trade_ins_offer_price_check",
      "trade_ins_repair_cost_check",
      "trade_ins_appraisal_check",
      "trade_ins_accepted_offer_check",
      "trade_ins_converted_check",
    ]);
    // Lectura, alta y una sola edición: qué cambio vale lo decide el
    // trigger de 0021 (DEC-028 §5).
    expect(
      table("trade_ins").policies.map((p) => `${p.name} ${p.for}`),
    ).toEqual([
      "trade_ins_select_member select",
      "trade_ins_insert_member insert",
      "trade_ins_update_member update",
    ]);
    expect(
      table("trade_ins").indexes.map((i) => ({
        name: i.config.name,
        unique: i.config.unique,
        columns: i.config.columns.map((c) => ("name" in c ? c.name : null)),
      })),
    ).toEqual([
      {
        name: "trade_ins_organization_id_opportunity_id_idx",
        unique: false,
        columns: ["organization_id", "opportunity_id"],
      },
      {
        name: "trade_ins_active_opportunity_key",
        unique: true,
        columns: ["organization_id", "opportunity_id"],
      },
    ]);
    expect(
      table("trade_ins").uniqueConstraints.map((u) => ({
        name: u.name,
        columns: u.columns.map((c) => c.name),
      })),
    ).toEqual([
      {
        name: "trade_ins_organization_id_converted_vehicle_id_key",
        columns: ["organization_id", "converted_vehicle_id"],
      },
    ]);
  });

  it("deliveries: la entrega de la unidad vendida de una oportunidad ganada, con su fecha pactada, el checklist físico, el estado, el autor y el sello (Hito 21)", () => {
    expect(
      table("deliveries").columns.map((c) => [
        c.name,
        c.columnType,
        c.notNull,
        c.hasDefault,
      ]),
    ).toEqual([
      ["id", "PgUUID", true, true],
      ["organization_id", "PgUUID", true, false],
      ["opportunity_id", "PgUUID", true, false],
      ["vehicle_id", "PgUUID", true, false],
      ["scheduled_at", "PgTimestamp", true, false],
      ["completed_at", "PgTimestamp", false, false],
      ["checklist", "PgJsonb", true, true],
      ["status", "PgText", true, true],
      ["created_by", "PgUUID", true, false],
      ["completed_by", "PgUUID", false, false],
      ["created_at", "PgTimestamp", true, true],
      ["updated_at", "PgTimestamp", true, true],
    ]);
    // Los estados y los ítems del checklist de la base son los del dominio
    // (DEC-053 §1; el dominio nombra el auxilio en camelCase).
    expect(schema.deliveryStatuses).toEqual(DELIVERY_RECORD_STATUSES);
    expect(schema.deliveryChecklistItems).toEqual(
      DELIVERY_CHECKLIST_ITEMS.map((item) =>
        item.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`),
      ),
    );
    // Nace pendiente; el sello y el reloj los pone la base.
    expect(column("deliveries", "status").default).toBe("pending");
    expect(column("deliveries", "created_at").defaultFn).toBeUndefined();
    expect(foreignKeys("deliveries")).toEqual([
      "completed_by -> public.profiles(id) ON DELETE restrict",
      "created_by -> public.profiles(id) ON DELETE restrict",
      "organization_id -> public.organizations(id) ON DELETE restrict",
      "organization_id,opportunity_id -> public.opportunities(organization_id,id) ON DELETE restrict",
      "organization_id,vehicle_id -> public.vehicles(organization_id,id) ON DELETE restrict",
    ]);
    expect(table("deliveries").checks.map((c) => c.name)).toEqual([
      "deliveries_status_check",
      "deliveries_checklist_check",
      "deliveries_completion_check",
      "deliveries_scheduled_at_check",
    ]);
    // Lectura, alta y una sola edición: qué cambio vale lo decide el
    // trigger de 0022 (DEC-028 §5).
    expect(
      table("deliveries").policies.map((p) => `${p.name} ${p.for}`),
    ).toEqual([
      "deliveries_select_member select",
      "deliveries_insert_member insert",
      "deliveries_update_member update",
    ]);
    expect(
      table("deliveries").uniqueConstraints.map((u) => ({
        name: u.name,
        columns: u.columns.map((c) => c.name),
      })),
    ).toEqual([
      {
        name: "deliveries_organization_id_opportunity_id_key",
        columns: ["organization_id", "opportunity_id"],
      },
      {
        name: "deliveries_organization_id_vehicle_id_key",
        columns: ["organization_id", "vehicle_id"],
      },
    ]);
  });

  it("whatsapp_lines: la línea receptora, única global, de una organización y de solo lectura para los miembros (Hito 7, Hito 8)", () => {
    expect(
      table("whatsapp_lines").columns.map((c) => [
        c.name,
        c.columnType,
        c.notNull,
        c.hasDefault,
      ]),
    ).toEqual([
      ["id", "PgUUID", true, true],
      ["organization_id", "PgUUID", true, false],
      ["phone_number_id", "PgText", true, false],
      ["active", "PgBoolean", true, true],
      ["created_at", "PgTimestamp", true, true],
      ["updated_at", "PgTimestamp", true, true],
    ]);
    expect(foreignKeys("whatsapp_lines")).toEqual([
      "organization_id -> public.organizations(id) ON DELETE restrict",
    ]);
    expect(
      table("whatsapp_lines").uniqueConstraints.map((u) => ({
        name: u.getName(),
        columns: u.columns.map((c) => c.name),
      })),
    ).toEqual([
      {
        name: "whatsapp_lines_phone_number_id_key",
        columns: ["phone_number_id"],
      },
    ]);
    // Hito 8 (DEC-040 §4): los miembros la leen; la escribe el provisioning.
    expect(
      table("whatsapp_lines").policies.map((p) => `${p.name} ${p.for}`),
    ).toEqual(["whatsapp_lines_select_member select"]);
  });

  it("opportunities: unique (organization_id, id), destino de la FK de la demanda (H1.4), y (organization_id, id, contact_id), destino de la de los mensajes (Hito 4)", () => {
    expect(
      table("opportunities").uniqueConstraints.map((u) => ({
        name: u.getName(),
        columns: u.columns.map((c) => c.name),
      })),
    ).toEqual([
      {
        name: "opportunities_organization_id_id_key",
        columns: ["organization_id", "id"],
      },
      {
        name: "opportunities_organization_id_id_contact_id_key",
        columns: ["organization_id", "id", "contact_id"],
      },
    ]);
  });

  it("toda tabla tenant-scoped tiene organization_id NOT NULL, FK e índice que empieza por él", () => {
    const tenantScoped = tables.filter(
      (t) => !NOT_TENANT_OWNED.includes(t.name),
    );
    expect(tenantScoped.map((t) => t.name).sort()).toEqual([
      "contacts",
      "conversation_reads",
      "conversations",
      "deliveries",
      "memberships",
      "message_statuses",
      "messages",
      "opportunities",
      "opportunity_demand_facts",
      "opportunity_notes",
      "quotes",
      "test_drives",
      "trade_ins",
      "vehicles",
      "whatsapp_lines",
    ]);

    for (const t of tenantScoped) {
      expect(column(t.name, "organization_id").notNull).toBe(true);
      expect(foreignKeys(t.name)).toContain(
        "organization_id -> public.organizations(id) ON DELETE restrict",
      );
      // La PK compuesta también es un índice (conversation_reads, Hito 12B;
      // message_statuses, Hito 12C).
      const leading = [
        ...t.indexes.map((i) => i.config.columns[0]),
        ...t.uniqueConstraints.map((u) => u.columns[0]),
        ...t.primaryKeys.map((pk) => pk.columns[0]),
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
