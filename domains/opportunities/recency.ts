/*
 * Recencia (Build Baseline B1 §3.2):
 * 🔥 < 5 min · 🟢 5–30 min · 🟡 30 min–2 h · ❄️ > 2 h.
 */

export function recencyEmoji(minutes: number): string {
  if (minutes < 5) return "🔥";
  if (minutes < 30) return "🟢";
  if (minutes < 120) return "🟡";
  return "❄️";
}

function clock(minuteOfDay: number): string {
  const hours = Math.floor(minuteOfDay / 60);
  const minutes = minuteOfDay % 60;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
}

/**
 * Texto corto para listas densas: "2 min", "1 h 45", "ayer".
 * `referenceMinuteOfDay` es la hora actual en minutos desde medianoche.
 */
export function formatElapsedShort(
  minutes: number,
  referenceMinuteOfDay: number,
): string {
  if (minutes < 60) return `${minutes} min`;
  if (minutes > referenceMinuteOfDay) return "ayer";
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest === 0 ? `${hours} h` : `${hours} h ${rest}`;
}

/** Texto completo: "hace 2 min", "hace 1 h 45 min", "ayer 19:15". */
export function formatElapsedLong(
  minutes: number,
  referenceMinuteOfDay: number,
): string {
  if (minutes < 60) return `hace ${minutes} min`;
  if (minutes > referenceMinuteOfDay) {
    return `ayer ${clock(referenceMinuteOfDay - minutes + 24 * 60)}`;
  }
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest === 0 ? `hace ${hours} h` : `hace ${hours} h ${rest} min`;
}
