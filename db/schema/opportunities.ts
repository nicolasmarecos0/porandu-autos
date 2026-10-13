import { sql } from "drizzle-orm";
import {
  check,
  date,
  foreignKey,
  index,
  numeric,
  pgPolicy,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import { authenticatedRole } from "drizzle-orm/supabase";

import { oneOf } from "./checks";
import { timestamps } from "./columns";
import { contacts } from "./contacts";
import { organizations } from "./organizations";
import { userOrgIds } from "./policies";
import { vehicles } from "./vehicles";

/*
 * Etapas comerciales de la oportunidad (H1.6, DEC-032 §1): `won` y `lost`
 * son terminales. No es un enum de Postgres: se valida con un CHECK que una
 * migración puede reemplazar. El CHECK admite todas las etapas; qué par
 * etapa anterior → etapa nueva es válido lo decide el trigger de
 * `0008_opportunity_stages` (DEC-028 §6), que espeja
 * domains/opportunities/stages.ts.
 */
export const opportunityStages = [
  "new",
  "qualifying",
  "negotiating",
  "won",
  "lost",
] as const;

/*
 * Metadatos del cierre (DEC-034). Espejan las listas de
 * domains/opportunities/closure.ts (un test vigila que coincidan).
 *
 * Motivo de pérdida estructurado (DEC-034 §2, reemplaza la lista de DEC-032
 * §3): obligatorio con `lost`, ausente en cualquier otra etapa.
 */
export const opportunityLossReasons = [
  "price",
  "vehicle_unavailable",
  "competitor",
  "financing_rejected",
  "ghosted",
  "other",
] as const;

/** Forma de pago de una venta (DEC-034 §3). */
export const opportunityPaymentMethods = [
  "cash",
  "financing",
  "trade_in",
  "mixed",
] as const;

/** Estado de la entrega al cerrar la venta (DEC-034 §3). */
export const opportunityDeliveryStatuses = ["scheduled", "delivered"] as const;

/** Monedas del precio de cierre: las de P1 (DEC-025 §6). */
export const opportunitySaleCurrencies = ["PYG", "USD"] as const;

/** Cotas de cordura de `delivery_date` (DEC-034 §3). */
export const opportunityDeliveryDateRange = {
  min: "2000-01-01",
  max: "2100-12-31",
} as const;

/*
 * Etapas en las que puede existir una unidad vinculada (Hito 2, DEC-033 §2):
 * se elige o cambia en `negotiating`, `won` la exige (es la vendida, DEC-034
 * §3) y `lost` conserva la que se negociaba. Espeja VEHICLE_HOLDING_STAGES de
 * domains/opportunities/vehicle-link.ts (un test vigila que coincidan).
 */
export const opportunityVehicleStages = ["negotiating", "won", "lost"] as const;

/*
 * Origen de la oportunidad (TB §7 "source / channel"). Mismo criterio: los
 * canales de hoy, con un CHECK reemplazable cuando se sumen otros.
 */
export const opportunitySources = [
  "whatsapp",
  "meta_ads",
  "web",
  "showroom",
  "referral",
] as const;

/*
 * Oportunidad comercial ("leads" en TB §10; Opportunity en la UI, DEC-015):
 * lo mínimo que muestra la cola de Opportunities con datos reales (H1.1).
 * Es tenant-scoped (ADR-001 §3.6): `organization_id` NOT NULL, con FK a
 * `organizations` e índice que empieza por `organization_id`.
 *
 * - `contact_id`: FK compuesta (organization_id, contact_id) → contacts: el
 *   contacto es siempre de la misma organización. RESTRICT: no se borra un
 *   contacto con oportunidades.
 * - `stage` y `source`: obligatorios y sin default, con CHECK.
 * - `loss_reason` (H1.6, lista de DEC-034 §2): el motivo de la pérdida.
 *   Existe si y solo si la etapa es `lost` (CHECK) y es inmutable: de una
 *   etapa terminal no se sale.
 * - Metadatos del cierre (DEC-034): `loss_notes` (opcional, solo con
 *   `lost`, 1 a 500 caracteres normalizados) y, de una venta, `sale_price` +
 *   `sale_currency` (`numeric(14,2)`, PYG sin decimales, mayor que cero),
 *   `payment_method`, `delivery_status` y `delivery_date` (día de
 *   calendario). Los de la venta existen si y solo si la etapa es `won`, y
 *   `won` exige además la unidad vinculada (CHECK
 *   `opportunities_won_closure_check`). Se escriben en el mismo UPDATE que
 *   cierra y después no cambian (trigger).
 * - `vehicle_id` (Hito 2, DEC-033): la unidad del stock que se negocia,
 *   opcional. FK compuesta (organization_id, vehicle_id) → vehicles: la
 *   unidad es siempre de la misma organización. RESTRICT. Solo existe en
 *   `negotiating`, `won` (la exige: es la vendida) y `lost` (CHECK); solo
 *   cambia en `negotiating` (trigger, DEC-034 §4). Vincular no cambia el
 *   estado de la unidad. Índice parcial (organization_id, vehicle_id) para
 *   la FK.
 * - `interest_model` / `interest_version`: legado de H1.1/H1.2, congelado y
 *   de solo lectura (DEC-030 §10). La demanda estructurada vive en
 *   `opportunity_demand_facts` (H1.4): estas columnas ya no se escriben, no
 *   se backfillean y solo se muestran mientras `desired_vehicle` nunca se
 *   cargó.
 * - `last_activity_at`: última interacción significativa (recencia, MC §12),
 *   no la última actualización técnica (`updated_at`). Nace con el alta y la
 *   mueve la base al registrar una nota o un mensaje de la oportunidad
 *   (Hito 4, DEC-036 §1: triggers de actividad de la migración 0011). Nadie
 *   la edita directamente.
 * - Índice (organization_id, last_activity_at DESC): la cola de una
 *   organización, de la actividad más reciente a la más vieja.
 * - unique (organization_id, id) (H1.4): destino de la FK compuesta de
 *   `opportunity_demand_facts`, que impide apuntar a una oportunidad de otra
 *   organización.
 * - unique (organization_id, id, contact_id) (Hito 4): destino de la FK
 *   compuesta de `messages`, que además exige el contacto de la oportunidad.
 *
 * No se persisten scores, urgencia, NBA, señales, matches, trade-in ni
 * responsable: no tienen fuente todavía (H1.1).
 *
 * Lectura y alta (H1.2): las oportunidades de las organizaciones donde el
 * usuario tiene membership activa. Toda alta nace en la etapa `new`: la fija
 * el código (nunca el cliente) y la exige el WITH CHECK de la policy de
 * INSERT. El CHECK de `stage` admite todas las etapas.
 *
 * Cambio de etapa (H1.6, DEC-032), de unidad vinculada (Hito 2, DEC-033) y
 * cierre con sus metadatos (DEC-034): las únicas ediciones. `authenticated`
 * recibe UPDATE solo sobre `stage`, `loss_reason`, `vehicle_id`, los
 * metadatos del cierre y `updated_at` (grant por columna, en las
 * migraciones), y una única policy de UPDATE tenant-scoped
 * (`opportunities_update_stage`: organización con membership activa, antes y
 * después). Qué UPDATE es válida la decide un trigger BEFORE UPDATE
 * (migración, drizzle-kit no modela triggers): un pase de etapa de la
 * máquina que no toca la unidad (los metadatos de cierre solo cambian si el
 * pase cierra), o un cambio de unidad en `negotiating` sin pase. Como las
 * policies permisivas de un mismo comando se combinan con OR (DEC-028 §5),
 * esas reglas viven en el trigger y no en policies por transición. El mismo
 * trigger admite el toque de actividad (DEC-036 §3): solo `last_activity_at`
 * avanza a `now()`, desde el trigger de actividad. Sin DELETE (default deny).
 */
export const opportunities = pgTable(
  "opportunities",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "restrict" }),
    contactId: uuid("contact_id").notNull(),
    stage: text("stage", { enum: opportunityStages }).notNull(),
    source: text("source", { enum: opportunitySources }).notNull(),
    lossReason: text("loss_reason", { enum: opportunityLossReasons }),
    vehicleId: uuid("vehicle_id"),
    lossNotes: text("loss_notes"),
    salePrice: numeric("sale_price", { precision: 14, scale: 2 }),
    saleCurrency: text("sale_currency", { enum: opportunitySaleCurrencies }),
    paymentMethod: text("payment_method", {
      enum: opportunityPaymentMethods,
    }),
    deliveryStatus: text("delivery_status", {
      enum: opportunityDeliveryStatuses,
    }),
    deliveryDate: date("delivery_date", { mode: "string" }),
    interestModel: text("interest_model"),
    interestVersion: text("interest_version"),
    lastActivityAt: timestamp("last_activity_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    ...timestamps,
  },
  (t) => [
    foreignKey({
      name: "opportunities_organization_id_contact_id_contacts_fk",
      columns: [t.organizationId, t.contactId],
      foreignColumns: [contacts.organizationId, contacts.id],
    }).onDelete("restrict"),
    // La unidad vinculada es de la misma organización (Hito 2, DEC-033).
    foreignKey({
      name: "opportunities_vehicle_fk",
      columns: [t.organizationId, t.vehicleId],
      foreignColumns: [vehicles.organizationId, vehicles.id],
    }).onDelete("restrict"),
    // Mismo orden que la query (DESC, que en Postgres es NULLS FIRST).
    index("opportunities_organization_id_last_activity_at_idx").on(
      t.organizationId,
      t.lastActivityAt.desc().nullsFirst(),
    ),
    // Busca las oportunidades de un contacto (y la FK compuesta).
    index("opportunities_organization_id_contact_id_idx").on(
      t.organizationId,
      t.contactId,
    ),
    // Las oportunidades que negocian una unidad (y la FK compuesta).
    index("opportunities_organization_id_vehicle_id_idx")
      .on(t.organizationId, t.vehicleId)
      .where(sql`${t.vehicleId} IS NOT NULL`),
    unique("opportunities_organization_id_id_key").on(t.organizationId, t.id),
    // Destino de la FK compuesta de `messages` (Hito 4, DEC-036 §4): un
    // mensaje asociado a una oportunidad es con su contacto.
    unique("opportunities_organization_id_id_contact_id_key").on(
      t.organizationId,
      t.id,
      t.contactId,
    ),
    check("opportunities_stage_check", oneOf(t.stage, opportunityStages)),
    check("opportunities_source_check", oneOf(t.source, opportunitySources)),
    // Un NULL pasa el CHECK de valores; la coherencia con la etapa la da el
    // siguiente: motivo si y solo si `lost`.
    check(
      "opportunities_loss_reason_check",
      oneOf(t.lossReason, opportunityLossReasons),
    ),
    check(
      "opportunities_loss_reason_stage_check",
      sql`(${t.stage} = 'lost' AND ${t.lossReason} IS NOT NULL) OR (${t.stage} <> 'lost' AND ${t.lossReason} IS NULL)`,
    ),
    // Una unidad vinculada solo existe desde la negociación (DEC-033 §2).
    check(
      "opportunities_vehicle_stage_check",
      sql`${t.vehicleId} IS NULL OR ${oneOf(t.stage, opportunityVehicleStages)}`,
    ),
    // Cierre (DEC-034 §5). Los CHECKs de valores dejan pasar NULL; cuándo
    // existen lo deciden los de etapa: notas solo con `lost`, y la venta
    // completa (con su unidad) si y solo si `won`.
    check(
      "opportunities_loss_notes_check",
      sql`char_length(${t.lossNotes}) BETWEEN 1 AND 500 AND ${t.lossNotes} = btrim(${t.lossNotes}, ' ' || chr(10)) AND translate(${t.lossNotes}, chr(10), '') !~ '[[:cntrl:]]'`,
    ),
    check(
      "opportunities_loss_notes_stage_check",
      sql`${t.lossNotes} IS NULL OR ${t.stage} = 'lost'`,
    ),
    check(
      "opportunities_sale_currency_check",
      oneOf(t.saleCurrency, opportunitySaleCurrencies),
    ),
    // Como vehicles.price (DEC-025 §5): con su moneda, mayor que cero y
    // guaraníes sin decimales.
    check(
      "opportunities_sale_price_check",
      sql`(${t.salePrice} IS NULL) = (${t.saleCurrency} IS NULL) AND (${t.salePrice} IS NULL OR (${t.salePrice} > 0 AND (${t.saleCurrency} <> 'PYG' OR ${t.salePrice} = trunc(${t.salePrice}))))`,
    ),
    check(
      "opportunities_payment_method_check",
      oneOf(t.paymentMethod, opportunityPaymentMethods),
    ),
    check(
      "opportunities_delivery_status_check",
      oneOf(t.deliveryStatus, opportunityDeliveryStatuses),
    ),
    check(
      "opportunities_delivery_date_check",
      sql`${t.deliveryDate} BETWEEN ${sql.raw(`'${opportunityDeliveryDateRange.min}'`)} AND ${sql.raw(`'${opportunityDeliveryDateRange.max}'`)}`,
    ),
    check(
      "opportunities_won_closure_check",
      sql`(${t.stage} = 'won' AND ${t.vehicleId} IS NOT NULL AND ${t.salePrice} IS NOT NULL AND ${t.saleCurrency} IS NOT NULL AND ${t.paymentMethod} IS NOT NULL AND ${t.deliveryStatus} IS NOT NULL AND ${t.deliveryDate} IS NOT NULL) OR (${t.stage} <> 'won' AND ${t.salePrice} IS NULL AND ${t.saleCurrency} IS NULL AND ${t.paymentMethod} IS NULL AND ${t.deliveryStatus} IS NULL AND ${t.deliveryDate} IS NULL)`,
    ),
    pgPolicy("opportunities_select_member", {
      for: "select",
      to: authenticatedRole,
      using: sql`${t.organizationId} IN ${userOrgIds}`,
    }),
    // Alta: organización con membership activa y siempre en la etapa
    // inicial.
    pgPolicy("opportunities_insert_member", {
      for: "insert",
      to: authenticatedRole,
      withCheck: sql`${t.organizationId} IN ${userOrgIds} AND ${t.stage} = 'new'`,
    }),
    // Cambio de etapa (H1.6), de unidad vinculada (Hito 2) y cierre
    // (DEC-034): organización con membership activa, antes y después. Qué
    // UPDATE es válida lo decide el trigger de las migraciones 0008, 0009 y
    // 0010 (DEC-032 §4, DEC-033 §3, DEC-034 §5), no esta policy.
    pgPolicy("opportunities_update_stage", {
      for: "update",
      to: authenticatedRole,
      using: sql`${t.organizationId} IN ${userOrgIds}`,
      withCheck: sql`${t.organizationId} IN ${userOrgIds}`,
    }),
  ],
).enableRLS();
