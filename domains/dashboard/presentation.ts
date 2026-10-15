/*
 * Formato es-PY de las métricas del Dashboard Directivo (Hito 5, DEC-037
 * §12). Puro y apto para el navegador.
 */

/** Copy de un valor sin dato (DEC-005): nunca un cero inventado. */
export const NO_DATA = "Sin dato";

const COUNT = new Intl.NumberFormat("es-PY", { maximumFractionDigits: 0 });

const PERCENT = new Intl.NumberFormat("es-PY", {
  style: "percent",
  minimumFractionDigits: 0,
  maximumFractionDigits: 1,
});

/** Un conteo con separador de miles: 1234 → "1.234". */
export function formatCount(value: number): string {
  return COUNT.format(value);
}

/** Un porcentaje (0 a 100) con hasta un decimal: 66.7 → "66,7%". */
export function formatPercent(value: number | null): string {
  return value === null ? NO_DATA : PERCENT.format(value / 100);
}

/** "1 oportunidad", "3 oportunidades". */
export function countLabel(count: number, one: string, many: string): string {
  return `${formatCount(count)} ${count === 1 ? one : many}`;
}

/** Días sin actividad de una oportunidad en riesgo: "12 días sin actividad". */
export function inactivityLabel(days: number): string {
  return `${countLabel(days, "día", "días")} sin actividad`;
}
