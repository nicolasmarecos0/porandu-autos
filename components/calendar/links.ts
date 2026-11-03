import { WEEK_PARAM } from "@/domains/calendar/week";

/**
 * Enlace a la agenda con `day` (`YYYY-MM-DD`) en foco. Cualquier día
 * identifica su semana (DEC-041 §4) y queda en foco (DEC-045 §2).
 */
export function calendarHref(day: string): string {
  return `/calendar?${WEEK_PARAM}=${encodeURIComponent(day)}`;
}

/**
 * Parámetro que abre "Agendar prueba" con una unidad elegida (atajo del
 * catálogo, propuesta DEC-049). Es solo una preselección: el vendedor elige
 * el cliente y la hora, y scheduleTestDrive() vuelve a validar todo.
 */
export const SCHEDULE_VEHICLE_PARAM = "schedule";

/** Agenda de esta semana con "Agendar prueba" abierto para la unidad. */
export function scheduleTestDriveHref(vehicleId: string): string {
  return `/calendar?${SCHEDULE_VEHICLE_PARAM}=${encodeURIComponent(vehicleId)}`;
}
