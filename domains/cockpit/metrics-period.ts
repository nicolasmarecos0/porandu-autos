import {
  addDays,
  isoDate,
  startOfZonedDay,
  zonedDate,
  type CalendarDate,
} from "@/domains/calendar/zoned-time";
import { rangeText } from "@/domains/dashboard/range";

import { COCKPIT_TIME_ZONE } from "./window";

/*
 * Período de las Métricas del salón (propuesta DEC-050 §3): una ventana que
 * termina hoy y se elige en la URL, para compartir o recargar la vista.
 *
 *   /cockpit/metrics              → últimos 30 días (default)
 *   /cockpit/metrics?period=7d    → hoy y los 6 días anteriores
 *   /cockpit/metrics?period=90d   → hoy y los 89 días anteriores
 *   /cockpit/metrics?period=all   → todo el historial, sin piso
 *
 * La ventana es el intervalo de instantes [start, end): desde el primer
 * instante del primer día (como "Últimos 30 días" del Dashboard, DEC-043 §2)
 * hasta el primer instante de mañana, exclusivo. Los días son días de
 * calendario de Asunción y la base solo compara instantes. "Todo" no tiene
 * piso (`start = null`): la lectura omite ese límite.
 *
 * El período aplica a los flujos (cierres, motivos de pérdida, ciclo de
 * venta y pruebas de manejo). Las existencias (embudo abierto, cotizaciones
 * en juego, atención y stock) son el estado de hoy (DEC-037 §4).
 *
 * Puro: `now` y la zona llegan explícitos. La URL es input no confiable: un
 * valor desconocido nunca rompe la página, cae al default con un aviso.
 */

/** Zona del período: la del Cockpit (P1 opera en Paraguay). */
export const METRICS_TIME_ZONE = COCKPIT_TIME_ZONE;

/** Parámetro de búsqueda del período (identificador en inglés, DEC-011). */
export const PERIOD_PARAM = "period";

/** Períodos en el orden del selector. */
export const METRICS_PERIODS = ["7d", "30d", "90d", "all"] as const;

export type MetricsPeriodKind = (typeof METRICS_PERIODS)[number];

/** Período sin parámetro: los últimos 30 días. */
export const DEFAULT_METRICS_PERIOD =
  "30d" as const satisfies MetricsPeriodKind;

/** Días de calendario de cada ventana con piso (hoy incluido). */
export const METRICS_PERIOD_DAYS: Readonly<
  Record<Exclude<MetricsPeriodKind, "all">, number>
> = {
  "7d": 7,
  "30d": 30,
  "90d": 90,
};

/** Copy visible (es-PY) de cada período, para el encabezado. */
export const METRICS_PERIOD_LABELS: Readonly<
  Record<MetricsPeriodKind, string>
> = {
  "7d": "Últimos 7 días",
  "30d": "Últimos 30 días",
  "90d": "Últimos 90 días",
  all: "Todo el historial",
};

/** Copy corto de cada período: el selector y el alcance de cada número. */
export const METRICS_PERIOD_SHORT_LABELS: Readonly<
  Record<MetricsPeriodKind, string>
> = {
  "7d": "7 días",
  "30d": "30 días",
  "90d": "90 días",
  all: "Todo",
};

/** Por qué se ignoró el período pedido. */
export type MetricsPeriodNotice = "invalid_period";

/** Copy visible (es-PY) de cada aviso. */
export const METRICS_PERIOD_NOTICE_LABELS: Readonly<
  Record<MetricsPeriodNotice, string>
> = {
  invalid_period:
    "El período pedido no es válido. Se muestran los últimos 30 días.",
};

export type MetricsPeriod = Readonly<{
  kind: MetricsPeriodKind;
  /** Primer instante del primer día (incluido); null en "Todo": sin piso. */
  start: Date | null;
  /** Primer instante de mañana (excluido): el período termina hoy. */
  end: Date;
  /** `YYYY-MM-DD` del primer día, inclusive; null en "Todo". */
  from: string | null;
  /** `YYYY-MM-DD` de hoy: el último día, inclusive. */
  to: string;
  /** Días de calendario de la ventana; null en "Todo". */
  days: number | null;
  /** "Últimos 30 días: 5 oct – 3 nov 2026", "Todo el historial: hasta el 3 nov 2026". */
  label: string;
  /** El período por defecto (sin parámetro en la URL). */
  isDefault: boolean;
}>;

export type MetricsPeriodResolution = Readonly<{
  period: MetricsPeriod;
  /** null si se usó el período pedido (o no se pidió ninguno). */
  notice: MetricsPeriodNotice | null;
}>;

/** Forma de `searchParams` de una página de Next. */
export type MetricsSearchParams = Readonly<
  Record<string, string | string[] | undefined>
>;

function isPeriodKind(value: string): value is MetricsPeriodKind {
  return (METRICS_PERIODS as readonly string[]).includes(value);
}

function single(value: string | string[] | undefined): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function assertNow(now: Date): void {
  if (Number.isNaN(now.getTime())) {
    throw new RangeError("metrics: invalid now");
  }
}

function startOf(date: CalendarDate, timeZone: string): Date {
  return startOfZonedDay(date.year, date.month, date.day, timeZone);
}

/** La ventana de `kind` que termina el día de `now` en `timeZone`. */
export function metricsPeriod(
  kind: MetricsPeriodKind,
  now: Date,
  timeZone: string,
): MetricsPeriod {
  assertNow(now);
  const today = zonedDate(now, timeZone);
  const end = startOf(addDays(today, 1), timeZone);
  const isDefault = kind === DEFAULT_METRICS_PERIOD;
  if (kind === "all") {
    return {
      kind,
      start: null,
      end,
      from: null,
      to: isoDate(today),
      days: null,
      label: `${METRICS_PERIOD_LABELS.all}: hasta el ${rangeText(today, today)}`,
      isDefault,
    };
  }
  const days = METRICS_PERIOD_DAYS[kind];
  const first = addDays(today, -(days - 1));
  return {
    kind,
    start: startOf(first, timeZone),
    end,
    from: isoDate(first),
    to: isoDate(today),
    days,
    label: `${METRICS_PERIOD_LABELS[kind]}: ${rangeText(first, today)}`,
    isDefault,
  };
}

/**
 * El período que piden los `searchParams` de `/cockpit/metrics`, o el de
 * por defecto si no piden ninguno. Un valor repetido (`?period=a&period=b`)
 * se trata como ausente, como el rango del Dashboard (DEC-043 §2).
 */
export function resolveMetricsPeriod(
  params: MetricsSearchParams,
  now: Date,
  timeZone: string,
): MetricsPeriodResolution {
  assertNow(now);
  const requested = single(params[PERIOD_PARAM]);
  if (requested === undefined) {
    return {
      period: metricsPeriod(DEFAULT_METRICS_PERIOD, now, timeZone),
      notice: null,
    };
  }
  if (isPeriodKind(requested)) {
    return { period: metricsPeriod(requested, now, timeZone), notice: null };
  }
  return {
    period: metricsPeriod(DEFAULT_METRICS_PERIOD, now, timeZone),
    notice: "invalid_period",
  };
}

/**
 * Query string canónica de un período, con "?" o vacía: el default no lleva
 * parámetro. Es la inversa de resolveMetricsPeriod().
 */
export function metricsPeriodSearch(kind: MetricsPeriodKind): string {
  if (kind === DEFAULT_METRICS_PERIOD) return "";
  return `?${new URLSearchParams({ [PERIOD_PARAM]: kind })}`;
}
