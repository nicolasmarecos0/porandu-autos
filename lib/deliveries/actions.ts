"use server";

import { revalidatePath } from "next/cache";

import {
  completeDeliveryWithExit,
  deleteDelivery,
  insertDelivery,
  writeDeliveryChecklistItem,
  writeDeliverySchedule,
  type CancelDeliveryOutcome,
  type CompleteDeliveryOutcome,
  type DeliveryChecklistOutcome,
  type RescheduleDeliveryOutcome,
  type ScheduleDeliveryOutcome,
} from "@/db/queries/deliveries-write";
import { authorize, unauthorizedRole } from "@/lib/auth/roles";
import { PIPELINE_PATH } from "@/lib/opportunities/paths";
import { opportunityPath } from "@/lib/quotes/paths";
import { requireTenant } from "@/lib/tenant/session";
import { VEHICLE_LIFECYCLE_PATHS } from "@/lib/vehicles/paths";

import {
  parseCancelDeliveryRequest,
  parseCompleteDeliveryRequest,
  parseDeliveryChecklistRequest,
  parseRescheduleDeliveryRequest,
  parseScheduleDeliveryRequest,
  type CancelDeliveryState,
  type CompleteDeliveryState,
  type DeliveryChecklistState,
  type ScheduleDeliveryState,
} from "./requests";

/*
 * Escrituras de la logística de entregas (Hito 21, DEC-053 §3 y §4). Cada
 * Server Action es un endpoint público y la única puerta de su flujo:
 *
 *   requireTenant() → leer y validar el pedido → db/queries/deliveries-write
 *   (withTenant(), filas bloqueadas, plan del dominio, INSERT / UPDATE
 *   compare-and-set, RLS + CHECKs + triggers) → revalidar
 *
 * - scheduleDelivery(): programa la entrega de una oportunidad Ganada con
 *   su unidad Vendida (la fecha pactada con el cliente).
 * - rescheduleDelivery(): cambia la fecha pactada de una pendiente.
 * - setDeliveryChecklistItem(): tilda o destilda un ítem del checklist.
 * - completeDelivery(): con el checklist guardado entero verificado,
 *   completa la entrega y pasa la unidad a Entregada en una sola
 *   transacción (DEC-053 §4). Es irreversible: la UI lo confirma antes con
 *   un alertdialog (CLAUDE.md §2: aprobación humana).
 * - cancelDelivery() (Hito 22, DEC-054 §4): anula una entrega pendiente.
 *   Solo un admin (`delivery.cancel`, lib/auth/roles.ts): un seller recibe
 *   UNAUTHORIZED_ROLE sin tocar la base. Una completada no se anula nunca.
 *   También pide confirmación en la UI.
 *
 * 1. El TenantContext sale de requireTenant() (DEC-021): sin sesión →
 *    /login, sin membership activa → /no-access. Nada del payload elige
 *    organización, usuario ni rol. La autorización es la de DEC-027 §4:
 *    membership activa (admin o seller).
 * 2. El pedido se valida acá, en el servidor. Un pedido inválido no llega a
 *    escribirse.
 * 3. Ninguna toca la oportunidad ni su cierre (DEC-034 §4: inmutable), ni
 *    `last_activity_at`.
 * 4. Un error inesperado no expone detalles de la base (los logs no
 *    registran valores) y no revalida.
 *
 * Se revalidan el detalle de la oportunidad y el embudo; al completar,
 * también las vistas del ciclo de vida de la unidad (/stock, el catálogo,
 * /cockpit y sus métricas): la unidad sale del salón. El estado previo
 * (`_previous`) lo envía el cliente: no se usa.
 */

function revalidateDelivery(opportunityId: string): void {
  revalidatePath(opportunityPath(opportunityId));
  revalidatePath(PIPELINE_PATH);
}

/*
 * Para diagnosticar sin exponer lo cargado: solo el tipo de error, el
 * SQLSTATE y la constraint.
 */
function logFailure(
  operation: "schedule" | "reschedule" | "checklist" | "complete" | "cancel",
  error: unknown,
): void {
  const { name, cause } =
    error instanceof Error ? error : { name: undefined, cause: undefined };
  const source = cause ?? error;
  const detail = (key: "code" | "constraint_name") =>
    typeof source === "object" && source !== null && key in source
      ? (source as Record<typeof key, unknown>)[key]
      : undefined;
  console.error(`[deliveries] ${operation} failed`, {
    name,
    code: detail("code"),
    constraint_name: detail("constraint_name"),
  });
}

export async function scheduleDelivery(
  _previous: ScheduleDeliveryState,
  formData: FormData,
): Promise<ScheduleDeliveryState> {
  const ctx = await requireTenant();

  const parsed = parseScheduleDeliveryRequest(formData, new Date());
  if (parsed.kind === "not_found") return { status: "not_found" };
  if (parsed.kind === "invalid") {
    return { status: "invalid", error: parsed.error, value: parsed.value };
  }

  let outcome: ScheduleDeliveryOutcome;
  try {
    outcome = await insertDelivery(ctx, {
      opportunityId: parsed.id,
      scheduledAt: parsed.scheduledAt,
    });
  } catch (error) {
    logFailure("schedule", error);
    return { status: "failed", value: parsed.value };
  }

  switch (outcome.outcome) {
    case "scheduled":
      revalidateDelivery(outcome.opportunityId);
      return { status: "scheduled" };
    case "already_scheduled":
      // La página vuelve con la entrega que programó otra persona.
      revalidateDelivery(outcome.opportunityId);
      return { status: "already_scheduled" };
    case "opportunity_not_won":
      revalidateDelivery(outcome.opportunityId);
      return { status: "opportunity_not_won" };
    case "vehicle_required":
      return { status: "opportunity_not_won" };
    case "vehicle_conflict":
      revalidateDelivery(outcome.opportunityId);
      return { status: "vehicle_conflict", reason: outcome.reason };
    case "not_found":
      return { status: "not_found" };
  }
}

export async function rescheduleDelivery(
  _previous: ScheduleDeliveryState,
  formData: FormData,
): Promise<ScheduleDeliveryState> {
  const ctx = await requireTenant();

  const parsed = parseRescheduleDeliveryRequest(formData, new Date());
  if (parsed.kind === "not_found") return { status: "not_found" };
  if (parsed.kind === "invalid") {
    return { status: "invalid", error: parsed.error, value: parsed.value };
  }

  let outcome: RescheduleDeliveryOutcome;
  try {
    outcome = await writeDeliverySchedule(ctx, {
      deliveryId: parsed.id,
      scheduledAt: parsed.scheduledAt,
    });
  } catch (error) {
    logFailure("reschedule", error);
    return { status: "failed", value: parsed.value };
  }

  switch (outcome.outcome) {
    case "rescheduled":
      revalidateDelivery(outcome.opportunityId);
      return { status: "rescheduled" };
    case "unchanged":
      return { status: "unchanged" };
    case "already_completed":
      revalidateDelivery(outcome.opportunityId);
      return { status: "already_completed" };
    case "not_found":
      return { status: "not_found" };
  }
}

export async function setDeliveryChecklistItem(
  _previous: DeliveryChecklistState,
  formData: FormData,
): Promise<DeliveryChecklistState> {
  const ctx = await requireTenant();

  const parsed = parseDeliveryChecklistRequest(formData);
  if (parsed.kind === "not_found") return { status: "not_found" };

  let outcome: DeliveryChecklistOutcome;
  try {
    outcome = await writeDeliveryChecklistItem(ctx, {
      deliveryId: parsed.deliveryId,
      item: parsed.item,
      checked: parsed.checked,
    });
  } catch (error) {
    logFailure("checklist", error);
    return { status: "failed" };
  }

  switch (outcome.outcome) {
    case "changed":
    case "unchanged":
      // Con `unchanged` también: la página vuelve con lo que tildó otro.
      revalidateDelivery(outcome.opportunityId);
      return { status: outcome.outcome, checklist: outcome.checklist };
    case "already_completed":
      revalidateDelivery(outcome.opportunityId);
      return { status: "already_completed" };
    case "not_found":
      return { status: "not_found" };
  }
}

export async function completeDelivery(
  _previous: CompleteDeliveryState,
  formData: FormData,
): Promise<CompleteDeliveryState> {
  const ctx = await requireTenant();

  const parsed = parseCompleteDeliveryRequest(formData);
  if (parsed.kind === "not_found") return { status: "not_found" };

  let outcome: CompleteDeliveryOutcome;
  try {
    outcome = await completeDeliveryWithExit(ctx, parsed.deliveryId);
  } catch (error) {
    logFailure("complete", error);
    return { status: "failed" };
  }

  switch (outcome.outcome) {
    case "completed": {
      revalidateDelivery(outcome.opportunityId);
      // La unidad sale del salón: Inventario, Catálogo, Cockpit y Métricas.
      for (const path of VEHICLE_LIFECYCLE_PATHS) revalidatePath(path);
      const { brand, model, year } = outcome.unit;
      return { status: "completed", label: `${brand} ${model} ${year}` };
    }
    case "already_completed":
      revalidateDelivery(outcome.opportunityId);
      return { status: "already_completed" };
    case "checklist_incomplete":
      revalidateDelivery(outcome.opportunityId);
      return { status: "checklist_incomplete", missing: outcome.missing };
    case "vehicle_conflict":
      revalidateDelivery(outcome.opportunityId);
      return { status: "vehicle_conflict", reason: outcome.reason };
    case "not_found":
      return { status: "not_found" };
  }
}

export async function cancelDelivery(
  _previous: CancelDeliveryState,
  formData: FormData,
): Promise<CancelDeliveryState> {
  const ctx = await requireTenant();
  const denied = authorize(ctx.role, "delivery.cancel");
  if (denied) return denied;

  const parsed = parseCancelDeliveryRequest(formData);
  if (parsed.kind === "not_found") return { status: "not_found" };

  let outcome: CancelDeliveryOutcome;
  try {
    outcome = await deleteDelivery(ctx, parsed.deliveryId);
  } catch (error) {
    logFailure("cancel", error);
    return { status: "failed" };
  }

  switch (outcome.outcome) {
    case "cancelled":
      revalidateDelivery(outcome.opportunityId);
      return { status: "cancelled" };
    case "already_completed":
      revalidateDelivery(outcome.opportunityId);
      return { status: "already_completed" };
    case "unauthorized_role":
      return unauthorizedRole("delivery.cancel");
    case "not_found":
      return { status: "not_found" };
  }
}
