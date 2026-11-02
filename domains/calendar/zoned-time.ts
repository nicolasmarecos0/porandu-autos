/*
 * Hora de pared de una zona horaria (Hito 9, DEC-041): la agenda se
 * presenta y se carga en la hora de Asunción, y la base guarda instantes
 * (`timestamptz`). Puro: la zona llega explícita, así que nada depende del
 * reloj ni de la zona del servidor o del navegador.
 *
 * Usa solo Intl (tzdata del runtime): sin dependencias de fechas.
 */

const MINUTE_MS = 60 * 1000;
const DAY_MS = 24 * 60 * MINUTE_MS;

/** Fecha y hora de pared, con el mes de 1 a 12. */
export type WallClock = Readonly<{
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}>;

const WALL_CLOCK_FORMATS = new Map<string, Intl.DateTimeFormat>();

function wallClockFormat(timeZone: string): Intl.DateTimeFormat {
  let format = WALL_CLOCK_FORMATS.get(timeZone);
  if (!format) {
    format = new Intl.DateTimeFormat("en-US", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
    });
    WALL_CLOCK_FORMATS.set(timeZone, format);
  }
  return format;
}

/** Fecha y hora de pared de un instante (ms) en `timeZone`. */
export function wallClock(instant: number, timeZone: string): WallClock {
  const parts = Object.fromEntries(
    wallClockFormat(timeZone)
      .formatToParts(new Date(instant))
      .map((part) => [part.type, Number(part.value)]),
  );
  return {
    year: parts.year ?? NaN,
    month: parts.month ?? NaN,
    day: parts.day ?? NaN,
    hour: parts.hour ?? NaN,
    minute: parts.minute ?? NaN,
    second: parts.second ?? NaN,
  };
}

/** Diferencia entre la hora de pared y UTC en un instante, en ms. */
function offsetAt(instant: number, timeZone: string): number {
  const wall = wallClock(instant, timeZone);
  const asUtc = Date.UTC(
    wall.year,
    wall.month - 1,
    wall.day,
    wall.hour,
    wall.minute,
    wall.second,
  );
  return asUtc - (instant - (((instant % 1000) + 1000) % 1000));
}

function sameWall(a: WallClock, b: WallClock): boolean {
  return (
    a.year === b.year &&
    a.month === b.month &&
    a.day === b.day &&
    a.hour === b.hour &&
    a.minute === b.minute
  );
}

/**
 * Instantes en los que la hora de pared `wall` (a la precisión del minuto)
 * ocurre en `timeZone`, del más temprano al más tardío. Vacío si esa hora no
 * existió (un salto de horario); dos si se repitió (un retroceso).
 */
function instantsOf(wall: WallClock, timeZone: string): number[] {
  const asUtc = Date.UTC(
    wall.year,
    wall.month - 1,
    wall.day,
    wall.hour,
    wall.minute,
  );
  const offsets = new Set(
    [asUtc - DAY_MS, asUtc, asUtc + DAY_MS].map((instant) =>
      offsetAt(instant, timeZone),
    ),
  );
  const found = new Set<number>();
  for (const offset of offsets) {
    const candidate = asUtc - offset;
    if (sameWall(wallClock(candidate, timeZone), wall)) found.add(candidate);
  }
  return [...found].sort((a, b) => a - b);
}

/**
 * Instante de la hora de pared `wall` en `timeZone`, o null si esa hora no
 * existió. Si se repitió, el más temprano (la primera vez que el reloj la
 * marcó).
 */
export function zonedInstant(wall: WallClock, timeZone: string): Date | null {
  const [first] = instantsOf(wall, timeZone);
  return first === undefined ? null : new Date(first);
}

/**
 * Primer instante del día de calendario `year-month-day` en `timeZone`.
 * Si la medianoche no existió (Asunción, 1 oct 2023: de 00:00 a 01:00), el
 * día empieza en el instante del cambio, igual que monthWindow() del
 * Dashboard (domains/dashboard/period.ts).
 */
export function startOfZonedDay(
  year: number,
  month: number,
  day: number,
  timeZone: string,
): Date {
  const wallMidnight = Date.UTC(year, month - 1, day);
  const offsets = new Set(
    [wallMidnight - DAY_MS, wallMidnight, wallMidnight + DAY_MS].map(
      (instant) => offsetAt(instant, timeZone),
    ),
  );
  let start: number | null = null;
  for (const offset of offsets) {
    const candidate = wallMidnight - offset;
    const wall = wallClock(candidate, timeZone);
    const sameDay =
      wall.year === year && wall.month === month && wall.day === day;
    if (sameDay && (start === null || candidate < start)) start = candidate;
  }
  if (start === null) {
    throw new RangeError(`calendar: no start of day in ${timeZone}`);
  }
  return new Date(start);
}

/** Fecha de calendario (sin hora), con el mes de 1 a 12. */
export type CalendarDate = Readonly<{
  year: number;
  month: number;
  day: number;
}>;

/** `YYYY-MM-DD` de una fecha de calendario. */
export function isoDate({ year, month, day }: CalendarDate): string {
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

/**
 * Fecha de calendario de un `YYYY-MM-DD` que existe (no `2026-02-30`), o
 * null. Input no confiable: acota el año a 2000–2100.
 */
export function parseIsoDate(raw: string): CalendarDate | null {
  const match = ISO_DATE.exec(raw);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (year < 2000 || year > 2100) return null;
  const probe = new Date(Date.UTC(year, month - 1, day));
  if (
    probe.getUTCFullYear() !== year ||
    probe.getUTCMonth() !== month - 1 ||
    probe.getUTCDate() !== day
  ) {
    return null;
  }
  return { year, month, day };
}

/** La fecha `days` días después (o antes, con negativos). */
export function addDays(date: CalendarDate, days: number): CalendarDate {
  const probe = new Date(Date.UTC(date.year, date.month - 1, date.day + days));
  return {
    year: probe.getUTCFullYear(),
    month: probe.getUTCMonth() + 1,
    day: probe.getUTCDate(),
  };
}

/** Día de la semana ISO: 1 = lunes … 7 = domingo. */
export function isoWeekday(date: CalendarDate): number {
  const weekday = new Date(
    Date.UTC(date.year, date.month - 1, date.day),
  ).getUTCDay();
  return weekday === 0 ? 7 : weekday;
}

/** Fecha de calendario de un instante en `timeZone`. */
export function zonedDate(instant: Date, timeZone: string): CalendarDate {
  const { year, month, day } = wallClock(instant.getTime(), timeZone);
  return { year, month, day };
}

/**
 * Minutos desde la medianoche de pared de `timeZone` (0 a 1439), sin
 * segundos: la grilla horaria de la agenda ubica cada prueba con este valor
 * (Hito 13, DEC-045 §3).
 */
export function minuteOfDay(instant: Date, timeZone: string): number {
  const { hour, minute } = wallClock(instant.getTime(), timeZone);
  return hour * 60 + minute;
}
