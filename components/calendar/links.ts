import { WEEK_PARAM } from "@/domains/calendar/week";

/**
 * Enlace a la agenda con `day` (`YYYY-MM-DD`) en foco. Cualquier día
 * identifica su semana (DEC-041 §4) y queda en foco (DEC-045 §2).
 */
export function calendarHref(day: string): string {
  return `/calendar?${WEEK_PARAM}=${encodeURIComponent(day)}`;
}
