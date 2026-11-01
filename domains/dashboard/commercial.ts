import { winRate } from "./metrics";

/*
 * KPIs comerciales del Dashboard Directivo (propuesta DEC-043 §3–§5). Puro:
 * no carga datos ni conoce la base, React o Next. La base cuenta
 * (db/queries/dashboard-commercial.ts) y este módulo arma lo que ve la
 * gerencia.
 *
 *   oportunidades cerradas en el rango ─► ventas cerradas · tasa de conversión
 *   cotizaciones abiertas hoy          ─► pendientes (por aprobar · por
 *                                          enviar · esperando respuesta)
 *                                          + vencidas sin cerrar (aparte)
 *   pruebas de manejo de la semana     ─► por realizar · realizadas ·
 *                                          no asistió · canceladas
 *
 * Existencias (estado de hoy, no dependen del rango): cotizaciones
 * pendientes. Flujos (dependen del rango): ventas cerradas y conversión.
 * La semana de pruebas es siempre la semana en curso (lunes a domingo).
 */

/**
 * Cotizaciones abiertas de oportunidades cotizables, como las cuenta la
 * base. "Vigente" = `valid_until` no anterior al día de Asunción
 * (DEC-042 §2: "Vencida" no es un estado guardado).
 */
export type QuoteCounts = Readonly<{
  /** `draft` vigentes: esperan la aprobación humana (DEC-042 §2). */
  awaitingApproval: number;
  /** `approved` vigentes: aprobadas, sin marcar como enviadas. */
  readyToSend: number;
  /** `sent` vigentes: esperan la respuesta del cliente. */
  awaitingResponse: number;
  /** Abiertas (`draft`, `approved` o `sent`) con la validez vencida. */
  expired: number;
}>;

/** Pruebas de manejo con `scheduled_at` en la semana, por estado. */
export type TestDriveWeekCounts = Readonly<{
  /** `scheduled` + `confirmed`: todavía sin resultado. */
  pending: number;
  completed: number;
  noShow: number;
  cancelled: number;
}>;

/** Ventas cerradas y conversión del rango (DEC-037 §6 aplicado al rango). */
export type ConversionView = Readonly<{
  /** Ventas cerradas: `won` con cierre en el rango. */
  won: number;
  /** `lost` con cierre en el rango. */
  lost: number;
  /** Ganadas + perdidas: la base de la tasa. */
  closed: number;
  /** Porcentaje con un decimal; `null` sin cierres (DEC-005, "Sin dato"). */
  rate: number | null;
}>;

export type PendingQuotesView = Readonly<{
  /** Vigentes por aprobar + por enviar + esperando respuesta. */
  total: number;
  awaitingApproval: number;
  readyToSend: number;
  awaitingResponse: number;
  /** Fuera del total: abiertas vencidas, que piden anularse o rehacerse. */
  expired: number;
}>;

export type WeekTestDrivesView = Readonly<{
  /** `YYYY-MM-DD` del lunes: enlaza a `/calendar?w=`. */
  weekKey: string;
  /** "26 oct – 1 nov 2026". */
  weekLabel: string;
  /** Agendadas que siguen en pie: por realizar + realizadas + no asistió. */
  scheduled: number;
  pending: number;
  completed: number;
  noShow: number;
  /** Fuera de `scheduled`: una cancelada no ocupa la agenda. */
  cancelled: number;
}>;

function assertCount(value: number, name: string): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError(`dashboard: invalid ${name}`);
  }
}

function assertCounts(counts: Readonly<Record<string, number>>): void {
  for (const [name, value] of Object.entries(counts)) assertCount(value, name);
}

/**
 * Tasa de conversión del rango: ventas cerradas sobre oportunidades
 * cerradas (ganadas + perdidas), la misma regla que el win rate de
 * DEC-037 §6. Una abierta todavía no convirtió ni se perdió, así que no
 * entra en la base de la tasa.
 */
export function buildConversion(won: number, lost: number): ConversionView {
  assertCounts({ won, lost });
  return { won, lost, closed: won + lost, rate: winRate(won, lost) };
}

/** Conteos de la base → cotizaciones pendientes. */
export function buildPendingQuotes(counts: QuoteCounts): PendingQuotesView {
  assertCounts(counts);
  return {
    total:
      counts.awaitingApproval + counts.readyToSend + counts.awaitingResponse,
    awaitingApproval: counts.awaitingApproval,
    readyToSend: counts.readyToSend,
    awaitingResponse: counts.awaitingResponse,
    expired: counts.expired,
  };
}

/** Conteos de la base + la semana → pruebas de manejo de la semana. */
export function buildWeekTestDrives(
  counts: TestDriveWeekCounts,
  week: Readonly<{ key: string; label: string }>,
): WeekTestDrivesView {
  assertCounts(counts);
  return {
    weekKey: week.key,
    weekLabel: week.label,
    scheduled: counts.pending + counts.completed + counts.noShow,
    pending: counts.pending,
    completed: counts.completed,
    noShow: counts.noShow,
    cancelled: counts.cancelled,
  };
}
