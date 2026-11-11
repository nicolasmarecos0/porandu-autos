import { sql } from "drizzle-orm";
import {
  check,
  foreignKey,
  index,
  integer,
  numeric,
  pgPolicy,
  pgTable,
  smallint,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
  type PgColumn,
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
 * Estados de una toma (Hito 20, DEC-052 §2). Espeja TRADE_IN_STATUSES de
 * domains/opportunities/trade-ins.ts (un test vigila que coincidan).
 */
export const tradeInStatuses = [
  "pending",
  "appraised",
  "accepted",
  "rejected",
] as const;

/**
 * Las tomas vigentes de una oportunidad: a lo sumo una a la vez. Espeja
 * ACTIVE_TRADE_IN_STATUSES del dominio.
 */
export const activeTradeInStatuses = [
  "pending",
  "appraised",
  "accepted",
] as const;

/**
 * Etapas en las que una toma se registra, se tasa y se decide: la
 * oportunidad abierta. Espeja TRADE_IN_OPEN_STAGES del dominio.
 */
export const tradeInOpenStages = ["new", "qualifying", "negotiating"] as const;

/** Moneda de la tasación: las de todo dinero de P1 (DEC-025 §6). */
export const tradeInCurrencies = ["PYG", "USD"] as const;

/**
 * Largos máximos del usado, en caracteres (`char_length`). Espejan
 * TRADE_IN_MAX_LENGTH del dominio (los mismos de la unidad, DEC-030 C-12).
 */
export const tradeInMaxLength = {
  brand: 40,
  model: 80,
  version: 80,
  plate: 12,
} as const;

/**
 * Texto de una línea: recortado, sin caracteres de control, con largo. Un
 * NULL pasa el CHECK: la obligatoriedad la da NOT NULL.
 */
function singleLineCheck(column: PgColumn, max: number) {
  return sql`char_length(${column}) BETWEEN 1 AND ${sql.raw(String(max))} AND ${column} = btrim(${column}) AND ${column} !~ '[[:cntrl:]]'`;
}

/*
 * Tomas de usados y tasaciones (Hito 20, DEC-052): el vehículo que el
 * cliente entrega en parte de pago de una oportunidad, su tasación y la
 * decisión del cliente. Tenant-scoped (ADR-001 §3.6): `organization_id` NOT
 * NULL, FK simple a `organizations` e índices que empiezan por
 * `organization_id`.
 *
 * - `opportunity_id`: FK compuesta (organization_id, opportunity_id) →
 *   opportunities. El cliente de la toma es el de su oportunidad: no se
 *   duplica el contacto.
 * - El usado: `brand`, `model` y `year` obligatorios; `version`, `km`
 *   (0 es 0 km, NULL es sin dato) y `plate` (la chapa, normalizada en
 *   mayúsculas: "ABC 123") opcionales. Textos recortados y sin caracteres
 *   de control, con los largos de la unidad. Inmutables desde el alta: son
 *   lo que se tasa y lo que entra al stock.
 * - La tasación: `currency` + `estimated_repair_cost` (costo de
 *   reacondicionamiento, ≥ 0) + `offer_price` (valor de toma, > 0), siempre
 *   juntos (DEC-025 §5: todo dinero lleva su moneda; los dos montos van en
 *   la misma, así el costo total de ingreso se suma sin FX). `numeric(14,
 *   2)`, PYG sin decimales. Existen si y solo si la toma está tasada o
 *   aceptada (en una rechazada, si se había tasado). `appraised_by` /
 *   `appraised_at`: el admin que la tasó y cuándo, los fija el trigger.
 * - `status`: nace `pending` (policy de INSERT) y cambia solo por la matriz
 *   del trigger `trade_ins_change_guard` (SQL custom de 0021): tasar (admin)
 *   pending | appraised → appraised; el cliente aprueba appraised →
 *   accepted (exige el valor de toma); rechazar o descartar pending |
 *   appraised | accepted → rejected. `rejected` es terminal.
 * - `converted_vehicle_id`: la unidad del stock en la que se convirtió
 *   (Master Context §18, `converted_vehicle_id`). FK compuesta a vehicles
 *   (la unique de 0009) y única por organización: una unidad nace de a lo
 *   sumo una toma. Solo la escribe el cierre Ganada de la oportunidad, en
 *   la misma transacción que crea la unidad En preparación; solo existe en
 *   una toma aceptada.
 * - Índice único parcial `trade_ins_active_opportunity_key`: a lo sumo una
 *   toma vigente (pendiente, tasada o aceptada) por oportunidad. Las
 *   rechazadas quedan como historial.
 * - Todas las FKs son RESTRICT.
 *
 * Lectura: las tomas de las organizaciones con membership activa. Alta: un
 * miembro activo, como autor, en `pending`, sin tasación ni ingreso, con el
 * reloj de la base, para una oportunidad abierta. Edición: la tasación, el
 * estado y el ingreso al stock (grant por columna); qué cambio vale lo
 * decide el trigger. Sin DELETE: una toma se rechaza, no se borra.
 */
export const tradeIns = pgTable(
  "trade_ins",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "restrict" }),
    opportunityId: uuid("opportunity_id").notNull(),
    brand: text("brand").notNull(),
    model: text("model").notNull(),
    version: text("version"),
    year: smallint("year").notNull(),
    km: integer("km"),
    plate: text("plate"),
    currency: text("currency", { enum: tradeInCurrencies }),
    estimatedRepairCost: numeric("estimated_repair_cost", {
      precision: 14,
      scale: 2,
    }),
    offerPrice: numeric("offer_price", { precision: 14, scale: 2 }),
    status: text("status", { enum: tradeInStatuses })
      .notNull()
      .default("pending"),
    createdBy: uuid("created_by")
      .notNull()
      .references(() => profiles.id, { onDelete: "restrict" }),
    appraisedBy: uuid("appraised_by").references(() => profiles.id, {
      onDelete: "restrict",
    }),
    appraisedAt: timestamp("appraised_at", { withTimezone: true }),
    convertedVehicleId: uuid("converted_vehicle_id"),
    ...timestamps,
  },
  (t) => [
    foreignKey({
      name: "trade_ins_opportunity_fk",
      columns: [t.organizationId, t.opportunityId],
      foreignColumns: [opportunities.organizationId, opportunities.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "trade_ins_converted_vehicle_fk",
      columns: [t.organizationId, t.convertedVehicleId],
      foreignColumns: [vehicles.organizationId, vehicles.id],
    }).onDelete("restrict"),
    index("trade_ins_organization_id_opportunity_id_idx").on(
      t.organizationId,
      t.opportunityId,
    ),
    uniqueIndex("trade_ins_active_opportunity_key")
      .on(t.organizationId, t.opportunityId)
      .where(sql`${t.status} IN ('pending', 'appraised', 'accepted')`),
    unique("trade_ins_organization_id_converted_vehicle_id_key").on(
      t.organizationId,
      t.convertedVehicleId,
    ),
    check("trade_ins_status_check", oneOf(t.status, tradeInStatuses)),
    check("trade_ins_currency_check", oneOf(t.currency, tradeInCurrencies)),
    check(
      "trade_ins_brand_check",
      singleLineCheck(t.brand, tradeInMaxLength.brand),
    ),
    check(
      "trade_ins_model_check",
      singleLineCheck(t.model, tradeInMaxLength.model),
    ),
    check(
      "trade_ins_version_check",
      singleLineCheck(t.version, tradeInMaxLength.version),
    ),
    check("trade_ins_year_check", sql`${t.year} BETWEEN 1900 AND 2100`),
    check("trade_ins_km_check", sql`${t.km} IS NULL OR ${t.km} >= 0`),
    // La chapa normalizada: grupos de mayúsculas y dígitos separados por un
    // solo espacio ("ABC 123", "AAAB 123").
    check(
      "trade_ins_plate_check",
      sql`char_length(${t.plate}) BETWEEN 2 AND ${sql.raw(String(tradeInMaxLength.plate))} AND ${t.plate} ~ '^[A-Z0-9]+( [A-Z0-9]+)*$'`,
    ),
    // PYG no tiene unidad menor (DEC-025 §6).
    check(
      "trade_ins_offer_price_check",
      sql`${t.offerPrice} > 0 AND (${t.currency} <> 'PYG' OR ${t.offerPrice} = trunc(${t.offerPrice}))`,
    ),
    check(
      "trade_ins_repair_cost_check",
      sql`${t.estimatedRepairCost} >= 0 AND (${t.currency} <> 'PYG' OR ${t.estimatedRepairCost} = trunc(${t.estimatedRepairCost}))`,
    ),
    // La tasación va entera (moneda, los dos montos y sus sellos) y existe
    // según el estado: nunca en una pendiente, siempre en una tasada o
    // aceptada; una rechazada la conserva si se había tasado.
    check(
      "trade_ins_appraisal_check",
      sql`(${t.currency} IS NULL) = (${t.offerPrice} IS NULL) AND (${t.estimatedRepairCost} IS NULL) = (${t.offerPrice} IS NULL) AND (${t.appraisedBy} IS NULL) = (${t.offerPrice} IS NULL) AND (${t.appraisedAt} IS NULL) = (${t.offerPrice} IS NULL) AND CASE WHEN ${t.status} = 'pending' THEN ${t.offerPrice} IS NULL WHEN ${t.status} IN ('appraised', 'accepted') THEN ${t.offerPrice} IS NOT NULL ELSE true END`,
    ),
    // La regla del fundador (DEC-052 §2): no se acepta una toma sin precio
    // de oferta. La de arriba ya lo implica; esta la nombra.
    check(
      "trade_ins_accepted_offer_check",
      sql`${t.status} <> 'accepted' OR ${t.offerPrice} IS NOT NULL`,
    ),
    // Solo una toma aceptada se convierte en una unidad del stock.
    check(
      "trade_ins_converted_check",
      sql`${t.convertedVehicleId} IS NULL OR ${t.status} = 'accepted'`,
    ),
    pgPolicy("trade_ins_select_member", {
      for: "select",
      to: authenticatedRole,
      using: sql`${t.organizationId} IN ${userOrgIds}`,
    }),
    // Alta: un miembro activo, como autor, pendiente de tasación, sin
    // tasación ni ingreso, con el reloj de la base y para una oportunidad
    // abierta de la misma organización (DEC-052 §3).
    pgPolicy("trade_ins_insert_member", {
      for: "insert",
      to: authenticatedRole,
      withCheck: sql`${t.organizationId} IN ${userOrgIds} AND ${t.createdBy} = ${authUid} AND ${t.status} = 'pending' AND ${t.currency} IS NULL AND ${t.estimatedRepairCost} IS NULL AND ${t.offerPrice} IS NULL AND ${t.appraisedBy} IS NULL AND ${t.appraisedAt} IS NULL AND ${t.convertedVehicleId} IS NULL AND ${t.createdAt} = now() AND ${t.updatedAt} = now() AND EXISTS (SELECT FROM ${opportunities} WHERE ${opportunities.organizationId} = ${t.organizationId} AND ${opportunities.id} = ${t.opportunityId} AND ${opportunities.stage} IN ('new', 'qualifying', 'negotiating'))`,
    }),
    // Edición: una toma de una organización con membership activa, antes y
    // después. Qué cambia lo limitan el grant por columna y el trigger
    // (DEC-028 §5: una sola policy permisiva de UPDATE).
    pgPolicy("trade_ins_update_member", {
      for: "update",
      to: authenticatedRole,
      using: sql`${t.organizationId} IN ${userOrgIds}`,
      withCheck: sql`${t.organizationId} IN ${userOrgIds}`,
    }),
  ],
).enableRLS();
