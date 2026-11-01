import { isoDate, wallClock } from "@/domains/calendar/zoned-time";

/*
 * Hora de chat de la bandeja (Hito 12, DEC-044 §1): cómo se rotulan los días
 * del historial y la última actividad de cada conversación de la lista, en
 * días de calendario de Asunción. Puro: el instante de referencia (`now`)
 * llega explícito, así que nada depende del reloj ni de la zona del servidor
 * o del navegador. Solo Intl, sin dependencias de fechas.
 */

/** Zona de presentación: P1 opera en Paraguay. */
export const CHAT_TIME_ZONE = "America/Asuncion";

/**
 * Días anteriores a ayer que la lista rotula con el día de la semana. A los
 * 7 días el día de la semana se repite con el de hoy: pasa a la fecha.
 */
export const WEEKDAY_LABEL_DAYS = 6;

const DAY_MS = 24 * 60 * 60 * 1000;

const TIME = new Intl.DateTimeFormat("es-PY", {
  timeZone: CHAT_TIME_ZONE,
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

const WEEKDAY = new Intl.DateTimeFormat("es-PY", {
  timeZone: CHAT_TIME_ZONE,
  weekday: "long",
});

const LONG_DATE = new Intl.DateTimeFormat("es-PY", {
  timeZone: CHAT_TIME_ZONE,
  day: "numeric",
  month: "long",
  year: "numeric",
});

const SHORT_DATE = new Intl.DateTimeFormat("es-PY", {
  timeZone: CHAT_TIME_ZONE,
  day: "numeric",
  month: "short",
  year: "numeric",
});

/*
 * Las partes del formato, no su texto: la puntuación entre partes cambia
 * entre versiones de ICU, y el copy es-PY se arma acá.
 */
function partsOf(
  format: Intl.DateTimeFormat,
  at: Date,
): Readonly<Record<string, string>> {
  return Object.fromEntries(
    format.formatToParts(at).map((part) => [part.type, part.value]),
  );
}

function capitalize(text: string): string {
  const [first = "", ...rest] = Array.from(text);
  return `${first.toLocaleUpperCase("es-PY")}${rest.join("")}`;
}

function sameYear(at: Date, now: Date): boolean {
  return (
    wallClock(at.getTime(), CHAT_TIME_ZONE).year ===
    wallClock(now.getTime(), CHAT_TIME_ZONE).year
  );
}

/** Día de calendario de Asunción de un instante: "2026-10-29". */
export function chatDayKey(at: Date): string {
  return isoDate(wallClock(at.getTime(), CHAT_TIME_ZONE));
}

/**
 * Días de calendario de Asunción de `at` a `now`: 0 es hoy, 1 es ayer y un
 * número negativo, un día posterior a hoy.
 */
export function chatDaysAgo(at: Date, now: Date): number {
  const day = wallClock(at.getTime(), CHAT_TIME_ZONE);
  const today = wallClock(now.getTime(), CHAT_TIME_ZONE);
  return Math.round(
    (Date.UTC(today.year, today.month - 1, today.day) -
      Date.UTC(day.year, day.month - 1, day.day)) /
      DAY_MS,
  );
}

/** Hora de Asunción, de 00:00 a 23:59: "14:32". */
export function chatTime(at: Date): string {
  const parts = partsOf(TIME, at);
  return `${parts.hour ?? ""}:${parts.minute ?? ""}`;
}

/**
 * Separador de día del historial: "Hoy", "Ayer", "Lunes 26 de octubre" en
 * el año en curso o "26 de octubre de 2025" en otro.
 */
export function chatDayLabel(at: Date, now: Date): string {
  const daysAgo = chatDaysAgo(at, now);
  if (daysAgo === 0) return "Hoy";
  if (daysAgo === 1) return "Ayer";
  const parts = partsOf(LONG_DATE, at);
  const dayMonth = `${parts.day ?? ""} de ${parts.month ?? ""}`;
  if (!sameYear(at, now)) return `${dayMonth} de ${parts.year ?? ""}`;
  return `${capitalize(partsOf(WEEKDAY, at).weekday ?? "")} ${dayMonth}`;
}

/**
 * Última actividad de una conversación en la lista: "14:32" hoy, "Ayer",
 * el día de la semana hasta WEEKDAY_LABEL_DAYS atrás ("Lunes"), "26 oct" en
 * el año en curso o "26 oct 2025" en otro.
 */
export function chatListTime(at: Date, now: Date): string {
  const daysAgo = chatDaysAgo(at, now);
  if (daysAgo === 0) return chatTime(at);
  if (daysAgo === 1) return "Ayer";
  if (daysAgo > 1 && daysAgo <= WEEKDAY_LABEL_DAYS) {
    return capitalize(partsOf(WEEKDAY, at).weekday ?? "");
  }
  const parts = partsOf(SHORT_DATE, at);
  const dayMonth = `${parts.day ?? ""} ${(parts.month ?? "").replace(/\.$/u, "")}`;
  return sameYear(at, now) ? dayMonth : `${dayMonth} ${parts.year ?? ""}`;
}
