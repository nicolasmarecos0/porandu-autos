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
  DELIVERY_DATE_RANGE,
  DELIVERY_STATUSES,
  LOSS_NOTES_MAX_LENGTH,
  LOSS_REASONS,
  PAYMENT_METHODS,
} from "@/domains/opportunities/closure";
import { NOTE_MAX_LENGTH } from "@/domains/opportunities/notes";
import { OPPORTUNITY_STAGES } from "@/domains/opportunities/stages";
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
  it("define las tablas de H0, las de H1.1 (contacts, opportunities), la de H1.3A (vehicles), la de H1.4 (opportunity_demand_facts), la del Hito 2 (opportunity_notes), la del Hito 4 (messages) y las del Hito 7 (conversations, whatsapp_lines)", () => {
    expect(tables.map((t) => t.name).sort()).toEqual([
      "contacts",
      "conversations",
      "memberships",
      "messages",
      "opportunities",
      "opportunity_demand_facts",
      "opportunity_notes",
      "organizations",
      "profiles",
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

  it("cada tabla declara su policy de lectura para authenticated (whatsapp_lines desde el Hito 8, DEC-040 §4) y solo contacts, opportunities, vehicles, opportunity_demand_facts, opportunity_notes, messages y memberships (admin) la de alta con WITH CHECK (ADR-001 §4)", () => {
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
        name: "vehicles_update_mark_available",
        as: "permissive",
        for: "update",
        to: ["authenticated"],
        using: `"vehicles"."organization_id" IN (SELECT private.user_org_ids()) AND "vehicles"."status" = 'in_preparation'`,
        withCheck: `"vehicles"."organization_id" IN (SELECT private.user_org_ids()) AND "vehicles"."status" = 'available'`,
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
    ]);
    // Append-only: no hay updated_at ni nada que se edite.
    expect(table("messages").columns.map((c) => c.name)).not.toContain(
      "updated_at",
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
      "conversations",
      "memberships",
      "messages",
      "opportunities",
      "opportunity_demand_facts",
      "opportunity_notes",
      "vehicles",
      "whatsapp_lines",
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
