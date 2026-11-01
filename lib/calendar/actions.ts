"use server";

import { revalidatePath } from "next/cache";

import {
  insertTestDrive,
  updateTestDriveStatus,
  type ScheduleOutcome,
  type StatusChangeOutcome,
} from "@/db/queries/test-drives-write";
import { planTestDriveTransition } from "@/domains/calendar/test-drives";
import { requireTenant } from "@/lib/tenant/session";

import {
  parseScheduleRequest,
  parseStatusChangeRequest,
  type ChangeTestDriveStatusState,
  type ScheduleTestDriveState,
} from "./requests";

/*
 * Escrituras de la agenda (Hito 9, DEC-041 §3). Cada Server Action es un
 * endpoint público y la única puerta de su flujo.
 *
 * Agendar, scheduleTestDrive():
 *
 *   requireTenant() → validar el formulario → insertTestDrive()
 *   (withTenant(), oportunidad abierta y unidad probable, INSERT) →
 *   revalidar /calendar
 *
 * Cambiar el estado, changeTestDriveStatus():
 *
 *   requireTenant() → leer el pedido → updateTestDriveStatus() (withTenant(),
 *   fila bloqueada, estado esperado, matriz del dominio, UPDATE, trigger) →
 *   revalidar /calendar
 *
 * 1. El TenantContext sale de requireTenant(), como en todo loader o acción
 *    tenant-scoped (DEC-021): sin sesión → /login, sin membership activa →
 *    /no-access. Nada del payload elige organización, usuario ni rol.
 *    Autorización: membership activa AND role IN ('admin', 'seller'), hoy
 *    todo contexto que emite requireTenant(). Cualquier miembro agenda y
 *    mueve cualquier prueba de su organización (DEC-023: sin responsable
 *    asignado).
 * 2. El pedido se valida acá, en el servidor. Un pedido inválido no llega a
 *    la base.
 * 3. Nada se envía al cliente: agendar o confirmar no manda mensajes
 *    (CLAUDE.md §2). La agenda es interna.
 * 4. Un error inesperado no expone detalles de la base y no revalida.
 *
 * El estado previo (`_previous`) lo envía el cliente: no se usa.
 */

const CALENDAR_PATH = "/calendar";

/*
 * Para diagnosticar sin exponer lo cargado: solo el tipo de error y el
 * SQLSTATE. El mensaje de Drizzle incluye la query y sus parámetros, así que
 * nunca se registra.
 */
function logFailure(operation: "schedule" | "change status", error: unknown) {
  const { name, cause } =
    error instanceof Error ? error : { name: undefined, cause: undefined };
  const code =
    typeof cause === "object" && cause !== null && "code" in cause
      ? cause.code
      : undefined;
  console.error(`[calendar] ${operation} failed`, { name, code });
}

export async function scheduleTestDrive(
  _previous: ScheduleTestDriveState,
  formData: FormData,
): Promise<ScheduleTestDriveState> {
  const ctx = await requireTenant();

  const parsed = parseScheduleRequest(formData, new Date());
  if (!parsed.ok) {
    return { status: "invalid", errors: parsed.errors, values: parsed.values };
  }

  let outcome: ScheduleOutcome;
  try {
    outcome = await insertTestDrive(ctx, {
      opportunityId: parsed.opportunityId,
      vehicleId: parsed.vehicleId,
      scheduledAt: parsed.scheduledAt,
    });
  } catch (error) {
    logFailure("schedule", error);
    return { status: "failed", values: parsed.values };
  }

  switch (outcome.outcome) {
    case "scheduled":
      revalidatePath(CALENDAR_PATH);
      return {
        status: "scheduled",
        testDriveId: outcome.testDriveId,
        scheduledAt: outcome.scheduledAt.toISOString(),
      };
    case "opportunity_unavailable":
      return {
        status: "invalid",
        errors: { opportunityId: "unavailable" },
        values: parsed.values,
      };
    case "vehicle_unavailable":
      return {
        status: "invalid",
        errors: { vehicleId: "unavailable" },
        values: parsed.values,
      };
  }
}

export async function changeTestDriveStatus(
  _previous: ChangeTestDriveStatusState,
  formData: FormData,
): Promise<ChangeTestDriveStatusState> {
  const ctx = await requireTenant();

  const parsed = parseStatusChangeRequest(formData);
  if (!parsed.ok) return { status: "not_found" };
  const { testDriveId, from, to } = parsed;

  let outcome: StatusChangeOutcome;
  try {
    outcome = await updateTestDriveStatus(
      ctx,
      { testDriveId, from, to },
      (locked) => {
        const plan = planTestDriveTransition(
          locked.status,
          to,
          locked.scheduledAt,
          new Date(),
        );
        return plan.ok ? "ok" : plan.error;
      },
    );
  } catch (error) {
    logFailure("change status", error);
    return { status: "failed" };
  }

  switch (outcome.outcome) {
    case "changed":
      revalidatePath(CALENDAR_PATH);
      return { status: "changed", testDriveId, to: outcome.status };
    case "unchanged":
      // Muestra el estado real que dejó otra persona.
      revalidatePath(CALENDAR_PATH);
      return { status: "unchanged", testDriveId, current: outcome.current };
    case "not_found":
      return { status: "not_found" };
    case "invalid_transition":
      return { status: "invalid_transition" };
    case "not_started":
      return { status: "not_started" };
  }
}
