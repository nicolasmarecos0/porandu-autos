import { wallClock, zonedInstant } from "./zoned-time";

/*
 * Pruebas de manejo (test drives) de la agenda (Hito 9, DEC-041). Módulo
 * puro y apto para el navegador: la UI lo usa para mostrar estados y
 * acciones y para avisar antes de enviar, pero las reglas las imponen el
 * servidor (lib/calendar/) y la base (CHECKs, policies y el trigger
 * `test_drives_status_transition` de 0015_test_drives, que espeja la matriz
 * de abajo).
 */

/** Zona de presentación y de carga de la agenda: P1 opera en Paraguay. */
export const CALENDAR_TIME_ZONE = "America/Asuncion";

/**
 * Estados de una prueba de manejo (MC §16, Agenda: pendiente, confirmado,
 * completado, cancelado, no-show). El orden es el de presentación.
 */
export const TEST_DRIVE_STATUSES = [
  "scheduled",
  "confirmed",
  "completed",
  "no_show",
  "cancelled",
] as const;

export type TestDriveStatus = (typeof TEST_DRIVE_STATUSES)[number];

/** Estado con el que nace toda prueba de manejo. */
export const INITIAL_TEST_DRIVE_STATUS =
  "scheduled" as const satisfies TestDriveStatus;

/** Estados abiertos: la prueba todavía puede cambiar. */
export const OPEN_TEST_DRIVE_STATUSES = [
  "scheduled",
  "confirmed",
] as const satisfies readonly TestDriveStatus[];

/** Copy visible (es-PY) de cada estado. */
export const TEST_DRIVE_STATUS_LABELS: Readonly<
  Record<TestDriveStatus, string>
> = {
  scheduled: "Agendada",
  confirmed: "Confirmada",
  completed: "Realizada",
  no_show: "No asistió",
  cancelled: "Cancelada",
};

/** Verbo de la acción que lleva a cada estado (menú de la tarjeta). */
export const TEST_DRIVE_ACTION_LABELS: Readonly<
  Record<Exclude<TestDriveStatus, "scheduled">, string>
> = {
  confirmed: "Confirmar",
  completed: "Marcar realizada",
  no_show: "Marcar no asistió",
  cancelled: "Cancelar prueba",
};

/**
 * Matriz de transiciones. Los estados realizada, no asistió y cancelada son
 * terminales: no se reabren (reprogramar es agendar otra prueba).
 */
export const TEST_DRIVE_TRANSITIONS: Readonly<
  Record<TestDriveStatus, readonly TestDriveStatus[]>
> = {
  scheduled: ["confirmed", "completed", "no_show", "cancelled"],
  confirmed: ["completed", "no_show", "cancelled"],
  completed: [],
  no_show: [],
  cancelled: [],
};

/**
 * Estados que describen algo que ya pasó: solo valen desde la hora
 * agendada (la base lo vuelve a exigir con su reloj).
 */
export const AFTER_START_STATUSES = [
  "completed",
  "no_show",
] as const satisfies readonly TestDriveStatus[];

export function isTestDriveStatus(value: unknown): value is TestDriveStatus {
  return (
    typeof value === "string" &&
    (TEST_DRIVE_STATUSES as readonly string[]).includes(value)
  );
}

export function isOpenTestDriveStatus(status: TestDriveStatus): boolean {
  return (OPEN_TEST_DRIVE_STATUSES as readonly TestDriveStatus[]).includes(
    status,
  );
}

function requiresStart(status: TestDriveStatus): boolean {
  return (AFTER_START_STATUSES as readonly TestDriveStatus[]).includes(status);
}

export type TestDriveTransitionError =
  /** El pase no existe en la matriz (incluye quedarse en el mismo estado). */
  | "invalid_transition"
  /** Realizada o no asistió antes de la hora agendada. */
  | "not_started";

export type TestDriveTransitionPlan =
  | Readonly<{ ok: true }>
  | Readonly<{ ok: false; error: TestDriveTransitionError }>;

/** ¿Puede una prueba agendada a `scheduledAt` pasar de `from` a `to` en `now`? */
export function planTestDriveTransition(
  from: TestDriveStatus,
  to: TestDriveStatus,
  scheduledAt: Date,
  now: Date,
): TestDriveTransitionPlan {
  if (!TEST_DRIVE_TRANSITIONS[from].includes(to)) {
    return { ok: false, error: "invalid_transition" };
  }
  if (requiresStart(to) && scheduledAt.getTime() > now.getTime()) {
    return { ok: false, error: "not_started" };
  }
  return { ok: true };
}

/** Destinos que la tarjeta ofrece en `now`, en el orden de la matriz. */
export function availableTransitions(
  from: TestDriveStatus,
  scheduledAt: Date,
  now: Date,
): TestDriveStatus[] {
  return TEST_DRIVE_TRANSITIONS[from].filter(
    (to) => planTestDriveTransition(from, to, scheduledAt, now).ok,
  );
}

/* Alta (agendar). */

/**
 * Campos que el servidor lee del formulario de alta. Organización, autor,
 * estado y reloj nunca salen del cliente.
 */
export const SCHEDULE_FIELDS = {
  opportunityId: "opportunityId",
  vehicleId: "vehicleId",
  scheduledAt: "scheduledAt",
} as const;

export type ScheduleField = keyof typeof SCHEDULE_FIELDS;

/** Campos del pedido de cambio de estado. */
export const STATUS_CHANGE_FIELDS = {
  testDriveId: "testDriveId",
  from: "from",
  to: "to",
} as const;

/**
 * Tolerancia hacia atrás al agendar, en minutos: cubre el tiempo entre
 * abrir el formulario y enviarlo. La policy de INSERT de la base exige lo
 * mismo con su reloj.
 */
export const SCHEDULE_PAST_TOLERANCE_MINUTES = 5;

/** Horizonte máximo de la agenda, en días. */
export const SCHEDULE_HORIZON_DAYS = 180;

/**
 * Franja que ocupa una prueba de manejo, en minutos. Solo sirve para avisar
 * una superposición de la misma unidad: no bloquea nada.
 */
export const TEST_DRIVE_SLOT_MINUTES = 60;

const LOCAL_DATE_TIME = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/;

/**
 * Instante de un `YYYY-MM-DDTHH:mm` (el valor de un `<input
 * type="datetime-local">`) leído como hora de pared de `timeZone`, o null
 * si el texto no es una fecha y hora válidas o esa hora no existió en la
 * zona. Input no confiable.
 */
export function parseLocalDateTime(raw: string, timeZone: string): Date | null {
  const match = LOCAL_DATE_TIME.exec(raw.trim());
  if (!match) return null;
  const [year, month, day, hour, minute] = match
    .slice(1)
    .map((part) => Number(part)) as [number, number, number, number, number];
  if (year < 2000 || year > 2100 || hour > 23 || minute > 59) return null;
  const probe = new Date(Date.UTC(year, month - 1, day));
  if (
    probe.getUTCFullYear() !== year ||
    probe.getUTCMonth() !== month - 1 ||
    probe.getUTCDate() !== day
  ) {
    return null;
  }
  return zonedInstant({ year, month, day, hour, minute, second: 0 }, timeZone);
}

/** `YYYY-MM-DDTHH:mm` de un instante en `timeZone` (para un datetime-local). */
export function toLocalDateTime(instant: Date, timeZone: string): string {
  const wall = wallClock(instant.getTime(), timeZone);
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${wall.year}-${pad(wall.month)}-${pad(wall.day)}T${pad(wall.hour)}:${pad(wall.minute)}`;
}

export type ScheduledAtError =
  "required" | "invalid" | "in_the_past" | "too_far";

export type ParsedScheduledAt =
  | Readonly<{ ok: true; scheduledAt: Date }>
  | Readonly<{ ok: false; error: ScheduledAtError }>;

/**
 * Fecha y hora de una prueba nueva: hora de pared de la agenda, desde
 * `now` (con la tolerancia) hasta el horizonte.
 */
export function parseScheduledAt(raw: string, now: Date): ParsedScheduledAt {
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

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * UUID normalizado de un id que manda el cliente, o null. Que sea un UUID
 * no significa que sea de la organización activa: eso lo deciden el filtro
 * explícito y RLS.
 */
export function readUuid(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const value = raw.trim();
  return UUID.test(value) ? value.toLowerCase() : null;
}
