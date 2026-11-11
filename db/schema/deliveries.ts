import { sql } from "drizzle-orm";
import {
  check,
  foreignKey,
  jsonb,
  pgPolicy,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import { authenticatedRole, authUid } from "drizzle-orm/supabase";

import { oneOf } from "./checks";
import { timestamps } from "./columns";
import { opportunities } from "./opportunities";
import { organizations } from "./organizations";
import { userAdminOrgIds, userOrgIds } from "./policies";
import { profiles } from "./profiles";
import { vehicles } from "./vehicles";

/**
 * Estados de una entrega (Hito 21, DEC-053 §1). Espeja DELIVERY_RECORD_STATUSES de
 * domains/opportunities/deliveries.ts (un test vigila que coincidan).
 */
export const deliveryStatuses = ["pending", "completed"] as const;

/**
 * Los ítems del checklist físico de la entrega, en el orden en que se
 * revisan. Espeja DELIVERY_CHECKLIST_ITEMS del dominio.
 */
export const deliveryChecklistItems = [
  "keys",
  "manuals",
  "spare_tire",
  "cleaning",
  "documents",
] as const;

export type DeliveryChecklistItemDb = (typeof deliveryChecklistItems)[number];

/** El checklist como lo guarda la base: un booleano por ítem, sin más. */
export type DeliveryChecklistDb = Readonly<
  Record<DeliveryChecklistItemDb, boolean>
>;

/** Literal jsonb del checklist con todos los ítems en `value`. */
function checklistLiteral(value: boolean) {
  const object = Object.fromEntries(
    deliveryChecklistItems.map((item) => [item, value]),
  );
  return sql.raw(`'${JSON.stringify(object)}'::jsonb`);
}

/** El checklist de una entrega recién programada: nada verificado. */
export const emptyDeliveryChecklist = checklistLiteral(false);

/** El checklist de una entrega completada: todo verificado. */
export const verifiedDeliveryChecklist = checklistLiteral(true);

const checklistKeys = sql.raw(
  `ARRAY[${deliveryChecklistItems.map((item) => `'${item}'`).join(", ")}]::text[]`,
);

/*
 * Remitos de entrega (Hito 21, DEC-053): la entrega física de la unidad
 * vendida al cliente de una oportunidad ganada. Tenant-scoped (ADR-001
 * §3.6): `organization_id` NOT NULL, FK simple a `organizations` e índices
 * que empiezan por `organization_id`.
 *
 * - `opportunity_id`: FK compuesta (organization_id, opportunity_id) →
 *   opportunities. Única por organización: una entrega por venta.
 * - `vehicle_id`: FK compuesta (organization_id, vehicle_id) → vehicles (la
 *   unique de 0009). Única por organización: una unidad se entrega una vez.
 *   Es la unidad vinculada de la oportunidad ganada (la vendida, DEC-034 §3):
 *   la exige el WITH CHECK del alta.
 * - `scheduled_at`: la fecha y hora pactadas con el cliente (`timestamptz`,
 *   acotada entre 2000 y 2100 como la fecha del cierre). Se reprograma
 *   mientras la entrega está pendiente.
 * - `checklist`: jsonb con exactamente los cinco ítems de
 *   `deliveryChecklistItems`, cada uno booleano (CHECK). Nace sin nada
 *   verificado (policy de INSERT).
 * - `status`: nace `pending` y pasa una sola vez a `completed`, terminal. Se
 *   completa solo con el checklist entero verificado (CHECK y trigger).
 * - `completed_at` / `completed_by`: cuándo y quién la completó, los fija el
 *   trigger con el reloj de la base y `auth.uid()`. Existen si y solo si
 *   está completada.
 * - Todas las FKs son RESTRICT.
 *
 * Lectura: las entregas de las organizaciones con membership activa. Alta:
 * un miembro activo, como autor, pendiente, sin nada verificado, con el
 * reloj de la base, para la unidad vendida de una oportunidad ganada.
 * Edición: el checklist, la fecha pactada y el estado (grant por columna);
 * qué cambio vale lo decide el trigger `deliveries_change_guard` (SQL
 * custom de 0022). Sin DELETE: una entrega no se borra.
 */
export const deliveries = pgTable(
  "deliveries",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "restrict" }),
    opportunityId: uuid("opportunity_id").notNull(),
    vehicleId: uuid("vehicle_id").notNull(),
    scheduledAt: timestamp("scheduled_at", { withTimezone: true }).notNull(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    checklist: jsonb("checklist")
      .$type<DeliveryChecklistDb>()
      .notNull()
      .default(emptyDeliveryChecklist),
    status: text("status", { enum: deliveryStatuses })
      .notNull()
      .default("pending"),
    createdBy: uuid("created_by")
      .notNull()
      .references(() => profiles.id, { onDelete: "restrict" }),
    completedBy: uuid("completed_by").references(() => profiles.id, {
      onDelete: "restrict",
    }),
    ...timestamps,
  },
  (t) => [
    foreignKey({
      name: "deliveries_opportunity_fk",
      columns: [t.organizationId, t.opportunityId],
      foreignColumns: [opportunities.organizationId, opportunities.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "deliveries_vehicle_fk",
      columns: [t.organizationId, t.vehicleId],
      foreignColumns: [vehicles.organizationId, vehicles.id],
    }).onDelete("restrict"),
    unique("deliveries_organization_id_opportunity_id_key").on(
      t.organizationId,
      t.opportunityId,
    ),
    unique("deliveries_organization_id_vehicle_id_key").on(
      t.organizationId,
      t.vehicleId,
    ),
    check("deliveries_status_check", oneOf(t.status, deliveryStatuses)),
    // Exactamente los cinco ítems, cada uno booleano.
    check(
      "deliveries_checklist_check",
      sql`jsonb_typeof(${t.checklist}) = 'object' AND ${t.checklist} ?& ${checklistKeys} AND (${t.checklist} - ${checklistKeys}) = '{}'::jsonb AND ${sql.raw(
        deliveryChecklistItems
          .map(
            (item) =>
              `jsonb_typeof("deliveries"."checklist" -> '${item}') = 'boolean'`,
          )
          .join(" AND "),
      )}`,
    ),
    // Completada si y solo si tiene su sello, y solo con todo verificado.
    check(
      "deliveries_completion_check",
      sql`(${t.status} = 'completed') = (${t.completedAt} IS NOT NULL) AND (${t.completedAt} IS NULL) = (${t.completedBy} IS NULL) AND (${t.status} <> 'completed' OR ${t.checklist} = ${verifiedDeliveryChecklist})`,
    ),
    check(
      "deliveries_scheduled_at_check",
      sql`${t.scheduledAt} >= '2000-01-01 00:00:00+00' AND ${t.scheduledAt} < '2101-01-01 00:00:00+00'`,
    ),
    pgPolicy("deliveries_select_member", {
      for: "select",
      to: authenticatedRole,
      using: sql`${t.organizationId} IN ${userOrgIds}`,
    }),
    // Alta: un miembro activo, como autor, pendiente y sin nada verificado,
    // con el reloj de la base, para la unidad vinculada (vendida) de una
    // oportunidad ganada de la misma organización (DEC-053 §2).
    pgPolicy("deliveries_insert_member", {
      for: "insert",
      to: authenticatedRole,
      withCheck: sql`${t.organizationId} IN ${userOrgIds} AND ${t.createdBy} = ${authUid} AND ${t.status} = 'pending' AND ${t.completedAt} IS NULL AND ${t.completedBy} IS NULL AND ${t.checklist} = ${emptyDeliveryChecklist} AND ${t.createdAt} = now() AND ${t.updatedAt} = now() AND EXISTS (SELECT FROM ${opportunities} WHERE ${opportunities.organizationId} = ${t.organizationId} AND ${opportunities.id} = ${t.opportunityId} AND ${opportunities.stage} = 'won' AND ${opportunities.vehicleId} = ${t.vehicleId}) AND EXISTS (SELECT FROM ${vehicles} WHERE ${vehicles.organizationId} = ${t.organizationId} AND ${vehicles.id} = ${t.vehicleId} AND ${vehicles.status} = 'sold')`,
    }),
    // Edición: una entrega de una organización con membership activa, antes
    // y después. Qué cambia lo limitan el grant por columna y el trigger
    // (DEC-028 §5: una sola policy permisiva de UPDATE).
    pgPolicy("deliveries_update_member", {
      for: "update",
      to: authenticatedRole,
      using: sql`${t.organizationId} IN ${userOrgIds}`,
      withCheck: sql`${t.organizationId} IN ${userOrgIds}`,
    }),
    // Anular (Hito 22, DEC-054 §4): solo un admin de la organización y solo
    // una entrega pendiente. Una completada no se borra nunca (además, el
    // trigger deliveries_delete_guard de 0023 lo rechaza para cualquier
    // rol, también el dueño). Es el único DELETE del producto.
    pgPolicy("deliveries_delete_admin", {
      for: "delete",
      to: authenticatedRole,
      using: sql`${t.organizationId} IN ${userAdminOrgIds} AND ${t.status} = 'pending'`,
    }),
  ],
).enableRLS();
