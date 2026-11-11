import {
  CALENDAR_TIME_ZONE,
  parseLocalDateTime,
  toLocalDateTime,
} from "@/domains/calendar/test-drives";
import { authorLabel } from "@/domains/demand/presentation";
import type { VehicleStatus } from "@/domains/vehicles/stock";

import {
  checklistProgress,
  DELIVERY_CHECKLIST_COPY,
  DELIVERY_CHECKLIST_ITEMS,
  DELIVERY_RECORD_STATUS_LABELS,
  DELIVERY_STAGE,
  deliveryBlockedMessage,
  isChecklistVerified,
  planDeliverySchedule,
  type DeliveryChecklist,
  type DeliveryChecklistItem,
  type DeliveryRecordStatus,
} from "./deliveries";
import type { Stage } from "./stages";

/*
 * Presentación del panel "Coordinación de Entrega" de /opportunities/[id]
 * (Hito 21, DEC-053). Pura y determinista: arma, desde lo que lee el
 * servidor, lo que muestra el panel y lo que ofrece. Solo existe con la
 * oportunidad Ganada: en otra etapa, el panel no se muestra.
 *
 * - Los autores llegan como "Vos" u "Otro miembro": ningún id de usuario
 *   sale del servidor.
 * - Las fechas se muestran en la hora de Asunción, la de la agenda.
 * - Las acciones son las que el dominio permite hoy; el servidor y la base
 *   las vuelven a exigir.
 */

/** Lo que el loader lee de la entrega de la oportunidad. */
export type DeliveryRow = Readonly<{
  id: string;
  status: DeliveryRecordStatus;
  scheduledAt: Date;
  checklist: DeliveryChecklist;
  createdBy: string;
  createdAt: Date;
  completedBy: string | null;
  completedAt: Date | null;
}>;

/** La unidad vinculada (la vendida), como la muestra el panel. */
export type DeliveryUnit = Readonly<{
  /** "Toyota Hilux". */
  name: string;
  /** "SRV 2.8 4x4 AT · 2025". */
  detail: string;
  status: VehicleStatus;
}>;

export type DeliveryChecklistEntry = Readonly<{
  item: DeliveryChecklistItem;
  label: string;
  hint: string;
  checked: boolean;
}>;

export type DeliveryView = Readonly<{
  id: string;
  status: DeliveryRecordStatus;
  statusLabel: string;
  /** El instante pactado (ISO), para comparar y ordenar. */
  scheduledAt: string;
  /** "jueves, 12 de noviembre, 10:30". */
  scheduledLabel: string;
  /** El valor del `datetime-local` para reprogramar. */
  scheduledInput: string;
  /** La fecha pactada ya pasó y la entrega sigue pendiente. */
  overdue: boolean;
  checklist: DeliveryChecklist;
  entries: readonly DeliveryChecklistEntry[];
  progress: Readonly<{ done: number; total: number }>;
  /** El checklist entero verificado: se puede completar. */
  verified: boolean;
  /** "Programó: Vos". */
  scheduledByLabel: string;
  /** "Entregó: Vos · jueves, 12 de noviembre, 10:42"; null pendiente. */
  completedLabel: string | null;
}>;

export type DeliveryPanelData =
  /** La oportunidad no está Ganada: no hay entrega que coordinar. */
  | Readonly<{ kind: "hidden" }>
  /** Ganada sin entrega todavía: se puede programar. */
  | Readonly<{
      kind: "unscheduled";
      unit: DeliveryUnit;
      /** Sugerencia para el `datetime-local`: la fecha del cierre o mañana. */
      suggestedInput: string;
      /** El mínimo del `datetime-local`: ahora. */
      minInput: string;
    }>
  /** Ganada, pero la unidad no está Vendida en el salón: no se programa. */
  | Readonly<{
      kind: "blocked";
      unit: DeliveryUnit | null;
      message: string;
    }>
  /** La entrega programada o completada. */
  | Readonly<{
      kind: "scheduled";
      unit: DeliveryUnit | null;
      delivery: DeliveryView;
      minInput: string;
    }>;

const WHEN = new Intl.DateTimeFormat("es-PY", {
  timeZone: CALENDAR_TIME_ZONE,
  weekday: "long",
  day: "numeric",
  month: "long",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

/** "jueves, 12 de noviembre, 10:30" en la hora de Asunción. */
export function deliveryWhenLabel(instant: Date): string {
  return WHEN.format(instant);
}

/** La hora que se sugiere para pactar una entrega: media mañana. */
export const SUGGESTED_DELIVERY_TIME = "10:00";

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * La fecha y hora que el formulario propone: la fecha de entrega que se
 * acordó en el cierre (DEC-034 §3), a media mañana, si todavía no pasó; si
 * no, mañana a la misma hora.
 */
export function suggestedDeliveryInput(
  closureDeliveryDate: string | null,
  now: Date,
): string {
  if (closureDeliveryDate !== null) {
    const raw = `${closureDeliveryDate}T${SUGGESTED_DELIVERY_TIME}`;
    const agreed = parseLocalDateTime(raw, CALENDAR_TIME_ZONE);
    if (agreed && agreed.getTime() > now.getTime()) return raw;
  }
  const tomorrow = toLocalDateTime(
    new Date(now.getTime() + DAY_MS),
    CALENDAR_TIME_ZONE,
  );
  return `${tomorrow.slice(0, 10)}T${SUGGESTED_DELIVERY_TIME}`;
}

/** Los ítems del checklist, con su copy, en orden. */
export function checklistEntries(
  checklist: DeliveryChecklist,
): readonly DeliveryChecklistEntry[] {
  return DELIVERY_CHECKLIST_ITEMS.map((item) => ({
    item,
    ...DELIVERY_CHECKLIST_COPY[item],
    checked: checklist[item],
  }));
}

/** Fila → vista de la entrega. */
export function deliveryView(
  row: DeliveryRow,
  context: Readonly<{ viewerUserId: string; now: Date }>,
): DeliveryView {
  const completed =
    row.status === "completed" &&
    row.completedAt !== null &&
    row.completedBy !== null;
  return {
    id: row.id,
    status: row.status,
    statusLabel: DELIVERY_RECORD_STATUS_LABELS[row.status],
    scheduledAt: row.scheduledAt.toISOString(),
    scheduledLabel: deliveryWhenLabel(row.scheduledAt),
    scheduledInput: toLocalDateTime(row.scheduledAt, CALENDAR_TIME_ZONE),
    overdue:
      row.status === "pending" &&
      row.scheduledAt.getTime() < context.now.getTime(),
    checklist: row.checklist,
    entries: checklistEntries(row.checklist),
    progress: checklistProgress(row.checklist),
    verified: isChecklistVerified(row.checklist),
    scheduledByLabel: `Programó: ${authorLabel(row.createdBy, context.viewerUserId)}`,
    completedLabel: completed
      ? `Entregó: ${authorLabel(row.completedBy, context.viewerUserId)} · ${deliveryWhenLabel(row.completedAt!)}`
      : null,
  };
}

/** Lo que el loader conoce de la oportunidad para armar el panel. */
export type DeliveryPanelContext = Readonly<{
  viewerUserId: string;
  stage: Stage;
  /** La unidad vinculada (la vendida); null sin unidad. */
  unit: (DeliveryUnit & Readonly<{ id: string }>) | null;
  /** La fecha de entrega acordada en el cierre (YYYY-MM-DD), si hay. */
  closureDeliveryDate: string | null;
  now: Date;
}>;

/** Filas → panel "Coordinación de Entrega". Pura. */
export function deliveryPanelData(
  row: DeliveryRow | null,
  context: DeliveryPanelContext,
): DeliveryPanelData {
  if (context.stage !== DELIVERY_STAGE) return { kind: "hidden" };
  const minInput = toLocalDateTime(context.now, CALENDAR_TIME_ZONE);
  const unit: DeliveryUnit | null = context.unit
    ? {
        name: context.unit.name,
        detail: context.unit.detail,
        status: context.unit.status,
      }
    : null;
  if (row !== null) {
    return {
      kind: "scheduled",
      unit,
      delivery: deliveryView(row, context),
      minInput,
    };
  }
  const plan = planDeliverySchedule({
    stage: context.stage,
    vehicleId: context.unit?.id ?? null,
    vehicleStatus: context.unit?.status ?? null,
    delivery: null,
  });
  switch (plan.kind) {
    case "schedule":
      return {
        kind: "unscheduled",
        unit: unit!,
        suggestedInput: suggestedDeliveryInput(
          context.closureDeliveryDate,
          context.now,
        ),
        minInput,
      };
    case "vehicle_conflict":
      return {
        kind: "blocked",
        unit,
        message: deliveryBlockedMessage(plan.reason),
      };
    case "vehicle_required":
    case "opportunity_not_won":
    case "already_scheduled":
      return {
        kind: "blocked",
        unit,
        message: "Esta venta no tiene una unidad vinculada para entregar.",
      };
  }
}

/** La vista de la entrega con el checklist que se muestra mientras guarda. */
export function withOptimisticChecklist(
  view: DeliveryView,
  checklist: DeliveryChecklist,
): DeliveryView {
  return {
    ...view,
    checklist,
    entries: checklistEntries(checklist),
    progress: checklistProgress(checklist),
    verified: isChecklistVerified(checklist),
  };
}

/** "3 de 5 verificados". */
export function progressLabel(
  progress: Readonly<{ done: number; total: number }>,
): string {
  return `${progress.done} de ${progress.total} verificados`;
}

/* ── Optimista (useOptimistic) ──────────────────────────────────────────── */

/** Lo que el panel muestra mientras una Server Action guarda. */
export type DeliveryOptimisticAction =
  | Readonly<{ kind: "check"; item: DeliveryChecklistItem; checked: boolean }>
  | Readonly<{ kind: "reschedule"; scheduledInput: string }>
  | Readonly<{ kind: "schedule" }>
  | Readonly<{ kind: "complete" }>;

export type DeliveryPanelState = Readonly<{
  data: DeliveryPanelData;
  /** Hay un pedido en vuelo: no se admite otro que lo contradiga. */
  saving: boolean;
}>;

/**
 * El panel con el cambio aplicado al instante. La página revalidada lo
 * reemplaza; si el servidor no lo hizo, vuelve el estado real. Pura.
 */
export function optimisticDeliveryPanel(
  state: DeliveryPanelState,
  action: DeliveryOptimisticAction,
): DeliveryPanelState {
  const { data } = state;
  if (data.kind !== "scheduled" || action.kind === "schedule") {
    return { data, saving: true };
  }
  const { delivery } = data;
  if (delivery.status === "completed") return { data, saving: true };
  switch (action.kind) {
    case "check":
      return {
        data: {
          ...data,
          delivery: withOptimisticChecklist(delivery, {
            ...delivery.checklist,
            [action.item]: action.checked,
          }),
        },
        saving: true,
      };
    case "reschedule": {
      const scheduledAt = parseLocalDateTime(
        action.scheduledInput,
        CALENDAR_TIME_ZONE,
      );
      if (!scheduledAt) return { data, saving: true };
      return {
        data: {
          ...data,
          delivery: {
            ...delivery,
            scheduledAt: scheduledAt.toISOString(),
            scheduledLabel: deliveryWhenLabel(scheduledAt),
            scheduledInput: action.scheduledInput,
            overdue: false,
          },
        },
        saving: true,
      };
    }
    case "complete":
      return {
        data: {
          ...data,
          unit: data.unit ? { ...data.unit, status: "delivered" } : null,
          delivery: {
            ...delivery,
            status: "completed",
            statusLabel: DELIVERY_RECORD_STATUS_LABELS.completed,
            overdue: false,
          },
        },
        saving: true,
      };
  }
}
