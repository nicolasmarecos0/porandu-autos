import { sql } from "drizzle-orm";
import {
  check,
  foreignKey,
  index,
  pgPolicy,
  pgTable,
  text,
  timestamp,
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
 * Estados de una prueba de manejo. Espeja TEST_DRIVE_STATUSES de
 * domains/calendar/test-drives.ts (un test vigila que coincidan).
 */
export const testDriveStatuses = [
  "scheduled",
  "confirmed",
  "completed",
  "no_show",
  "cancelled",
] as const;

/**
 * Tolerancia hacia atrás del alta. Espeja SCHEDULE_PAST_TOLERANCE_MINUTES
 * de domains/calendar/test-drives.ts.
 */
export const testDriveScheduleToleranceMinutes = 5;

/*
 * Pruebas de manejo de la agenda (Hito 9, DEC-041 §2). Tenant-scoped
 * (ADR-001 §3.6): `organization_id` NOT NULL, FK simple a `organizations` e
 * índices que empiezan por `organization_id`.
 *
 * - `opportunity_id`: FK compuesta (organization_id, opportunity_id) →
 *   opportunities: el cliente es de la misma organización.
 * - `vehicle_id`: FK compuesta (organization_id, vehicle_id) → vehicles (la
 *   unique de 0009): la unidad es de la misma organización.
 * - `scheduled_at`: el instante agendado. El CHECK lo acota a 2000–2100; la
 *   policy de INSERT exige que no sea anterior a `now()` menos la
 *   tolerancia.
 * - `status`: CHECK con los cinco estados. Nace `scheduled` (policy de
 *   INSERT) y cambia solo por la matriz del trigger
 *   `test_drives_status_transition` (SQL custom de 0015, drizzle-kit no
 *   modela triggers), que también exige la hora agendada para `completed` y
 *   `no_show` y fija `updated_at` con el reloj de la base.
 * - `created_by`: el miembro que la agendó (FK a `profiles`, RESTRICT).
 * - Índices: (organization_id, scheduled_at) para la semana y
 *   (organization_id, opportunity_id) para las pruebas de una oportunidad.
 * - Todas las FKs son RESTRICT.
 *
 * Lectura: las pruebas de las organizaciones con membership activa. Alta: un
 * miembro activo, como autor de la request, en estado `scheduled` y con el
 * reloj de la base. Edición: solo `status` y `updated_at` (grant por
 * columna) de una prueba de su organización. Sin DELETE: una prueba se
 * cancela, no se borra.
 */
export const testDrives = pgTable(
  "test_drives",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "restrict" }),
    opportunityId: uuid("opportunity_id").notNull(),
    vehicleId: uuid("vehicle_id").notNull(),
    scheduledAt: timestamp("scheduled_at", { withTimezone: true }).notNull(),
    status: text("status", { enum: testDriveStatuses })
      .notNull()
      .default("scheduled"),
    createdBy: uuid("created_by")
      .notNull()
      .references(() => profiles.id, { onDelete: "restrict" }),
    ...timestamps,
  },
  (t) => [
    foreignKey({
      name: "test_drives_opportunity_fk",
      columns: [t.organizationId, t.opportunityId],
      foreignColumns: [opportunities.organizationId, opportunities.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "test_drives_vehicle_fk",
      columns: [t.organizationId, t.vehicleId],
      foreignColumns: [vehicles.organizationId, vehicles.id],
    }).onDelete("restrict"),
    index("test_drives_organization_id_scheduled_at_idx").on(
      t.organizationId,
      t.scheduledAt,
    ),
    index("test_drives_organization_id_opportunity_id_idx").on(
      t.organizationId,
      t.opportunityId,
    ),
    check("test_drives_status_check", oneOf(t.status, testDriveStatuses)),
    check(
      "test_drives_scheduled_at_check",
      sql`${t.scheduledAt} >= '2000-01-01T00:00:00Z'::timestamptz AND ${t.scheduledAt} < '2100-01-01T00:00:00Z'::timestamptz`,
    ),
    pgPolicy("test_drives_select_member", {
      for: "select",
      to: authenticatedRole,
      using: sql`${t.organizationId} IN ${userOrgIds}`,
    }),
    // Alta: un miembro activo, como autor de la request, en el estado
    // inicial, con el reloj de la base y no en el pasado.
    pgPolicy("test_drives_insert_member", {
      for: "insert",
      to: authenticatedRole,
      withCheck: sql`${t.organizationId} IN ${userOrgIds} AND ${t.createdBy} = ${authUid} AND ${t.status} = 'scheduled' AND ${t.createdAt} = now() AND ${t.updatedAt} = now() AND ${t.scheduledAt} >= now() - interval '${sql.raw(String(testDriveScheduleToleranceMinutes))} minutes'`,
    }),
    // Edición: una prueba de una organización con membership activa, antes
    // y después. Qué cambia lo limitan el grant por columna y el trigger.
    pgPolicy("test_drives_update_member", {
      for: "update",
      to: authenticatedRole,
      using: sql`${t.organizationId} IN ${userOrgIds}`,
      withCheck: sql`${t.organizationId} IN ${userOrgIds}`,
    }),
  ],
).enableRLS();
