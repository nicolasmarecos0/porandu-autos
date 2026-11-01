import {
  addDays,
  isoDate,
  parseIsoDate,
  startOfZonedDay,
  zonedDate,
  type CalendarDate,
} from "@/domains/calendar/zoned-time";

/*
 * Rango de fechas del Dashboard Directivo (propuesta DEC-043 §2). Amplía el
 * "mes en curso" de DEC-037 §4 a un rango elegido en la URL:
 *
 *   /intelligence                              → mes en curso (default)
 *   /intelligence?range=previous_month         → un preset
 *   /intelligence?range=custom&from=…&to=…     → días de Asunción, inclusive
 *
 * El rango es un intervalo de instantes [start, end) que la base compara
 * contra `updated_at` (cierres) o `decided_at`, con límites exclusivos. Los
 * días son días de calendario de la zona del dashboard, y cada día empieza
 * en su primer instante (startOfZonedDay(), el mismo algoritmo que
 * monthWindow()), así que "mes en curso" da exactamente la ventana de
 * DEC-037 §4.
 *
 * Puro: `now` y la zona llegan explícitos. La URL es input no confiable: un
 * valor desconocido o inválido nunca rompe la página, cae al default con un
 * aviso (`notice`) que la vista puede mostrar.
 */

/** Parámetros de búsqueda del rango. */
export const RANGE_PARAM = "range";
export const FROM_PARAM = "from";
export const TO_PARAM = "to";

/** Rango personalizado más largo, en días (acota el costo de cada lectura). */
export const MAX_RANGE_DAYS = 366;

export const DASHBOARD_RANGE_PRESETS = [
  "month",
  "previous_month",
  "last_30_days",
  "quarter",
  "year",
] as const;

export type DashboardRangePreset = (typeof DASHBOARD_RANGE_PRESETS)[number];

export type DashboardRangeKind = DashboardRangePreset | "custom";

/** Rango sin parámetros: el mes en curso, como DEC-037 §4. */
export const DEFAULT_RANGE = "month" as const satisfies DashboardRangePreset;

/** Copy visible (es-PY) de cada rango. */
export const RANGE_LABELS: Readonly<Record<DashboardRangeKind, string>> = {
  month: "Mes en curso",
  previous_month: "Mes anterior",
  last_30_days: "Últimos 30 días",
  quarter: "Trimestre en curso",
  year: "Año en curso",
  custom: "Personalizado",
};

/** Por qué se ignoró el rango pedido. */
export type DashboardRangeNotice = "invalid_range" | "range_too_long";

/** Copy visible (es-PY) de cada aviso. */
export const RANGE_NOTICE_LABELS: Readonly<
  Record<DashboardRangeNotice, string>
> = {
  invalid_range: "El rango pedido no es válido. Se muestra el mes en curso.",
  range_too_long: `El rango no puede superar ${MAX_RANGE_DAYS} días. Se muestra el mes en curso.`,
};

export type DashboardRange = Readonly<{
  kind: DashboardRangeKind;
  /** Primer instante del primer día (incluido). */
  start: Date;
  /** Primer instante del día siguiente al último (excluido). */
  end: Date;
  /** `YYYY-MM-DD` del primer día, inclusive. */
  from: string;
  /** `YYYY-MM-DD` del último día, inclusive. */
  to: string;
  /** Días de calendario del rango. */
  days: number;
  /** "Mes en curso: noviembre de 2026", "Últimos 30 días: 3 oct – 1 nov 2026". */
  label: string;
  /** El rango por defecto (sin parámetros en la URL). */
  isDefault: boolean;
}>;

export type DashboardRangeResolution = Readonly<{
  range: DashboardRange;
  /** null si se usó el rango pedido (o no se pidió ninguno). */
  notice: DashboardRangeNotice | null;
}>;

/** Forma de `searchParams` de una página de Next. */
export type RangeSearchParams = Readonly<
  Record<string, string | string[] | undefined>
>;

const DAY_MS = 24 * 60 * 60 * 1000;

function single(value: string | string[] | undefined): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function isPreset(value: string): value is DashboardRangePreset {
  return (DASHBOARD_RANGE_PRESETS as readonly string[]).includes(value);
}

/** Días de calendario de `from` a `to`, los dos incluidos. */
function inclusiveDays(from: CalendarDate, to: CalendarDate): number {
  const diff =
    Date.UTC(to.year, to.month - 1, to.day) -
    Date.UTC(from.year, from.month - 1, from.day);
  return Math.round(diff / DAY_MS) + 1;
}

function firstOfMonth(year: number, month: number): CalendarDate {
  return { year, month, day: 1 };
}

/** Primer día del mes `months` meses después (o antes) del de `date`. */
function shiftMonths(date: CalendarDate, months: number): CalendarDate {
  const index = date.year * 12 + (date.month - 1) + months;
  return firstOfMonth(Math.floor(index / 12), (index % 12) + 1);
}

function formatDate(
  date: CalendarDate,
  options: Intl.DateTimeFormatOptions,
): string {
  // Mediodía UTC: el día de calendario no cambia en ninguna zona de América.
  return new Intl.DateTimeFormat("es-PY", {
    timeZone: "UTC",
    ...options,
  }).format(new Date(Date.UTC(date.year, date.month - 1, date.day, 12)));
}

function shortMonth(date: CalendarDate): string {
  return formatDate(date, { month: "short" }).replace(".", "");
}

/** "1 – 15 oct 2026", "1 oct – 31 dic 2026", "15 dic 2025 – 13 ene 2026". */
export function rangeText(from: CalendarDate, to: CalendarDate): string {
  if (from.year !== to.year) {
    return `${from.day} ${shortMonth(from)} ${from.year} – ${to.day} ${shortMonth(to)} ${to.year}`;
  }
  if (from.month !== to.month) {
    return `${from.day} ${shortMonth(from)} – ${to.day} ${shortMonth(to)} ${to.year}`;
  }
  if (from.day !== to.day) {
    return `${from.day} – ${to.day} ${shortMonth(to)} ${to.year}`;
  }
  return `${to.day} ${shortMonth(to)} ${to.year}`;
}

function monthName(date: CalendarDate): string {
  return formatDate(date, { month: "long", year: "numeric" });
}

/** Primer y último día (inclusive) de un preset, relativo a `today`. */
function presetDays(
  preset: DashboardRangePreset,
  today: CalendarDate,
): { from: CalendarDate; to: CalendarDate } {
  switch (preset) {
    case "month": {
      const from = firstOfMonth(today.year, today.month);
      return { from, to: addDays(shiftMonths(from, 1), -1) };
    }
    case "previous_month": {
      const current = firstOfMonth(today.year, today.month);
      return { from: shiftMonths(current, -1), to: addDays(current, -1) };
    }
    case "last_30_days":
      return { from: addDays(today, -29), to: today };
    case "quarter": {
      const firstMonth = Math.floor((today.month - 1) / 3) * 3 + 1;
      const from = firstOfMonth(today.year, firstMonth);
      return { from, to: addDays(shiftMonths(from, 3), -1) };
    }
    case "year": {
      const from = firstOfMonth(today.year, 1);
      return { from, to: { year: today.year, month: 12, day: 31 } };
    }
  }
}

function presetLabel(
  preset: DashboardRangePreset,
  from: CalendarDate,
  to: CalendarDate,
): string {
  const name = RANGE_LABELS[preset];
  if (preset === "month" || preset === "previous_month") {
    return `${name}: ${monthName(from)}`;
  }
  if (preset === "year") return `${name}: ${from.year}`;
  return `${name}: ${rangeText(from, to)}`;
}

function buildRange(
  kind: DashboardRangeKind,
  from: CalendarDate,
  to: CalendarDate,
  label: string,
  timeZone: string,
): DashboardRange {
  const next = addDays(to, 1);
  return {
    kind,
    start: startOfZonedDay(from.year, from.month, from.day, timeZone),
    end: startOfZonedDay(next.year, next.month, next.day, timeZone),
    from: isoDate(from),
    to: isoDate(to),
    days: inclusiveDays(from, to),
    label,
    isDefault: kind === DEFAULT_RANGE,
  };
}

/** Un preset relativo al día de `now` en `timeZone`. */
export function presetRange(
  preset: DashboardRangePreset,
  now: Date,
  timeZone: string,
): DashboardRange {
  if (Number.isNaN(now.getTime())) {
    throw new RangeError("dashboard: invalid now");
  }
  const { from, to } = presetDays(preset, zonedDate(now, timeZone));
  return buildRange(preset, from, to, presetLabel(preset, from, to), timeZone);
}

function fallback(
  now: Date,
  timeZone: string,
  notice: DashboardRangeNotice,
): DashboardRangeResolution {
  return { range: presetRange(DEFAULT_RANGE, now, timeZone), notice };
}

/**
 * Rango personalizado `from`–`to` (inclusive). Un `to` posterior a hoy se
 * recorta a hoy: el dashboard no mide el futuro. Un `from` posterior al
 * `to` (ya recortado) es inválido.
 */
function customRange(
  rawFrom: string | undefined,
  rawTo: string | undefined,
  now: Date,
  timeZone: string,
): DashboardRangeResolution {
  const from = rawFrom === undefined ? null : parseIsoDate(rawFrom);
  const requestedTo = rawTo === undefined ? null : parseIsoDate(rawTo);
  if (!from || !requestedTo) return fallback(now, timeZone, "invalid_range");

  const today = zonedDate(now, timeZone);
  const to = isoDate(requestedTo) > isoDate(today) ? today : requestedTo;
  if (isoDate(from) > isoDate(to)) {
    return fallback(now, timeZone, "invalid_range");
  }
  if (inclusiveDays(from, to) > MAX_RANGE_DAYS) {
    return fallback(now, timeZone, "range_too_long");
  }
  return {
    range: buildRange(
      "custom",
      from,
      to,
      `${RANGE_LABELS.custom}: ${rangeText(from, to)}`,
      timeZone,
    ),
    notice: null,
  };
}

/**
 * El rango que piden los `searchParams` de `/intelligence`, o el mes en
 * curso si no piden ninguno. Un valor repetido (`?range=a&range=b`) se
 * trata como ausente.
 */
export function resolveDashboardRange(
  params: RangeSearchParams,
  now: Date,
  timeZone: string,
): DashboardRangeResolution {
  if (Number.isNaN(now.getTime())) {
    throw new RangeError("dashboard: invalid now");
  }
  const kind = single(params[RANGE_PARAM]);
  if (kind === undefined) {
    return { range: presetRange(DEFAULT_RANGE, now, timeZone), notice: null };
  }
  if (kind === "custom") {
    return customRange(
      single(params[FROM_PARAM]),
      single(params[TO_PARAM]),
      now,
      timeZone,
    );
  }
  if (isPreset(kind)) {
    return { range: presetRange(kind, now, timeZone), notice: null };
  }
  return fallback(now, timeZone, "invalid_range");
}

/**
 * Los parámetros canónicos de un rango, para armar enlaces: el default no
 * lleva ninguno, un preset lleva `range` y uno personalizado, sus días.
 */
export function rangeSearchParams(
  range: Pick<DashboardRange, "kind" | "from" | "to">,
): Record<string, string> {
  if (range.kind === DEFAULT_RANGE) return {};
  if (range.kind === "custom") {
    return {
      [RANGE_PARAM]: "custom",
      [FROM_PARAM]: range.from,
      [TO_PARAM]: range.to,
    };
  }
  return { [RANGE_PARAM]: range.kind };
}

/**
 * Clave estable y primitiva del rango (para memoizar el loader por request
 * con `cache()` de React, que compara argumentos por identidad).
 */
export function rangeKey(
  range: Pick<DashboardRange, "kind" | "from" | "to">,
): string {
  return `${range.kind}:${range.from}:${range.to}`;
}
