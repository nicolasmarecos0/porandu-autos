/*
 * Recencia (Build Baseline B1 §3.2):
 * 🔥 < 5 min · 🟢 5–30 min · 🟡 30 min–2 h · ❄️ > 2 h.
 */

/** Límites de las bandas de recencia, en minutos. */
export const RECENCY_BANDS = { live: 5, recent: 30, today: 120 } as const;

export function recencyEmoji(minutes: number): string {
  if (minutes < RECENCY_BANDS.live) return "🔥";
  if (minutes < RECENCY_BANDS.recent) return "🟢";
  if (minutes < RECENCY_BANDS.today) return "🟡";
  return "❄️";
}

const MINUTES_PER_DAY = 24 * 60;

/** Minutos enteros transcurridos desde `from` hasta `now` (nunca negativo). */
export function minutesSince(from: Date, now: Date): number {
  return Math.max(0, Math.floor((now.getTime() - from.getTime()) / 60_000));
}

/** Minuto del día (0–1439) de `date` en la zona horaria IANA `timeZone`. */
export function minuteOfDay(date: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const value = (type: "hour" | "minute") =>
    Number(parts.find((part) => part.type === type)?.value);
  return value("hour") * 60 + value("minute");
}

function clock(minuteOfDay: number): string {
  const hours = Math.floor(minuteOfDay / 60);
  const minutes = minuteOfDay % 60;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
}

/** Días de calendario hacia atrás: 0 = hoy, 1 = ayer, 2 = anteayer… */
function daysAgo(minutes: number, referenceMinuteOfDay: number): number {
  if (minutes <= referenceMinuteOfDay) return 0;
  return Math.ceil((minutes - referenceMinuteOfDay) / MINUTES_PER_DAY);
}

/**
 * Texto corto para listas densas: "2 min", "1 h 45", "ayer", "3 d".
 * `referenceMinuteOfDay` es la hora actual en minutos desde medianoche.
 */
export function formatElapsedShort(
  minutes: number,
  referenceMinuteOfDay: number,
): string {
  if (minutes < 60) return `${minutes} min`;
  const days = daysAgo(minutes, referenceMinuteOfDay);
  if (days === 1) return "ayer";
  if (days > 1) return `${days} d`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest === 0 ? `${hours} h` : `${hours} h ${rest}`;
}

/** Texto completo: "hace 2 min", "hace 1 h 45 min", "ayer 19:15", "hace 3 días". */
export function formatElapsedLong(
  minutes: number,
  referenceMinuteOfDay: number,
): string {
  if (minutes < 60) return `hace ${minutes} min`;
  const days = daysAgo(minutes, referenceMinuteOfDay);
  if (days === 1) {
    return `ayer ${clock(referenceMinuteOfDay - minutes + MINUTES_PER_DAY)}`;
  }
  if (days > 1) return `hace ${days} días`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest === 0 ? `hace ${hours} h` : `hace ${hours} h ${rest} min`;
}
