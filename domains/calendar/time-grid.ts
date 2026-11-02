import type { AgendaDay, AgendaItem } from "./agenda";
import { TEST_DRIVE_SLOT_MINUTES } from "./test-drives";
import { isoDate, minuteOfDay, zonedDate } from "./zoned-time";

/*
 * Grilla horaria de la agenda semanal (Hito 13, DEC-045 §3). En escritorio
 * cada prueba de manejo es un bloque ubicado por su hora de pared de
 * Asunción sobre un eje de horas común a los siete días, con el alto de la
 * franja de TEST_DRIVE_SLOT_MINUTES: la misma que avisa "Unidad
 * superpuesta". No es una duración (DEC-041 §7 la deja fuera).
 *
 * Puro: recibe los días que ya armó agendaDays() y, para la línea "ahora",
 * el instante y la zona explícitos. Las posiciones son fracciones (0 a 1)
 * del alto de la grilla y del ancho de la columna del día: la UI las vuelve
 * porcentajes, así que nada depende del alto en píxeles de una hora.
 */

const MINUTES_PER_HOUR = 60;
const MINUTES_PER_DAY = 24 * MINUTES_PER_HOUR;

/** Eje por defecto: de 08:00 a 20:00, el horario comercial de la agencia. */
export const TIME_GRID_DEFAULT_START_HOUR = 8;
export const TIME_GRID_DEFAULT_END_HOUR = 20;

/** Horas enteras del eje: desde `startHour` (incluida) hasta `endHour`. */
export type TimeGridRange = Readonly<{ startHour: number; endHour: number }>;

/** Una marca del eje: "09:00" y su distancia desde el borde superior. */
export type TimeGridHour = Readonly<{
  hour: number;
  label: string;
  /** Fracción del alto de la grilla (0 a 1). */
  offset: number;
}>;

/** Dónde va un bloque dentro de la columna de su día. */
export type TimeGridPlacement = Readonly<{
  /** Inicio del bloque desde el borde superior, como fracción del alto. */
  top: number;
  /** Alto del bloque, como fracción del alto de la grilla. */
  height: number;
  /** Carril del bloque (0 a lanes - 1) dentro de su grupo. */
  lane: number;
  /** Carriles del grupo: el bloque ocupa 1/lanes del ancho de la columna. */
  lanes: number;
}>;

export type TimeGridBlock = Readonly<{
  item: AgendaItem;
  placement: TimeGridPlacement;
}>;

export type TimeGridDay = AgendaDay &
  Readonly<{ blocks: readonly TimeGridBlock[] }>;

export type WeekTimeGrid = Readonly<{
  range: TimeGridRange;
  hours: readonly TimeGridHour[];
  days: readonly TimeGridDay[];
}>;

/** La línea "ahora": la columna del día y su altura en el eje. */
export type TimeGridNow = Readonly<{
  /** Índice del día en la semana (0 = lunes). */
  dayIndex: number;
  /** Fracción del alto de la grilla (0 a 1). */
  offset: number;
}>;

function assertMinute(minute: number): void {
  if (!Number.isInteger(minute) || minute < 0 || minute >= MINUTES_PER_DAY) {
    throw new RangeError("calendar: invalid minute of day");
  }
}

function assertSlot(slotMinutes: number): void {
  if (!Number.isInteger(slotMinutes) || slotMinutes <= 0) {
    throw new RangeError("calendar: invalid slot");
  }
}

/**
 * Eje de la semana: de 08:00 a 20:00, extendido hasta la hora entera que
 * contiene la prueba más temprana y hasta la que cierra la franja de la más
 * tardía, como mucho la medianoche. Nunca deja una prueba afuera.
 */
export function timeGridRange(
  minutes: readonly number[],
  slotMinutes: number = TEST_DRIVE_SLOT_MINUTES,
): TimeGridRange {
  assertSlot(slotMinutes);
  let startHour = TIME_GRID_DEFAULT_START_HOUR;
  let endHour = TIME_GRID_DEFAULT_END_HOUR;
  for (const minute of minutes) {
    assertMinute(minute);
    startHour = Math.min(startHour, Math.floor(minute / MINUTES_PER_HOUR));
    const slotEnd = Math.min(minute + slotMinutes, MINUTES_PER_DAY);
    endHour = Math.max(endHour, Math.ceil(slotEnd / MINUTES_PER_HOUR));
  }
  return { startHour, endHour };
}

/** Las marcas del eje, una por hora entera: "08:00" … "19:00". */
export function timeGridHours(range: TimeGridRange): TimeGridHour[] {
  const span = range.endHour - range.startHour;
  const hours: TimeGridHour[] = [];
  for (let hour = range.startHour; hour < range.endHour; hour += 1) {
    hours.push({
      hour,
      label: `${String(hour).padStart(2, "0")}:00`,
      offset: (hour - range.startHour) / span,
    });
  }
  return hours;
}

type PlacedEntry = {
  index: number;
  start: number;
  end: number;
  lane: number;
};

/**
 * Ubica los bloques de un día, uno por cada minuto de `minutes` y en el
 * mismo orden. Los bloques cuyas franjas se pisan, aunque sean de unidades
 * distintas, forman un grupo y se reparten el ancho en carriles: en orden
 * de hora, cada bloque toma el primer carril que ya quedó libre. Es solo
 * presentación: el aviso "Unidad superpuesta" (la misma unidad) lo decide
 * overlappingTestDrives().
 *
 * La franja de un bloque se corta en el final del eje: una prueba de las
 * 23:30 ocupa la última media hora.
 */
export function placeTimeGridBlocks(
  minutes: readonly number[],
  range: TimeGridRange,
  slotMinutes: number = TEST_DRIVE_SLOT_MINUTES,
): TimeGridPlacement[] {
  assertSlot(slotMinutes);
  const gridStart = range.startHour * MINUTES_PER_HOUR;
  const gridEnd = range.endHour * MINUTES_PER_HOUR;
  const span = gridEnd - gridStart;
  if (span <= 0) throw new RangeError("calendar: empty time grid");

  const order = minutes
    .map((start, index) => {
      assertMinute(start);
      if (start < gridStart || start >= gridEnd) {
        throw new RangeError("calendar: block outside the time grid");
      }
      return { index, start, end: Math.min(start + slotMinutes, gridEnd) };
    })
    // Por hora; a la misma hora, en el orden recibido (estable).
    .sort((a, b) => a.start - b.start || a.index - b.index);

  const placements = new Map<number, TimeGridPlacement>();
  let group: PlacedEntry[] = [];
  let laneEnds: number[] = [];
  let groupEnd = Number.NEGATIVE_INFINITY;

  const closeGroup = () => {
    for (const entry of group) {
      placements.set(entry.index, {
        top: (entry.start - gridStart) / span,
        height: (entry.end - entry.start) / span,
        lane: entry.lane,
        lanes: laneEnds.length,
      });
    }
    group = [];
    laneEnds = [];
  };

  for (const entry of order) {
    // Un bloque que empieza cuando ya terminó todo el grupo abre otro.
    if (entry.start >= groupEnd) closeGroup();
    let lane = laneEnds.findIndex((end) => end <= entry.start);
    if (lane === -1) {
      lane = laneEnds.length;
      laneEnds.push(entry.end);
    } else {
      laneEnds[lane] = entry.end;
    }
    group.push({ ...entry, lane });
    groupEnd = Math.max(groupEnd, entry.end);
  }
  closeGroup();

  return minutes.map((_, index) => {
    const placement = placements.get(index);
    if (!placement) throw new RangeError("calendar: unplaced block");
    return placement;
  });
}

/**
 * La grilla de la semana: el eje común a los siete días y los bloques de
 * cada día, en el orden de agendaDays() (por hora).
 */
export function weekTimeGrid(
  days: readonly AgendaDay[],
  slotMinutes: number = TEST_DRIVE_SLOT_MINUTES,
): WeekTimeGrid {
  const range = timeGridRange(
    days.flatMap((day) => day.items.map((item) => item.minuteOfDay)),
    slotMinutes,
  );
  return {
    range,
    hours: timeGridHours(range),
    days: days.map((day) => {
      const placements = placeTimeGridBlocks(
        day.items.map((item) => item.minuteOfDay),
        range,
        slotMinutes,
      );
      return {
        ...day,
        blocks: day.items.flatMap((item, index) => {
          const placement = placements[index];
          return placement ? [{ item, placement }] : [];
        }),
      };
    }),
  };
}

/**
 * Dónde va la línea "ahora": la columna del día de `now` en `timeZone` y su
 * altura en el eje, o null si `now` no es de ninguno de esos días o cae
 * fuera del eje.
 */
export function timeGridNow(
  now: Date,
  dates: readonly string[],
  range: TimeGridRange,
  timeZone: string,
): TimeGridNow | null {
  if (Number.isNaN(now.getTime())) return null;
  const dayIndex = dates.indexOf(isoDate(zonedDate(now, timeZone)));
  if (dayIndex === -1) return null;
  const minute = minuteOfDay(now, timeZone);
  const gridStart = range.startHour * MINUTES_PER_HOUR;
  const gridEnd = range.endHour * MINUTES_PER_HOUR;
  if (minute < gridStart || minute >= gridEnd) return null;
  return { dayIndex, offset: (minute - gridStart) / (gridEnd - gridStart) };
}
