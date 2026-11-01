import {
  isTestDriveStatus,
  parseScheduledAt,
  readUuid,
  SCHEDULE_FIELDS,
  STATUS_CHANGE_FIELDS,
  type ScheduledAtError,
  type ScheduleField,
  type TestDriveStatus,
} from "@/domains/calendar/test-drives";

/*
 * Pedidos y respuestas de las Server Actions de la agenda (Hito 9, DEC-041
 * §3). Los pedidos son input no confiable: solo se leen los campos de
 * SCHEDULE_FIELDS y STATUS_CHANGE_FIELDS. Organización, autor, estado
 * inicial y reloj nunca salen del cliente. Nada de esto expone la base: ni
 * SQLSTATE, ni constraints, ni datos de otra organización.
 */

export type ScheduleFieldError = "required" | "unavailable" | ScheduledAtError;

export type ScheduleErrors = Partial<Record<ScheduleField, ScheduleFieldError>>;

/** Lo que el usuario cargó, para devolverlo al formulario tras un error. */
export type ScheduleValues = Readonly<Record<ScheduleField, string>>;

/** Respuesta de scheduleTestDrive(). */
export type ScheduleTestDriveState =
  | Readonly<{
      status: "invalid";
      errors: ScheduleErrors;
      values: ScheduleValues;
    }>
  /** Falla inesperada: nada se escribió y se puede reintentar. */
  | Readonly<{ status: "failed"; values: ScheduleValues }>
  | Readonly<{
      status: "scheduled";
      testDriveId: string;
      /** ISO 8601 del instante agendado. */
      scheduledAt: string;
    }>
  | null;

export type ParsedSchedule =
  | Readonly<{
      ok: true;
      opportunityId: string;
      vehicleId: string;
      scheduledAt: Date;
      values: ScheduleValues;
    }>
  | Readonly<{ ok: false; errors: ScheduleErrors; values: ScheduleValues }>;

function text(formData: FormData, field: ScheduleField): string {
  const raw = formData.get(SCHEDULE_FIELDS[field]);
  return typeof raw === "string" ? raw.trim().slice(0, 64) : "";
}

/**
 * Valida el alta en el servidor. Un id que no es UUID es "elegí uno de la
 * lista"; que sea un UUID no significa que sea de la organización activa:
 * eso lo deciden el filtro explícito y RLS.
 */
export function parseScheduleRequest(
  formData: FormData,
  now: Date,
): ParsedSchedule {
  const values: ScheduleValues = {
    opportunityId: text(formData, "opportunityId"),
    vehicleId: text(formData, "vehicleId"),
    scheduledAt: text(formData, "scheduledAt"),
  };
  const errors: ScheduleErrors = {};

  const opportunityId = readUuid(values.opportunityId);
  if (!opportunityId) errors.opportunityId = "required";

  const vehicleId = readUuid(values.vehicleId);
  if (!vehicleId) errors.vehicleId = "required";

  const scheduledAt = parseScheduledAt(values.scheduledAt, now);
  if (!scheduledAt.ok) errors.scheduledAt = scheduledAt.error;

  if (!opportunityId || !vehicleId || !scheduledAt.ok) {
    return { ok: false, errors, values };
  }
  return {
    ok: true,
    opportunityId,
    vehicleId,
    scheduledAt: scheduledAt.scheduledAt,
    values,
  };
}

/** Respuesta de changeTestDriveStatus(). */
export type ChangeTestDriveStatusState =
  | Readonly<{ status: "changed"; testDriveId: string; to: TestDriveStatus }>
  /** Ya no estaba en el estado de partida: `current` es el real. */
  | Readonly<{
      status: "unchanged";
      testDriveId: string;
      current: TestDriveStatus;
    }>
  /** No existe, no es de la organización activa o el pedido es inválido. */
  | Readonly<{ status: "not_found" }>
  /** El pase no existe en la matriz. */
  | Readonly<{ status: "invalid_transition" }>
  /** Realizada o no asistió antes de la hora agendada. */
  | Readonly<{ status: "not_started" }>
  /** Falla inesperada: no cambió nada y se puede reintentar. */
  | Readonly<{ status: "failed" }>
  | null;

export type ParsedStatusChange =
  | Readonly<{
      ok: true;
      testDriveId: string;
      from: TestDriveStatus;
      to: TestDriveStatus;
    }>
  | Readonly<{ ok: false }>;

export function parseStatusChangeRequest(
  formData: FormData,
): ParsedStatusChange {
  const testDriveId = readUuid(formData.get(STATUS_CHANGE_FIELDS.testDriveId));
  const from = formData.get(STATUS_CHANGE_FIELDS.from);
  const to = formData.get(STATUS_CHANGE_FIELDS.to);
  if (!testDriveId || !isTestDriveStatus(from) || !isTestDriveStatus(to)) {
    return { ok: false };
  }
  return { ok: true, testDriveId, from, to };
}
