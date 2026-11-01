/*
 * Formato es-PY de las métricas del Dashboard Directivo (Hito 5, DEC-037
 * §12; KPIs comerciales, DEC-043 §9). Puro y apto para el navegador.
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

/** Separador del desglose de una tarjeta. */
const BREAKDOWN_SEPARATOR = " · ";

/**
 * Desglose de las cotizaciones pendientes (DEC-043 §4): "3 por aprobar ·
 * 1 por enviar · 2 esperando respuesta". Por aprobar es el paso de
 * aprobación humana obligatorio (DEC-042 §2).
 */
export function pendingQuotesBreakdown(
  quotes: Readonly<{
    awaitingApproval: number;
    readyToSend: number;
    awaitingResponse: number;
  }>,
): string {
  return [
    `${formatCount(quotes.awaitingApproval)} por aprobar`,
    `${formatCount(quotes.readyToSend)} por enviar`,
    `${formatCount(quotes.awaitingResponse)} esperando respuesta`,
  ].join(BREAKDOWN_SEPARATOR);
}

/**
 * Desglose de las pruebas de manejo de la semana (DEC-043 §5): "2 por
 * realizar · 3 realizadas · 1 no asistió". "No asistió" es el rótulo del
 * estado (DEC-041) y no cambia con el número.
 */
export function weekTestDrivesBreakdown(
  testDrives: Readonly<{ pending: number; completed: number; noShow: number }>,
): string {
  return [
    `${formatCount(testDrives.pending)} por realizar`,
    countLabel(testDrives.completed, "realizada", "realizadas"),
    `${formatCount(testDrives.noShow)} no asistió`,
  ].join(BREAKDOWN_SEPARATOR);
}

/** Base de la tasa de conversión: "2 ventas de 3 cierres". */
export function conversionBasis(won: number, closed: number): string {
  return `${countLabel(won, "venta", "ventas")} de ${countLabel(closed, "cierre", "cierres")}`;
}
