import {
  addDays,
  isoDate,
  isoWeekday,
  parseIsoDate,
  startOfZonedDay,
  zonedDate,
  type CalendarDate,
} from "./zoned-time";

/*
 * Semana de la agenda (Hito 9, DEC-041): de lunes a domingo en la zona de
 * la agenda, como un intervalo de instantes [inicio, fin) que la base
 * compara contra `scheduled_at`. Puro: `now` y la zona llegan explícitos.
 *
 * La semana viaja en la URL (`/calendar?w=YYYY-MM-DD`). Cualquier día de la
 * semana la identifica; un valor ausente o inválido es la semana de hoy.
 */

/** Parámetro de búsqueda de la semana. */
export const WEEK_PARAM = "w";

export type CalendarDay = Readonly<{
  /** `YYYY-MM-DD`: clave estable del día. */
  date: string;
  /** Primer instante del día (incluido). */
  start: Date;
  /** Primer instante del día siguiente (excluido). */
  end: Date;
  /** "lun", "mar"… */
  weekdayShort: string;
  /** "lunes 2 de noviembre" (lectores de pantalla y encabezados). */
  longLabel: string;
  /** Número del día del mes. */
  dayOfMonth: number;
  isToday: boolean;
  /** El día ya terminó. */
  isPast: boolean;
}>;

export type CalendarWeek = Readonly<{
  /** `YYYY-MM-DD` del lunes: el valor canónico de `?w=`. */
  key: string;
  start: Date;
  end: Date;
  days: readonly CalendarDay[];
  /** "2 – 8 nov 2026". */
  label: string;
  previousKey: string;
  nextKey: string;
  todayKey: string;
  isCurrent: boolean;
}>;

function mondayOf(date: CalendarDate): CalendarDate {
  return addDays(date, 1 - isoWeekday(date));
}

function formatDate(
  date: CalendarDate,
  options: Intl.DateTimeFormatOptions,
): string {
  // Mediodía UTC: el día de calendario no cambia en ninguna zona de América.
  return new Intl.DateTimeFormat("es-PY", {
    timeZone: "UTC",
    ...options,
  }).format(new Date(Date.UTC(date.year, date.month - 1, date.day, 12)));
}

function rangeLabel(monday: CalendarDate, sunday: CalendarDate): string {
  const month = (date: CalendarDate) =>
    formatDate(date, { month: "short" }).replace(".", "");
  if (monday.year !== sunday.year) {
    return `${monday.day} ${month(monday)} ${monday.year} – ${sunday.day} ${month(sunday)} ${sunday.year}`;
  }
  if (monday.month !== sunday.month) {
    return `${monday.day} ${month(monday)} – ${sunday.day} ${month(sunday)} ${sunday.year}`;
  }
  return `${monday.day} – ${sunday.day} ${month(sunday)} ${sunday.year}`;
}

/**
 * La semana que contiene el día `param` (`YYYY-MM-DD`) o, si falta o no es
 * una fecha válida, la que contiene `now`.
 */
export function calendarWeek(
  param: string | undefined,
  now: Date,
  timeZone: string,
): CalendarWeek {
  if (Number.isNaN(now.getTime()))
    throw new RangeError("calendar: invalid now");
  const today = zonedDate(now, timeZone);
  const anchor = (param !== undefined && parseIsoDate(param)) || today;
  const monday = mondayOf(anchor);
  const todayKey = isoDate(today);

  const days: CalendarDay[] = [];
  for (let offset = 0; offset < 7; offset += 1) {
    const date = addDays(monday, offset);
    const next = addDays(date, 1);
    const end = startOfZonedDay(next.year, next.month, next.day, timeZone);
    days.push({
      date: isoDate(date),
      start: startOfZonedDay(date.year, date.month, date.day, timeZone),
      end,
      weekdayShort: formatDate(date, { weekday: "short" }).replace(".", ""),
      longLabel: formatDate(date, {
        weekday: "long",
        day: "numeric",
        month: "long",
      }),
      dayOfMonth: date.day,
      isToday: isoDate(date) === todayKey,
      isPast: end.getTime() <= now.getTime(),
    });
  }

  const sunday = addDays(monday, 6);
  const first = days[0];
  const last = days[6];
  if (!first || !last) throw new RangeError("calendar: empty week");
  const key = isoDate(monday);
  return {
    key,
    start: first.start,
    end: last.end,
    days,
    label: rangeLabel(monday, sunday),
    previousKey: isoDate(addDays(monday, -7)),
    nextKey: isoDate(addDays(monday, 7)),
    todayKey,
    isCurrent: key === isoDate(mondayOf(today)),
  };
}
