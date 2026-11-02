import {
  CALENDAR_TIME_ZONE,
  TEST_DRIVE_SLOT_MINUTES,
} from "@/domains/calendar/test-drives";
import {
  addDays,
  isoDate,
  startOfZonedDay,
  zonedDate,
} from "@/domains/calendar/zoned-time";

/*
 * Ventana de tiempo del feed del Cockpit (Hito 15, DEC-047 §3): qué parte
 * del tiempo mira cada fuente, en días de calendario de Asunción. Pura: el
 * instante de la request (`now`) llega explícito, así que nada depende del
 * reloj ni de la zona del servidor. El loader (db/queries/cockpit.ts) usa
 * estos límites tal cual en sus WHERE y el dominio (./feed.ts) los usa para
 * rotular: los dos ven la misma frontera.
 *
 *   recentFrom            upcomingFrom   now          upcomingUntil
 *   │ hoy y 6 días antes  │ franja en curso │ resto de hoy y mañana │
 *   ├─────────────────────┼─────────────────┼───────────────────────┤
 *   │ vencidas, cotiz.,   │ ◄─────── próximas pruebas ────────────► │
 *   │ notas (recientes)   │
 *
 * - Recientes: hoy y los RECENT_WINDOW_DAYS − 1 días anteriores, desde el
 *   primer instante de ese día (como "Últimos 30 días" del Dashboard,
 *   DEC-043 §2). Aplica a las cotizaciones, las notas y las pruebas
 *   vencidas. Los chats sin leer no tienen ventana: un entrante sin leer
 *   sigue pendiente hasta que el miembro lo abre (DEC-044 §2).
 * - Próximas: las pruebas abiertas cuya franja (TEST_DRIVE_SLOT_MINUTES)
 *   todavía no terminó, hasta el fin de mañana. Una prueba de las 10:00 está
 *   "en curso" hasta las 11:00 y recién después pasa a "vencida": así no se
 *   marca vencida a las 10:01 una prueba que está ocurriendo.
 */

/** Zona del feed: P1 opera en Paraguay (la misma de la agenda y la bandeja). */
export const COCKPIT_TIME_ZONE = CALENDAR_TIME_ZONE;

/** Días de calendario de la ventana reciente: hoy y los 6 anteriores. */
export const RECENT_WINDOW_DAYS = 7;

/** Días de calendario de las próximas pruebas: hoy y mañana. */
export const UPCOMING_WINDOW_DAYS = 2;

/**
 * Tope de eventos recientes del feed y de cada fuente reciente. Que sea el
 * mismo número es lo que hace exacta la mezcla (./feed.ts): los primeros N
 * de la unión siempre están entre los primeros N de cada fuente.
 */
export const RECENT_EVENT_LIMIT = 30;

/** Tope de próximas pruebas de manejo. */
export const UPCOMING_TEST_DRIVE_LIMIT = 10;

/** Franja de una prueba de manejo, en ms (la de DEC-041 §4). */
export const TEST_DRIVE_SLOT_MS = TEST_DRIVE_SLOT_MINUTES * 60 * 1000;

export type CockpitWindow = Readonly<{
  /** Instante de la request. */
  now: Date;
  /** Día de Asunción de `now`, "AAAA-MM-DD" (validez de cotizaciones). */
  today: string;
  /** Primer instante de la ventana reciente (inclusive). */
  recentFrom: Date;
  /**
   * Frontera entre vencidas y próximas: `now` menos la franja. Una prueba
   * agendada en este instante o antes terminó su franja (vencida, si sigue
   * abierta); una posterior está en curso o por venir.
   */
  upcomingFrom: Date;
  /** Fin de la ventana de próximas (exclusivo): el inicio de pasado mañana. */
  upcomingUntil: Date;
}>;

export function cockpitWindow(now: Date): CockpitWindow {
  const today = zonedDate(now, COCKPIT_TIME_ZONE);
  const startOf = (days: number) => {
    const { year, month, day } = addDays(today, days);
    return startOfZonedDay(year, month, day, COCKPIT_TIME_ZONE);
  };
  return {
    now,
    today: isoDate(today),
    recentFrom: startOf(-(RECENT_WINDOW_DAYS - 1)),
    upcomingFrom: new Date(now.getTime() - TEST_DRIVE_SLOT_MS),
    upcomingUntil: startOf(UPCOMING_WINDOW_DAYS),
  };
}

/** Dónde está una prueba abierta respecto de `now`. */
export type TestDrivePhase =
  /** Todavía no empezó. */
  | "upcoming"
  /** Empezó y su franja no terminó. */
  | "in_progress"
  /** Su franja terminó y sigue abierta: falta registrar el resultado. */
  | "overdue";

/** La fase de una prueba abierta agendada a `scheduledAt`, en `now`. */
export function testDrivePhase(scheduledAt: Date, now: Date): TestDrivePhase {
  const start = scheduledAt.getTime();
  const at = now.getTime();
  if (start > at) return "upcoming";
  if (start + TEST_DRIVE_SLOT_MS > at) return "in_progress";
  return "overdue";
}
