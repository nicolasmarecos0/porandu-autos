/*
 * Período del Dashboard Directivo (Hito 5, DEC-037 §4): el mes calendario en
 * curso de la zona de presentación, como un intervalo de instantes
 * [inicio, fin) que la base compara contra `updated_at`. Puro: `now` y la
 * zona llegan explícitos, así que el mes no depende del reloj ni de la zona
 * del servidor.
 */

/** Zona horaria del período: P1 opera en Paraguay. */
export const DASHBOARD_TIME_ZONE = "America/Asuncion";

/** Mes calendario de la zona: desde su primer instante hasta el del siguiente. */
export type MonthWindow = Readonly<{
  /** Primer instante del día 1 (incluido). */
  start: Date;
  /** Primer instante del día 1 del mes siguiente (excluido). */
  end: Date;
}>;

const DAY_MS = 24 * 60 * 60 * 1000;

type WallClock = Readonly<{
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

/** Fecha y hora de pared de un instante en `timeZone`. */
function wallClock(instant: number, timeZone: string): WallClock {
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

/**
 * Primer instante del día de calendario `year-month-day` en `timeZone`.
 *
 * La medianoche de pared se interpreta con los desfasajes vigentes alrededor
 * de ese día y se queda el instante más temprano que cae en él. Así se
 * resuelve también un cambio de horario a la medianoche: si la medianoche no
 * existió (Asunción, 1 oct 2023: de 00:00 a 01:00), el día empieza en el
 * instante del cambio.
 */
function startOfDay(
  year: number,
  month: number,
  day: number,
  timeZone: string,
): number {
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
    throw new RangeError(`dashboard: no start of day in ${timeZone}`);
  }
  return start;
}

/** El mes calendario de `timeZone` que contiene `now`. */
export function monthWindow(now: Date, timeZone: string): MonthWindow {
  const instant = now.getTime();
  if (Number.isNaN(instant)) throw new RangeError("dashboard: invalid now");
  const { year, month } = wallClock(instant, timeZone);
  const next =
    month === 12 ? { year: year + 1, month: 1 } : { year, month: month + 1 };
  return {
    start: new Date(startOfDay(year, month, 1, timeZone)),
    end: new Date(startOfDay(next.year, next.month, 1, timeZone)),
  };
}

/** Nombre del mes de `now` en `timeZone`, en es-PY: "octubre de 2026". */
export function monthLabel(now: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("es-PY", {
    timeZone,
    month: "long",
    year: "numeric",
  }).format(now);
}
