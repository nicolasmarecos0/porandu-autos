import {
  CALENDAR_TIME_ZONE,
  parseLocalDateTime,
  SCHEDULE_HORIZON_DAYS,
  SCHEDULE_PAST_TOLERANCE_MINUTES,
} from "@/domains/calendar/test-drives";
import type { VehicleStatus } from "@/domains/vehicles/stock";

import type { Stage } from "./stages";

/*
 * Logística y entregas (Hito 21, DEC-053): el remito de entrega de la
 * unidad vendida al cliente de una oportunidad ganada. Módulo puro y apto
 * para el navegador: la UI lo usa para ofrecer las acciones y avisar antes
 * de enviar, pero la regla la imponen el servidor (los planners de abajo,
 * sobre las filas bloqueadas) y la base (el trigger
 * `deliveries_change_guard` de 0022_deliveries, que espeja esta matriz, sus
 * CHECKs y el trigger de vehicles, que solo da salida a una unidad con su
 * entrega completada).
 *
 *   (ganada + unidad vendida) ──programar──► pending ──completar──► completed
 *                                   ▲    │ tildar / reprogramar
 *                                   └────┘
 *
 * - Se programa una entrega solo si la oportunidad está Ganada y su unidad
 *   vinculada sigue Vendida (en el salón, todavía sin salida). Una por
 *   oportunidad y una por unidad.
 * - El checklist físico (llaves, manuales, auxilio, limpieza y documentos)
 *   se tilda de a un ítem mientras la entrega está pendiente.
 * - La regla del fundador: no se completa la entrega sin el checklist
 *   entero verificado (planDeliveryCompletion()).
 * - Completar es un solo acto: la entrega pasa a completada y la unidad a
 *   Entregada (`sold → delivered`, DEC-051 ampliada), en la misma
 *   transacción. Completada es terminal y la unidad sale del salón.
 */

/* ── Estados ────────────────────────────────────────────────────────────── */

export const DELIVERY_RECORD_STATUSES = ["pending", "completed"] as const;

export type DeliveryRecordStatus = (typeof DELIVERY_RECORD_STATUSES)[number];

/** Estado con el que nace toda entrega. */
export const INITIAL_DELIVERY_RECORD_STATUS =
  "pending" as const satisfies DeliveryRecordStatus;

/** Copy visible (es-PY), en femenino como la entrega. */
export const DELIVERY_RECORD_STATUS_LABELS: Readonly<
  Record<DeliveryRecordStatus, string>
> = {
  pending: "Entrega programada",
  completed: "Entregada",
};

/** Matriz: una pendiente se completa; una completada no cambia más. */
export const DELIVERY_TRANSITIONS: Readonly<
  Record<DeliveryRecordStatus, readonly DeliveryRecordStatus[]>
> = {
  pending: ["completed"],
  completed: [],
};

export function isDeliveryRecordStatus(
  value: unknown,
): value is DeliveryRecordStatus {
  return (
    typeof value === "string" &&
    (DELIVERY_RECORD_STATUSES as readonly string[]).includes(value)
  );
}

/** ¿Existe el pase `from → to`? Quedarse en el mismo estado, no. */
export function canTransitionDelivery(
  from: DeliveryRecordStatus,
  to: DeliveryRecordStatus,
): boolean {
  return DELIVERY_TRANSITIONS[from].includes(to);
}

/** La etapa en la que se programa una entrega: la venta cerrada. */
export const DELIVERY_STAGE = "won" as const satisfies Stage;

/** El estado de la unidad que se entrega: vendida, todavía en el salón. */
export const DELIVERABLE_VEHICLE_STATUS =
  "sold" as const satisfies VehicleStatus;

/* ── Checklist físico ───────────────────────────────────────────────────── */

/** Ítems del checklist, en el orden en que se revisan frente al cliente. */
export const DELIVERY_CHECKLIST_ITEMS = [
  "keys",
  "manuals",
  "spareTire",
  "cleaning",
  "documents",
] as const;

export type DeliveryChecklistItem = (typeof DELIVERY_CHECKLIST_ITEMS)[number];

export type DeliveryChecklist = Readonly<
  Record<DeliveryChecklistItem, boolean>
>;

export const DELIVERY_CHECKLIST_COPY: Readonly<
  Record<DeliveryChecklistItem, Readonly<{ label: string; hint: string }>>
> = {
  keys: {
    label: "Llaves",
    hint: "Llave principal y copia, probadas frente al cliente.",
  },
  manuals: {
    label: "Manuales",
    hint: "Manual del propietario y libreta de servicios.",
  },
  spareTire: {
    label: "Rueda de auxilio",
    hint: "Auxilio inflado, gato y llave de rueda.",
  },
  cleaning: {
    label: "Limpieza",
    hint: "Unidad lavada por fuera y por dentro.",
  },
  documents: {
    label: "Documentos",
    hint: "Título, cédula del vehículo y factura de la venta.",
  },
};

export function isDeliveryChecklistItem(
  value: unknown,
): value is DeliveryChecklistItem {
  return (
    typeof value === "string" &&
    (DELIVERY_CHECKLIST_ITEMS as readonly string[]).includes(value)
  );
}

function checklistOf(value: boolean): DeliveryChecklist {
  return Object.fromEntries(
    DELIVERY_CHECKLIST_ITEMS.map((item) => [item, value]),
  ) as Record<DeliveryChecklistItem, boolean>;
}

/** El checklist de una entrega recién programada: nada verificado. */
export const EMPTY_DELIVERY_CHECKLIST: DeliveryChecklist = checklistOf(false);

/** El checklist que exige completar: todo verificado. */
export const VERIFIED_DELIVERY_CHECKLIST: DeliveryChecklist = checklistOf(true);

/** Los ítems sin verificar, en el orden del checklist. */
export function missingChecklistItems(
  checklist: DeliveryChecklist,
): readonly DeliveryChecklistItem[] {
  return DELIVERY_CHECKLIST_ITEMS.filter((item) => !checklist[item]);
}

/** La regla del fundador: ¿está todo el checklist verificado? */
export function isChecklistVerified(checklist: DeliveryChecklist): boolean {
  return missingChecklistItems(checklist).length === 0;
}

/** Cuántos ítems están verificados, de cuántos. */
export function checklistProgress(
  checklist: DeliveryChecklist,
): Readonly<{ done: number; total: number }> {
  const total = DELIVERY_CHECKLIST_ITEMS.length;
  return { done: total - missingChecklistItems(checklist).length, total };
}

/** El checklist con un ítem cambiado. */
export function withChecklistItem(
  checklist: DeliveryChecklist,
  item: DeliveryChecklistItem,
  checked: boolean,
): DeliveryChecklist {
  return { ...checklist, [item]: checked };
}

/* ── Fecha pactada ──────────────────────────────────────────────────────── */

/**
 * Campos que el servidor lee de cada pedido. Organización, unidad, autor,
 * estado, sellos y reloj nunca salen del cliente: la unidad es la vinculada
 * de la oportunidad ganada.
 */
export const DELIVERY_SCHEDULE_FIELDS = {
  opportunityId: "opportunityId",
  scheduledAt: "scheduledAt",
} as const;

export const DELIVERY_RESCHEDULE_FIELDS = {
  deliveryId: "deliveryId",
  scheduledAt: "scheduledAt",
} as const;

export const DELIVERY_CHECKLIST_FIELDS = {
  deliveryId: "deliveryId",
  item: "item",
  checked: "checked",
} as const;

export const DELIVERY_COMPLETION_FIELDS = {
  deliveryId: "deliveryId",
} as const;

/** Anular (Hito 22, DEC-054 §4): solo la entrega. */
export const DELIVERY_CANCELLATION_FIELDS = DELIVERY_COMPLETION_FIELDS;

export type DeliveryScheduledAtError =
  "required" | "invalid" | "in_the_past" | "too_far";

export type ParsedDeliveryScheduledAt =
  | Readonly<{ ok: true; scheduledAt: Date }>
  | Readonly<{ ok: false; error: DeliveryScheduledAtError }>;

/**
 * La fecha y hora pactadas con el cliente (`YYYY-MM-DDTHH:mm`, hora de
 * pared de Asunción, la de la agenda): desde ahora, con la tolerancia de la
 * agenda, hasta su horizonte. Input no confiable.
 */
export function parseDeliveryScheduledAt(
  raw: string,
  now: Date,
): ParsedDeliveryScheduledAt {
  if (raw.trim() === "") return { ok: false, error: "required" };
  const scheduledAt = parseLocalDateTime(raw, CALENDAR_TIME_ZONE);
  if (!scheduledAt) return { ok: false, error: "invalid" };
  const earliest = now.getTime() - SCHEDULE_PAST_TOLERANCE_MINUTES * 60 * 1000;
  if (scheduledAt.getTime() < earliest) {
    return { ok: false, error: "in_the_past" };
  }
  const latest = now.getTime() + SCHEDULE_HORIZON_DAYS * 24 * 60 * 60 * 1000;
  if (scheduledAt.getTime() > latest) return { ok: false, error: "too_far" };
  return { ok: true, scheduledAt };
}

export const DELIVERY_SCHEDULED_AT_ERRORS: Readonly<
  Record<DeliveryScheduledAtError, string>
> = {
  required: "Elegí la fecha y la hora de la entrega.",
  invalid: "Esa fecha y hora no son válidas.",
  in_the_past: "La entrega no puede pactarse en el pasado.",
  too_far: `La entrega se pacta dentro de los próximos ${SCHEDULE_HORIZON_DAYS} días.`,
};

/* ── Planes sobre las filas bloqueadas ──────────────────────────────────── */

/** Lo que el servidor lee para programar: la oportunidad y su unidad. */
export type DeliveryScheduleTarget = Readonly<{
  stage: Stage;
  /** La unidad vinculada (DEC-033); null si no tiene. */
  vehicleId: string | null;
  /** Su estado, leído bloqueado; null si no tiene unidad. */
  vehicleStatus: VehicleStatus | null;
  /** La entrega de la oportunidad, si ya existe. */
  delivery: Readonly<{ id: string; status: DeliveryRecordStatus }> | null;
}>;

export type DeliveryVehicleConflictReason = "not_sold" | "already_delivered";

export type DeliverySchedulePlan =
  | Readonly<{ kind: "schedule"; vehicleId: string }>
  /** La oportunidad todavía no se ganó (o se perdió): no hay venta. */
  | Readonly<{ kind: "opportunity_not_won"; stage: Stage }>
  /** Una ganada siempre tiene unidad (DEC-034 §3); por las dudas. */
  | Readonly<{ kind: "vehicle_required" }>
  /** La unidad no está Vendida en el salón. */
  | Readonly<{
      kind: "vehicle_conflict";
      current: VehicleStatus;
      reason: DeliveryVehicleConflictReason;
    }>
  /** Ya tiene su entrega: se reprograma o se completa esa. */
  | Readonly<{
      kind: "already_scheduled";
      deliveryId: string;
      status: DeliveryRecordStatus;
    }>;

function vehicleConflictReason(
  status: VehicleStatus,
): DeliveryVehicleConflictReason {
  return status === "delivered" ? "already_delivered" : "not_sold";
}

/**
 * Decide, sin tocar nada, si se puede programar la entrega (la regla del
 * fundador): solo una oportunidad Ganada con su unidad Vendida, y una sola
 * entrega por venta. La base vuelve a exigirlo en la policy de INSERT.
 */
export function planDeliverySchedule(
  target: DeliveryScheduleTarget,
): DeliverySchedulePlan {
  if (target.stage !== DELIVERY_STAGE) {
    return { kind: "opportunity_not_won", stage: target.stage };
  }
  if (target.delivery !== null) {
    return {
      kind: "already_scheduled",
      deliveryId: target.delivery.id,
      status: target.delivery.status,
    };
  }
  if (target.vehicleId === null || target.vehicleStatus === null) {
    return { kind: "vehicle_required" };
  }
  if (target.vehicleStatus !== DELIVERABLE_VEHICLE_STATUS) {
    return {
      kind: "vehicle_conflict",
      current: target.vehicleStatus,
      reason: vehicleConflictReason(target.vehicleStatus),
    };
  }
  return { kind: "schedule", vehicleId: target.vehicleId };
}

/** Lo que el servidor lee de una entrega, bloqueada. */
export type DeliveryTarget = Readonly<{
  status: DeliveryRecordStatus;
  scheduledAt: Date;
  checklist: DeliveryChecklist;
}>;

export type DeliveryReschedulePlan =
  | Readonly<{ kind: "reschedule"; scheduledAt: Date }>
  /** Ya estaba pactada para ese momento. */
  | Readonly<{ kind: "unchanged" }>
  /** Ya se entregó: no se reprograma. */
  | Readonly<{ kind: "already_completed" }>;

/** Decide, sin tocar nada, qué pasa con una nueva fecha pactada. */
export function planDeliveryReschedule(
  target: DeliveryTarget,
  scheduledAt: Date,
): DeliveryReschedulePlan {
  if (target.status === "completed") return { kind: "already_completed" };
  if (target.scheduledAt.getTime() === scheduledAt.getTime()) {
    return { kind: "unchanged" };
  }
  return { kind: "reschedule", scheduledAt };
}

export type DeliveryChecklistPlan =
  | Readonly<{ kind: "change"; checklist: DeliveryChecklist }>
  /** El ítem ya estaba así (otra persona lo tildó antes). */
  | Readonly<{ kind: "unchanged"; checklist: DeliveryChecklist }>
  /** Ya se entregó: el checklist quedó como se verificó. */
  | Readonly<{ kind: "already_completed" }>;

/**
 * Decide, sin tocar nada, qué pasa al tildar o destildar un ítem. Solo
 * cambia ese ítem, sobre el checklist leído de la fila bloqueada: dos
 * personas que tildan ítems distintos a la vez no se pisan.
 */
export function planDeliveryChecklistChange(
  target: DeliveryTarget,
  item: DeliveryChecklistItem,
  checked: boolean,
): DeliveryChecklistPlan {
  if (target.status === "completed") return { kind: "already_completed" };
  if (target.checklist[item] === checked) {
    return { kind: "unchanged", checklist: target.checklist };
  }
  return {
    kind: "change",
    checklist: withChecklistItem(target.checklist, item, checked),
  };
}

export type DeliveryCompletionPlan =
  /** Completar la entrega y dar salida a la unidad, en una transacción. */
  | Readonly<{ kind: "complete" }>
  /** Ya estaba completada: nada cambia. */
  | Readonly<{ kind: "already_completed" }>
  /** La regla del fundador: falta verificar `missing`. */
  | Readonly<{
      kind: "checklist_incomplete";
      missing: readonly DeliveryChecklistItem[];
    }>
  /** La unidad ya no está Vendida en el salón: nada cambia. */
  | Readonly<{
      kind: "vehicle_conflict";
      current: VehicleStatus;
      reason: DeliveryVehicleConflictReason;
    }>;

/**
 * Decide, sin tocar nada, si la entrega se puede completar: el checklist
 * guardado (no el que ve el navegador) entero verificado y la unidad
 * todavía Vendida. La base vuelve a exigir las dos cosas.
 */
export function planDeliveryCompletion(
  target: DeliveryTarget,
  vehicleStatus: VehicleStatus,
): DeliveryCompletionPlan {
  if (target.status === "completed") return { kind: "already_completed" };
  const missing = missingChecklistItems(target.checklist);
  if (missing.length > 0) return { kind: "checklist_incomplete", missing };
  if (vehicleStatus !== DELIVERABLE_VEHICLE_STATUS) {
    return {
      kind: "vehicle_conflict",
      current: vehicleStatus,
      reason: vehicleConflictReason(vehicleStatus),
    };
  }
  return { kind: "complete" };
}

export type DeliveryCancellationPlan =
  /** Borrar el remito pendiente: la venta sigue Vendida, sin entrega. */
  | Readonly<{ kind: "cancel" }>
  /** Completada: la unidad ya salió del salón y no se anula nunca. */
  | Readonly<{ kind: "already_completed" }>;

/**
 * Decide, sin tocar nada, si una entrega se puede anular (Hito 22, DEC-054
 * §4): solo una pendiente. Quién la anula (un admin) lo decide
 * lib/auth/roles.ts (`delivery.cancel`); la base vuelve a exigir las dos
 * cosas (policy deliveries_delete_admin y trigger deliveries_delete_guard).
 */
export function planDeliveryCancellation(
  target: Pick<DeliveryTarget, "status">,
): DeliveryCancellationPlan {
  return target.status === "completed"
    ? { kind: "already_completed" }
    : { kind: "cancel" };
}

/* ── Copy (es-PY) ───────────────────────────────────────────────────────── */

export const CANCEL_DELIVERY_LABEL = "Anular entrega";

export const DELIVERY_PANEL_TITLE = "Coordinación de Entrega";

export const COMPLETE_DELIVERY_LABEL =
  "Completar Entrega y Dar Salida al Vehículo";

export const DELIVERY_PENDING_LABEL = "Guardando…";

/** "llaves, manuales y documentos": los ítems que faltan, en una frase. */
export function checklistItemsPhrase(
  items: readonly DeliveryChecklistItem[],
): string {
  const labels = items.map((item) =>
    DELIVERY_CHECKLIST_COPY[item].label.toLowerCase(),
  );
  if (labels.length <= 1) return labels.join("");
  return `${labels.slice(0, -1).join(", ")} y ${labels.at(-1)}`;
}

export function checklistIncompleteMessage(
  missing: readonly DeliveryChecklistItem[],
): string {
  return `Falta verificar ${checklistItemsPhrase(missing)}. La entrega no se completa sin el checklist entero.`;
}

/** Por qué la unidad no se puede entregar, en una oración. */
export function deliveryBlockedMessage(
  reason: DeliveryVehicleConflictReason,
): string {
  return reason === "already_delivered"
    ? "La unidad ya figura como Entregada: salió del salón."
    : "La unidad vinculada no figura como Vendida en el stock: la entrega se coordina con la unidad vendida.";
}

export function deliveryVehicleConflictMessage(
  reason: DeliveryVehicleConflictReason,
): string {
  return `${deliveryBlockedMessage(reason)} No se hizo ningún cambio.`;
}

export const OPPORTUNITY_NOT_WON_MESSAGE =
  "La entrega se coordina cuando la oportunidad está Ganada. No se hizo ningún cambio.";

export const DELIVERY_ALREADY_SCHEDULED_MESSAGE =
  "Esta venta ya tiene su entrega programada. No se hizo ningún cambio.";

export const DELIVERY_ALREADY_COMPLETED_MESSAGE =
  "La entrega ya se completó: la unidad salió del salón. No se hizo ningún cambio.";

export const DELIVERY_NOT_FOUND_MESSAGE =
  "No encontramos esa entrega. No se hizo ningún cambio.";

export const DELIVERY_FAILED_MESSAGE =
  "No pudimos guardar el cambio. No se hizo ningún cambio: intentá de nuevo en unos minutos.";

/** Aviso de la entrega completada. `unit`: "Toyota Hilux 2025". */
export function deliveryCompletedMessage(unit: string): string {
  return `Entrega completada: ${unit} salió del salón y ya no figura en el stock.`;
}

export const DELIVERY_COMPLETION_NOTICE =
  "Al confirmar, la entrega queda completada y la unidad pasa a «Entregada»: sale del Inventario, del Catálogo y de las Métricas del salón. No se puede deshacer.";
