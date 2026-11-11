import { readUuid } from "@/domains/calendar/test-drives";
import {
  DELIVERY_CHECKLIST_FIELDS,
  DELIVERY_COMPLETION_FIELDS,
  DELIVERY_RESCHEDULE_FIELDS,
  DELIVERY_SCHEDULE_FIELDS,
  isDeliveryChecklistItem,
  parseDeliveryScheduledAt,
  type DeliveryChecklist,
  type DeliveryChecklistItem,
  type DeliveryScheduledAtError,
  type DeliveryVehicleConflictReason,
} from "@/domains/opportunities/deliveries";
import type { UnauthorizedRoleState } from "@/lib/auth/roles";

/*
 * Pedidos y respuestas de las Server Actions de la logística de entregas
 * (Hito 21, DEC-053). Cada pedido solo identifica la oportunidad o la
 * entrega y trae su dato (la fecha pactada o el ítem del checklist):
 * cualquier otro campo (organización, unidad, autor, estado, sello, reloj)
 * se ignora porque no tiene adónde ir. Nada de esto expone la base: ni
 * SQLSTATE, ni constraints, ni datos de otra organización.
 */

/** Respuesta de scheduleDelivery() y rescheduleDelivery(). */
export type ScheduleDeliveryState =
  | Readonly<{ status: "scheduled" }>
  | Readonly<{ status: "rescheduled" }>
  | Readonly<{ status: "unchanged" }>
  | Readonly<{
      status: "invalid";
      error: DeliveryScheduledAtError;
      value: string;
    }>
  | Readonly<{ status: "already_scheduled" }>
  | Readonly<{ status: "already_completed" }>
  | Readonly<{ status: "opportunity_not_won" }>
  | Readonly<{
      status: "vehicle_conflict";
      reason: DeliveryVehicleConflictReason;
    }>
  | Readonly<{ status: "not_found" }>
  | Readonly<{ status: "failed"; value: string }>
  | null;

/** Respuesta de setDeliveryChecklistItem(). */
export type DeliveryChecklistState =
  | Readonly<{ status: "changed"; checklist: DeliveryChecklist }>
  | Readonly<{ status: "unchanged"; checklist: DeliveryChecklist }>
  | Readonly<{ status: "already_completed" }>
  | Readonly<{ status: "not_found" }>
  | Readonly<{ status: "failed" }>
  | null;

/** Respuesta de cancelDelivery() (Hito 22, DEC-054 §4). */
export type CancelDeliveryState =
  | Readonly<{ status: "cancelled" }>
  | Readonly<{ status: "already_completed" }>
  /** Anular es de un admin (UNAUTHORIZED_ROLE). */
  | UnauthorizedRoleState
  | Readonly<{ status: "not_found" }>
  | Readonly<{ status: "failed" }>
  | null;

/** Respuesta de completeDelivery(). */
export type CompleteDeliveryState =
  | Readonly<{ status: "completed"; label: string }>
  | Readonly<{ status: "already_completed" }>
  | Readonly<{
      status: "checklist_incomplete";
      missing: readonly DeliveryChecklistItem[];
    }>
  | Readonly<{
      status: "vehicle_conflict";
      reason: DeliveryVehicleConflictReason;
    }>
  | Readonly<{ status: "not_found" }>
  | Readonly<{ status: "failed" }>
  | null;

function text(formData: FormData, field: string): string {
  const value = formData.get(field);
  return typeof value === "string" ? value : "";
}

export type ParsedScheduleRequest =
  | Readonly<{
      kind: "ok";
      id: string;
      scheduledAt: Date;
      value: string;
    }>
  | Readonly<{
      kind: "invalid";
      error: DeliveryScheduledAtError;
      value: string;
    }>
  | Readonly<{ kind: "not_found" }>;

function parseSchedule(
  formData: FormData,
  idField: string,
  now: Date,
): ParsedScheduleRequest {
  const id = readUuid(formData.get(idField));
  if (id === null) return { kind: "not_found" };
  const value = text(formData, DELIVERY_SCHEDULE_FIELDS.scheduledAt);
  const parsed = parseDeliveryScheduledAt(value, now);
  if (!parsed.ok) return { kind: "invalid", error: parsed.error, value };
  return { kind: "ok", id, scheduledAt: parsed.scheduledAt, value };
}

/** Programar: la oportunidad ganada y la fecha pactada. */
export function parseScheduleDeliveryRequest(
  formData: FormData,
  now: Date,
): ParsedScheduleRequest {
  return parseSchedule(formData, DELIVERY_SCHEDULE_FIELDS.opportunityId, now);
}

/** Reprogramar: la entrega y la fecha pactada nueva. */
export function parseRescheduleDeliveryRequest(
  formData: FormData,
  now: Date,
): ParsedScheduleRequest {
  return parseSchedule(formData, DELIVERY_RESCHEDULE_FIELDS.deliveryId, now);
}

export type ParsedChecklistRequest =
  | Readonly<{
      kind: "ok";
      deliveryId: string;
      item: DeliveryChecklistItem;
      checked: boolean;
    }>
  | Readonly<{ kind: "not_found" }>;

/**
 * Tildar o destildar un ítem: la entrega, el ítem y "true" o "false". Un
 * ítem o un valor desconocido es un pedido que no existe.
 */
export function parseDeliveryChecklistRequest(
  formData: FormData,
): ParsedChecklistRequest {
  const deliveryId = readUuid(
    formData.get(DELIVERY_CHECKLIST_FIELDS.deliveryId),
  );
  const item = formData.get(DELIVERY_CHECKLIST_FIELDS.item);
  const checked = formData.get(DELIVERY_CHECKLIST_FIELDS.checked);
  if (
    deliveryId === null ||
    !isDeliveryChecklistItem(item) ||
    (checked !== "true" && checked !== "false")
  ) {
    return { kind: "not_found" };
  }
  return { kind: "ok", deliveryId, item, checked: checked === "true" };
}

/** Anular: solo la entrega, como completar. */
export const parseCancelDeliveryRequest = (formData: FormData) =>
  parseCompleteDeliveryRequest(formData);

/** Completar: solo la entrega. El checklist es el guardado, no el del pedido. */
export function parseCompleteDeliveryRequest(
  formData: FormData,
):
  | Readonly<{ kind: "ok"; deliveryId: string }>
  | Readonly<{ kind: "not_found" }> {
  const deliveryId = readUuid(
    formData.get(DELIVERY_COMPLETION_FIELDS.deliveryId),
  );
  return deliveryId === null
    ? { kind: "not_found" }
    : { kind: "ok", deliveryId };
}
