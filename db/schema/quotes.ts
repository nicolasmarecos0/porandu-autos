import { sql } from "drizzle-orm";
import {
  check,
  date,
  foreignKey,
  index,
  integer,
  numeric,
  pgPolicy,
  pgTable,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { authenticatedRole, authUid } from "drizzle-orm/supabase";

import { oneOf } from "./checks";
import { timestamps } from "./columns";
import { opportunities } from "./opportunities";
import { organizations } from "./organizations";
import { userOrgIds } from "./policies";
import { profiles } from "./profiles";
import { vehicles } from "./vehicles";

/**
 * Estados de una cotización. Espeja QUOTE_STATUSES de
 * domains/quotes/statuses.ts (un test vigila que coincidan).
 */
export const quoteStatuses = [
  "draft",
  "approved",
  "sent",
  "accepted",
  "rejected",
  "withdrawn",
] as const;

/** Espeja DISCOUNT_KINDS de domains/quotes/pricing.ts. */
export const quoteDiscountKinds = ["none", "amount", "percent"] as const;

/** Monedas de una cotización: las del precio publicado (DEC-025 §6). */
export const quoteCurrencies = ["PYG", "USD"] as const;

/**
 * Descuento máximo en puntos porcentuales efectivos. Espeja
 * MAX_DISCOUNT_PERCENT de domains/quotes/pricing.ts.
 */
export const quoteMaxDiscountPercent = 30;

/** Espeja MAX_VALIDITY_DAYS de domains/quotes/request.ts. */
export const quoteMaxValidityDays = 30;

/** Espeja QUOTE_NOTES_MAX_LENGTH de domains/quotes/request.ts. */
export const quoteNotesMaxLength = 500;

/** Zona del "hoy" de la validez (P1 opera en Paraguay). */
const QUOTE_TIME_ZONE = "America/Asuncion";

/*
 * Cotizaciones formales (Hito 10, DEC-042). Tenant-scoped (ADR-001 §3.6):
 * `organization_id` NOT NULL, FK simple a `organizations` e índices que
 * empiezan por `organization_id`.
 *
 * - `opportunity_id`: FK compuesta (organization_id, opportunity_id) →
 *   opportunities. El cliente de la cotización es el de su oportunidad: no
 *   se duplica `contact_id`.
 * - `vehicle_id`: FK compuesta (organization_id, vehicle_id) → vehicles (la
 *   unique de 0009): la unidad cotizada es de la misma organización.
 * - `number`: correlativo por organización (1, 2, 3…), único con
 *   `organization_id`. Lo asigna el trigger BEFORE INSERT
 *   `quotes_assign_number` (SQL custom de 0016, serializado con un advisory
 *   lock por organización): el valor que llegue del cliente se descarta.
 * - `currency` + `list_price`: el precio publicado de la unidad al crear la
 *   cotización (copia, no referencia: si el precio cambia después, la
 *   cotización no). La policy de INSERT exige que coincidan con los de la
 *   unidad en ese momento.
 * - `discount_kind` + `discount_value`: uno solo, ninguno, monto o
 *   porcentaje, hasta el 30 % efectivo (`quotes_discount_check`).
 * - `total_price`: lista − descuento. El CHECK `quotes_total_price_check`
 *   rehace la cuenta (redondeo al guaraní o al centavo), así que ningún
 *   total queda inconsistente con su lista y su descuento.
 * - `valid_until`: último día de validez, inclusive, entre el día del alta y
 *   30 días después (días de Asunción).
 * - `notes`: condiciones en texto libre, opcionales (1 a 500 caracteres,
 *   normalizadas como la bitácora).
 * - `status`: nace `draft` (policy de INSERT) y cambia solo por la matriz
 *   del trigger `quotes_status_transition`, que además exige validez,
 *   oportunidad abierta, unidad en stock (para aceptar) y rol `admin` para
 *   aprobar un descuento mayor al 10 %, y deja inmutable el resto de la
 *   fila.
 * - `approved_by` / `approved_at`, `sent_at`, `decided_at`: sellos del
 *   ciclo. Los fija el trigger (`auth.uid()` y el reloj de la base); el
 *   cliente no los escribe (no tiene grant sobre ellos). Los CHECKs
 *   `quotes_*_stamp_check` exigen que existan exactamente en los estados que
 *   corresponden.
 * - Índice único parcial `quotes_accepted_opportunity_key`: a lo sumo una
 *   cotización aceptada por oportunidad.
 * - Todas las FKs son RESTRICT.
 *
 * Lectura: las cotizaciones de las organizaciones con membership activa.
 * Alta: un miembro activo, como autor, en `draft`, sin sellos, con el reloj
 * de la base, para una oportunidad en `qualifying` o `negotiating` y una
 * unidad `available` o `reserved` cuyo precio publicado es el de la lista.
 * Edición: solo `status` y `updated_at` (grant por columna). Sin DELETE: una
 * cotización se anula, no se borra.
 */
export const quotes = pgTable(
  "quotes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "restrict" }),
    opportunityId: uuid("opportunity_id").notNull(),
    vehicleId: uuid("vehicle_id").notNull(),
    // 0 = sin asignar: el trigger quotes_assign_number lo reemplaza siempre.
    number: integer("number").notNull().default(0),
    status: text("status", { enum: quoteStatuses }).notNull().default("draft"),
    currency: text("currency", { enum: quoteCurrencies }).notNull(),
    listPrice: numeric("list_price", { precision: 14, scale: 2 }).notNull(),
    discountKind: text("discount_kind", { enum: quoteDiscountKinds })
      .notNull()
      .default("none"),
    discountValue: numeric("discount_value", { precision: 14, scale: 2 }),
    totalPrice: numeric("total_price", { precision: 14, scale: 2 }).notNull(),
    validUntil: date("valid_until", { mode: "string" }).notNull(),
    notes: text("notes"),
    createdBy: uuid("created_by")
      .notNull()
      .references(() => profiles.id, { onDelete: "restrict" }),
    approvedBy: uuid("approved_by").references(() => profiles.id, {
      onDelete: "restrict",
    }),
    approvedAt: timestamp("approved_at", { withTimezone: true }),
    sentAt: timestamp("sent_at", { withTimezone: true }),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
    ...timestamps,
  },
  (t) => [
    foreignKey({
      name: "quotes_opportunity_fk",
      columns: [t.organizationId, t.opportunityId],
      foreignColumns: [opportunities.organizationId, opportunities.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "quotes_vehicle_fk",
      columns: [t.organizationId, t.vehicleId],
      foreignColumns: [vehicles.organizationId, vehicles.id],
    }).onDelete("restrict"),
    unique("quotes_organization_id_number_key").on(t.organizationId, t.number),
    index("quotes_organization_id_opportunity_id_idx").on(
      t.organizationId,
      t.opportunityId,
    ),
    index("quotes_organization_id_vehicle_id_idx").on(
      t.organizationId,
      t.vehicleId,
    ),
    uniqueIndex("quotes_accepted_opportunity_key")
      .on(t.organizationId, t.opportunityId)
      .where(sql`${t.status} = 'accepted'`),
    check("quotes_status_check", oneOf(t.status, quoteStatuses)),
    check("quotes_currency_check", oneOf(t.currency, quoteCurrencies)),
    check(
      "quotes_discount_kind_check",
      oneOf(t.discountKind, quoteDiscountKinds),
    ),
    check("quotes_number_check", sql`${t.number} > 0`),
    // PYG no tiene unidad menor (DEC-025 §6).
    check(
      "quotes_list_price_check",
      sql`${t.listPrice} > 0 AND (${t.currency} <> 'PYG' OR ${t.listPrice} = trunc(${t.listPrice}))`,
    ),
    check(
      "quotes_discount_check",
      sql`(${t.discountKind} = 'none' AND ${t.discountValue} IS NULL) OR (${t.discountKind} = 'amount' AND ${t.discountValue} > 0 AND ${t.discountValue} * 100 <= ${sql.raw(String(quoteMaxDiscountPercent))} * ${t.listPrice} AND (${t.currency} <> 'PYG' OR ${t.discountValue} = trunc(${t.discountValue}))) OR (${t.discountKind} = 'percent' AND ${t.discountValue} > 0 AND ${t.discountValue} <= ${sql.raw(String(quoteMaxDiscountPercent))})`,
    ),
    // Misma cuenta que quoteTotal() de domains/quotes/pricing.ts: round()
    // de numeric redondea la mitad hacia arriba (lejos del cero).
    check(
      "quotes_total_price_check",
      sql`${t.totalPrice} = CASE ${t.discountKind} WHEN 'none' THEN ${t.listPrice} WHEN 'amount' THEN ${t.listPrice} - ${t.discountValue} ELSE round(${t.listPrice} * (100 - ${t.discountValue}) / 100, CASE WHEN ${t.currency} = 'PYG' THEN 0 ELSE 2 END) END`,
    ),
    check(
      "quotes_valid_until_check",
      sql`${t.validUntil} >= (${t.createdAt} AT TIME ZONE '${sql.raw(QUOTE_TIME_ZONE)}')::date AND ${t.validUntil} <= (${t.createdAt} AT TIME ZONE '${sql.raw(QUOTE_TIME_ZONE)}')::date + ${sql.raw(String(quoteMaxValidityDays))}`,
    ),
    check(
      "quotes_notes_check",
      sql`char_length(${t.notes}) BETWEEN 1 AND ${sql.raw(String(quoteNotesMaxLength))} AND ${t.notes} = btrim(${t.notes}, ' ' || chr(10)) AND translate(${t.notes}, chr(10), '') !~ '[[:cntrl:]]'`,
    ),
    // Aprobada o después de aprobada (una anulada puede haberlo sido o no).
    check(
      "quotes_approved_stamp_check",
      sql`(${t.approvedBy} IS NULL) = (${t.approvedAt} IS NULL) AND CASE WHEN ${t.status} = 'draft' THEN ${t.approvedAt} IS NULL WHEN ${t.status} IN ('approved', 'sent', 'accepted', 'rejected') THEN ${t.approvedAt} IS NOT NULL ELSE true END`,
    ),
    check(
      "quotes_sent_stamp_check",
      sql`CASE WHEN ${t.status} IN ('draft', 'approved') THEN ${t.sentAt} IS NULL WHEN ${t.status} IN ('sent', 'accepted', 'rejected') THEN ${t.sentAt} IS NOT NULL ELSE true END`,
    ),
    check(
      "quotes_decided_stamp_check",
      sql`(${t.decidedAt} IS NOT NULL) = (${t.status} IN ('accepted', 'rejected', 'withdrawn'))`,
    ),
    pgPolicy("quotes_select_member", {
      for: "select",
      to: authenticatedRole,
      using: sql`${t.organizationId} IN ${userOrgIds}`,
    }),
    // Alta: un miembro activo, como autor, en borrador y sin sellos, con el
    // reloj de la base, para una oportunidad que se puede cotizar y una
    // unidad en stock cuyo precio publicado es la lista (DEC-042 §3 y §4).
    pgPolicy("quotes_insert_member", {
      for: "insert",
      to: authenticatedRole,
      withCheck: sql`${t.organizationId} IN ${userOrgIds} AND ${t.createdBy} = ${authUid} AND ${t.status} = 'draft' AND ${t.approvedBy} IS NULL AND ${t.approvedAt} IS NULL AND ${t.sentAt} IS NULL AND ${t.decidedAt} IS NULL AND ${t.createdAt} = now() AND ${t.updatedAt} = now() AND EXISTS (SELECT FROM ${opportunities} WHERE ${opportunities.organizationId} = ${t.organizationId} AND ${opportunities.id} = ${t.opportunityId} AND ${opportunities.stage} IN ('qualifying', 'negotiating')) AND EXISTS (SELECT FROM ${vehicles} WHERE ${vehicles.organizationId} = ${t.organizationId} AND ${vehicles.id} = ${t.vehicleId} AND ${vehicles.status} IN ('available', 'reserved') AND ${vehicles.price} = ${t.listPrice} AND ${vehicles.currency} = ${t.currency})`,
    }),
    // Edición: una cotización de una organización con membership activa,
    // antes y después. Qué cambia lo limitan el grant por columna y el
    // trigger.
    pgPolicy("quotes_update_member", {
      for: "update",
      to: authenticatedRole,
      using: sql`${t.organizationId} IN ${userOrgIds}`,
      withCheck: sql`${t.organizationId} IN ${userOrgIds}`,
    }),
  ],
).enableRLS();
