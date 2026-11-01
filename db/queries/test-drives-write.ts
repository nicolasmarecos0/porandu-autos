import "server-only";

import { and, eq, inArray } from "drizzle-orm";

import type { TestDriveStatus } from "@/domains/calendar/test-drives";

import { opportunities, testDrives, vehicles } from "../schema";
import { withTenant, type TenantContext } from "../tenant";
import { SCHEDULABLE_STAGES, TESTABLE_VEHICLE_STATUSES } from "./calendar";

/*
 * Escrituras de la agenda (Hito 9, DEC-041 §3). La única puerta son las
 * Server Actions de lib/calendar/actions.ts (scheduleTestDrive() y
 * changeTestDriveStatus()), que obtienen el contexto con requireTenant() y
 * validan el pedido antes de llegar acá; ESLint impide importar este módulo
 * desde cualquier otro lado.
 *
 * Alta:
 *
 *   TenantContext → withTenant() → la oportunidad abierta y la unidad
 *   probable en la organización activa → INSERT → RLS (WITH CHECK) + FKs
 *   compuestas → COMMIT
 *
 * - El cliente solo elige la oportunidad, la unidad y la hora.
 *   `organization_id` y el autor salen del contexto; el estado inicial y el
 *   reloj los pone la base, y la policy de INSERT los exige.
 * - Una oportunidad cerrada, inexistente o de otra organización es
 *   `opportunity_unavailable`; una unidad en preparación, vendida,
 *   inexistente o de otra organización es `vehicle_unavailable`. Sin
 *   revelar cuál.
 *
 * Cambio de estado:
 *
 *   TenantContext → withTenant() → la prueba en la organización activa,
 *   bloqueada (FOR UPDATE) → estado esperado → UPDATE status → trigger
 *   (matriz, hora agendada, inmutabilidad) → COMMIT
 *
 * - Compare-and-set: el pedido dice de qué estado parte. Si la prueba ya
 *   cambió (otra persona la movió), es `unchanged` con su estado real y no
 *   se escribe nada.
 * - El trigger vuelve a exigir la matriz y la hora con el reloj de la base:
 *   un `not_started` de la base se informa igual que el del dominio.
 */

export type NewTestDrive = Readonly<{
  opportunityId: string;
  vehicleId: string;
  scheduledAt: Date;
}>;

export type ScheduleOutcome =
  | Readonly<{ outcome: "scheduled"; testDriveId: string; scheduledAt: Date }>
  | Readonly<{ outcome: "opportunity_unavailable" }>
  | Readonly<{ outcome: "vehicle_unavailable" }>;

export async function insertTestDrive(
  ctx: TenantContext,
  request: NewTestDrive,
): Promise<ScheduleOutcome> {
  return withTenant(ctx, async (tx) => {
    // Ya validado por withTenant(): un contexto emitido por Tenant Resolution.
    const { organizationId, userId } = ctx;

    const [opportunity] = await tx
      .select({ id: opportunities.id })
      .from(opportunities)
      .where(
        and(
          eq(opportunities.organizationId, organizationId),
          eq(opportunities.id, request.opportunityId),
          inArray(opportunities.stage, [...SCHEDULABLE_STAGES]),
        ),
      )
      .limit(1);
    if (!opportunity) return { outcome: "opportunity_unavailable" };

    const [vehicle] = await tx
      .select({ id: vehicles.id })
      .from(vehicles)
      .where(
        and(
          eq(vehicles.organizationId, organizationId),
          eq(vehicles.id, request.vehicleId),
          inArray(vehicles.status, [...TESTABLE_VEHICLE_STATUSES]),
        ),
      )
      .limit(1);
    if (!vehicle) return { outcome: "vehicle_unavailable" };

    const [created] = await tx
      .insert(testDrives)
      .values({
        organizationId,
        opportunityId: opportunity.id,
        vehicleId: vehicle.id,
        scheduledAt: request.scheduledAt,
        createdBy: userId,
      })
      .returning({ id: testDrives.id, scheduledAt: testDrives.scheduledAt });
    if (!created) throw new Error("test drive insert returned no row");
    return {
      outcome: "scheduled",
      testDriveId: created.id,
      scheduledAt: created.scheduledAt,
    };
  });
}

export type StatusChangeRequest = Readonly<{
  testDriveId: string;
  from: TestDriveStatus;
  to: TestDriveStatus;
}>;

/** Fila bloqueada que el plan del dominio necesita. */
export type LockedTestDrive = Readonly<{
  status: TestDriveStatus;
  scheduledAt: Date;
}>;

export type StatusChangeOutcome =
  | Readonly<{ outcome: "changed"; status: TestDriveStatus }>
  /** La prueba ya no estaba en `from`: no cambió nada. */
  | Readonly<{ outcome: "unchanged"; current: TestDriveStatus }>
  /** No existe o no es de la organización activa. */
  | Readonly<{ outcome: "not_found" }>
  /** El pase no existe en la matriz. */
  | Readonly<{ outcome: "invalid_transition" }>
  /** Realizada o no asistió antes de la hora agendada. */
  | Readonly<{ outcome: "not_started" }>;

/**
 * `plan` decide con la fila bloqueada (domains/calendar/test-drives.ts):
 * así la regla del dominio y la del trigger miran el mismo estado.
 */
export async function updateTestDriveStatus(
  ctx: TenantContext,
  request: StatusChangeRequest,
  plan: (
    locked: LockedTestDrive,
  ) => "ok" | "invalid_transition" | "not_started",
): Promise<StatusChangeOutcome> {
  try {
    return await withTenant(ctx, async (tx) => {
      const { organizationId } = ctx;
      const [row] = await tx
        .select({
          status: testDrives.status,
          scheduledAt: testDrives.scheduledAt,
        })
        .from(testDrives)
        .where(
          and(
            eq(testDrives.organizationId, organizationId),
            eq(testDrives.id, request.testDriveId),
          ),
        )
        .limit(1)
        .for("update");
      if (!row) return { outcome: "not_found" };
      if (row.status !== request.from) {
        return { outcome: "unchanged", current: row.status };
      }

      const decision = plan(row);
      if (decision !== "ok") return { outcome: decision };

      const [updated] = await tx
        .update(testDrives)
        .set({ status: request.to })
        .where(
          and(
            eq(testDrives.organizationId, organizationId),
            eq(testDrives.id, request.testDriveId),
            eq(testDrives.status, request.from),
          ),
        )
        .returning({ status: testDrives.status });
      if (!updated) throw new Error("test drive update returned no row");
      return { outcome: "changed", status: updated.status };
    });
  } catch (error) {
    // El reloj de la base manda: la hora agendada pudo no haber llegado
    // todavía para ella aunque el servidor de la app ya la viera pasar.
    if (constraintOf(error) === "test_drives_not_started") {
      return { outcome: "not_started" };
    }
    throw error;
  }
}

/** `constraint_name` de un error de PostgreSQL envuelto por Drizzle. */
function constraintOf(error: unknown): string | undefined {
  const cause =
    error instanceof Error && typeof error.cause === "object"
      ? error.cause
      : error;
  if (typeof cause !== "object" || cause === null) return undefined;
  const value = (cause as { constraint_name?: unknown }).constraint_name;
  return typeof value === "string" ? value : undefined;
}
