import {
  availableTransitions,
  CALENDAR_TIME_ZONE,
  isOpenTestDriveStatus,
  TEST_DRIVE_SLOT_MINUTES,
  TEST_DRIVE_STATUSES,
  type TestDriveStatus,
} from "./test-drives";
import type { CalendarDay, CalendarWeek } from "./week";

/*
 * Presentación de la agenda semanal (Hito 9, DEC-041): agrupa las pruebas
 * de manejo por día, marca superposiciones de una misma unidad y cuenta por
 * estado. Puro: recibe las filas que leyó la capa de datos, el usuario de
 * la request y `now`.
 */

/** Una prueba de manejo tal como la lee la capa de datos. */
export type TestDriveRow = Readonly<{
  id: string;
  status: TestDriveStatus;
  scheduledAt: Date;
  opportunityId: string;
  contactName: string;
  vehicleId: string;
  vehicleBrand: string;
  vehicleModel: string;
  vehicleYear: number;
  createdBy: string;
}>;

export type AgendaItem = Readonly<{
  id: string;
  status: TestDriveStatus;
  /** ISO 8601: la hora exacta para `<time dateTime>`. */
  scheduledAtIso: string;
  /** "10:30", hora de Asunción. */
  timeLabel: string;
  /** "lunes 2 de noviembre, 10:30". */
  whenLabel: string;
  opportunityId: string;
  contactName: string;
  vehicleLabel: string;
  /** "Vos" u "Otro miembro". */
  scheduledByLabel: string;
  /** La misma unidad tiene otra prueba abierta a menos de una franja. */
  overlaps: boolean;
  /** Destinos que se pueden ofrecer ahora. */
  transitions: readonly TestDriveStatus[];
}>;

export type AgendaDay = CalendarDay &
  Readonly<{ items: readonly AgendaItem[] }>;

export type AgendaCounts = Readonly<Record<TestDriveStatus, number>>;

const TIME_FORMAT = new Intl.DateTimeFormat("es-PY", {
  timeZone: CALENDAR_TIME_ZONE,
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

const WHEN_FORMAT = new Intl.DateTimeFormat("es-PY", {
  timeZone: CALENDAR_TIME_ZONE,
  weekday: "long",
  day: "numeric",
  month: "long",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

export function testDriveTimeLabel(instant: Date): string {
  return TIME_FORMAT.format(instant);
}

export function testDriveWhenLabel(instant: Date): string {
  return WHEN_FORMAT.format(instant);
}

export function vehicleLabel(
  brand: string,
  model: string,
  year: number,
): string {
  return `${brand} ${model} ${year}`;
}

/**
 * Ids de las pruebas abiertas que comparten unidad con otra prueba abierta
 * a menos de TEST_DRIVE_SLOT_MINUTES. Solo un aviso: no bloquea nada.
 */
export function overlappingTestDrives(
  rows: readonly TestDriveRow[],
): Set<string> {
  const slot = TEST_DRIVE_SLOT_MINUTES * 60 * 1000;
  const byVehicle = new Map<string, TestDriveRow[]>();
  for (const row of rows) {
    if (!isOpenTestDriveStatus(row.status)) continue;
    const list = byVehicle.get(row.vehicleId) ?? [];
    list.push(row);
    byVehicle.set(row.vehicleId, list);
  }
  const overlapping = new Set<string>();
  for (const list of byVehicle.values()) {
    list.sort((a, b) => a.scheduledAt.getTime() - b.scheduledAt.getTime());
    for (let index = 1; index < list.length; index += 1) {
      const previous = list[index - 1];
      const current = list[index];
      if (!previous || !current) continue;
      if (
        current.scheduledAt.getTime() - previous.scheduledAt.getTime() <
        slot
      ) {
        overlapping.add(previous.id);
        overlapping.add(current.id);
      }
    }
  }
  return overlapping;
}

/** Orden estable: por hora, después por id. */
function byTime(a: TestDriveRow, b: TestDriveRow): number {
  return (
    a.scheduledAt.getTime() - b.scheduledAt.getTime() ||
    (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
  );
}

/**
 * Los días de la semana con sus pruebas, de la más temprana a la más
 * tardía. Una fila fuera de la semana no aparece.
 */
export function agendaDays(
  week: CalendarWeek,
  rows: readonly TestDriveRow[],
  userId: string,
  now: Date,
): AgendaDay[] {
  const overlapping = overlappingTestDrives(rows);
  const sorted = [...rows].sort(byTime);
  return week.days.map((day) => ({
    ...day,
    items: sorted
      .filter(
        (row) =>
          row.scheduledAt.getTime() >= day.start.getTime() &&
          row.scheduledAt.getTime() < day.end.getTime(),
      )
      .map((row) => ({
        id: row.id,
        status: row.status,
        scheduledAtIso: row.scheduledAt.toISOString(),
        timeLabel: testDriveTimeLabel(row.scheduledAt),
        whenLabel: testDriveWhenLabel(row.scheduledAt),
        opportunityId: row.opportunityId,
        contactName: row.contactName,
        vehicleLabel: vehicleLabel(
          row.vehicleBrand,
          row.vehicleModel,
          row.vehicleYear,
        ),
        scheduledByLabel: row.createdBy === userId ? "Vos" : "Otro miembro",
        overlaps: overlapping.has(row.id),
        transitions: availableTransitions(row.status, row.scheduledAt, now),
      })),
  }));
}

/** Cantidad de pruebas de la semana por estado (todos los estados, en 0). */
export function agendaCounts(rows: readonly TestDriveRow[]): AgendaCounts {
  const counts = Object.fromEntries(
    TEST_DRIVE_STATUSES.map((status) => [status, 0]),
  ) as Record<TestDriveStatus, number>;
  for (const row of rows) counts[row.status] += 1;
  return counts;
}

/** "1 prueba" / "3 pruebas". */
export function testDrivesLabel(count: number): string {
  return count === 1 ? "1 prueba" : `${count} pruebas`;
}

/* Opciones del formulario de alta. */

/** Una oportunidad abierta que se puede elegir al agendar. */
export type ScheduleOpportunityOption = Readonly<{
  id: string;
  contactName: string;
}>;

/** Una unidad que se puede probar (disponible o reservada). */
export type ScheduleVehicleOption = Readonly<{
  id: string;
  label: string;
}>;
