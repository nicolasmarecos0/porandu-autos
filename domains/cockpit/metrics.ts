import {
  buildConversion,
  type ConversionView,
} from "@/domains/dashboard/commercial";
import { chatTime } from "@/domains/conversations/chat-time";
import { CURRENCIES, type Currency } from "@/domains/money";
import { LOSS_REASONS, type LossReason } from "@/domains/opportunities/closure";
import type { Stage } from "@/domains/opportunities/stages";
import { fromCents, toCents } from "@/domains/quotes/pricing";
import type { VehicleStatus } from "@/domains/vehicles/stock";

import {
  METRICS_PERIOD_NOTICE_LABELS,
  type MetricsPeriod,
  type MetricsPeriodNotice,
} from "./metrics-period";
import { TEST_DRIVE_SLOT_MS } from "./window";

/*
 * Métricas del salón (propuesta DEC-050): la vista ejecutiva de la sección
 * Cockpit para dueños y gerentes. Puro: no carga datos ni conoce la base,
 * React o Next. La base agrega (db/queries/cockpit-metrics.ts: COUNT, SUM y
 * agrupaciones acotadas, con filtro por organización) y este módulo arma lo
 * que ve la gerencia, con `now` explícito. Nada se persiste.
 *
 *   período (URL) ─► conversión · motivos de pérdida · ciclo de venta
 *                 └► realización de pruebas de manejo
 *   hoy           ─► embudo abierto por etapa · cotizaciones en juego
 *                 └► atención (Enfriándose, Inactivas) · salud del stock
 *
 * Dinero (DEC-025 §5 y §6, DEC-030 §7): la base suma `numeric` exacto por
 * moneda y este módulo opera en centavos (BigInt). Nunca un float, nunca
 * una conversión: cada moneda es un total aparte.
 *
 * Las reglas reutilizan las de cada módulo: la tasa de conversión es la del
 * Dashboard (DEC-043 §3.2), la recencia la de DEC-035 §2 (cortes de
 * recencyCutoffs(), en la base), la franja de una prueba la del Cockpit
 * (DEC-047 §3.3) y los estados de stock los de `vehicles.status` (DEC-025
 * §4), como la Stock List y el Catálogo.
 */

/** Etapas abiertas del embudo, en el orden del flujo (DEC-032 §1). */
export const FUNNEL_STAGES = [
  "new",
  "qualifying",
  "negotiating",
] as const satisfies readonly Stage[];

export type FunnelStage = (typeof FUNNEL_STAGES)[number];

/**
 * Estados de las cotizaciones "en juego" (propuesta DEC-050 §5): pasaron
 * la aprobación humana obligatoria (DEC-042 §2) y siguen abiertas. Un
 * borrador todavía no es una oferta.
 */
export const QUOTE_VALUE_STATUSES = [
  "approved",
  "sent",
] as const satisfies readonly string[];

export type QuoteValueStatus = (typeof QUOTE_VALUE_STATUSES)[number];

/** Estados de stock en el orden del ciclo de la unidad (DEC-025 §4). */
export const STOCK_STATUS_ORDER = [
  "inPreparation",
  "available",
  "reserved",
  "sold",
] as const satisfies readonly VehicleStatus[];

/**
 * Stock publicado: lo que está a la venta en el salón (y en el Catálogo,
 * DEC-049 §2) sin estar vendido. Base de la valorización y la antigüedad.
 */
export const PUBLISHED_STOCK_STATUSES = [
  "available",
  "reserved",
] as const satisfies readonly VehicleStatus[];

const SECONDS_PER_DAY = 24 * 60 * 60;

/* Lecturas de la base (db/queries/cockpit-metrics.ts). */

/** Oportunidades abiertas hoy: una fila de `count(*) FILTER`. */
export type OpenOpportunityCounts = Readonly<{
  byStage: Readonly<Record<FunnelStage, number>>;
  /** Abiertas Enfriándose: de 2 a 5 días sin actividad (DEC-035 §2). */
  warning: number;
  /** Abiertas Inactivas: más de 5 días sin actividad. */
  stale: number;
}>;

/** Cierres del período, agrupados por etapa y motivo (a lo sumo 7 filas). */
export type ClosureGroupRow = Readonly<{
  stage: "won" | "lost";
  /** Motivo de pérdida: presente si y solo si la etapa es `lost` (CHECK). */
  lossReason: LossReason | null;
  count: number;
  /**
   * Suma, en segundos enteros, de alta → cierre (`created_at` →
   * `updated_at`, la fecha de cierre de DEC-037 §5) de las filas del grupo.
   * Solo se usa la de las ganadas.
   */
  cycleSeconds: number;
}>;

/** Cotizaciones en juego hoy, agrupadas por moneda y estado (≤ 4 filas). */
export type QuoteValueRow = Readonly<{
  currency: Currency;
  status: QuoteValueStatus;
  count: number;
  /** Suma exacta de `total_price`: decimal canónico con dos decimales. */
  amount: string;
}>;

/** Pruebas de manejo del período por resultado (una fila). */
export type TestDriveOutcomeCounts = Readonly<{
  completed: number;
  noShow: number;
  cancelled: number;
  /** Abiertas con la franja terminada: falta registrar el resultado. */
  overdue: number;
  /** Abiertas con la franja en curso o por venir (todavía no se deben). */
  upcoming: number;
}>;

/** Unidades agrupadas por estado y moneda del precio (≤ 12 filas). */
export type StockGroupRow = Readonly<{
  status: VehicleStatus;
  /** Moneda del precio publicado; null sin precio (van juntos, DEC-025 §5). */
  currency: Currency | null;
  units: number;
  /** Suma exacta del precio publicado, o null sin precio. */
  amount: string | null;
  /** Suma, en segundos enteros, de la antigüedad desde el ingreso. */
  ageSeconds: number;
}>;

/* Lo que ve la gerencia. */

export type FunnelStageView = Readonly<{
  stage: FunnelStage;
  count: number;
  /** Porcentaje de las abiertas, con un decimal; null sin abiertas. */
  share: number | null;
}>;

export type FunnelView = Readonly<{
  /** Abiertas hoy, sin importar cuándo nacieron. */
  open: number;
  stages: readonly FunnelStageView[];
}>;

export type SalesCycleView = Readonly<{
  /** Ventas cerradas en el período: la base del promedio. */
  won: number;
  /** Días promedio de alta a venta, redondeados; null sin ventas (DEC-005). */
  averageDays: number | null;
}>;

export type LossReasonView = Readonly<{
  reason: LossReason;
  count: number;
  /** Porcentaje de las perdidas del período, con un decimal. */
  share: number;
}>;

export type LossReasonsView = Readonly<{
  lost: number;
  /** Solo los motivos con pérdidas, del más frecuente al menos. */
  reasons: readonly LossReasonView[];
}>;

/** Un monto exacto con cuántas cotizaciones lo forman. */
export type QuoteAmountView = Readonly<{
  count: number;
  /** Decimal canónico con dos decimales ("96000.00"). */
  amount: string;
}>;

export type QuoteStatusAmountView = QuoteAmountView &
  Readonly<{
    /** Porcentaje del monto de la moneda, con un decimal; null sin monto. */
    share: number | null;
  }>;

/** Plata en juego de una moneda: nunca se suma ni compara con otra. */
export type CurrencyValueView = Readonly<{
  currency: Currency;
  total: QuoteAmountView;
  approved: QuoteStatusAmountView;
  sent: QuoteStatusAmountView;
}>;

export type TestDrivePulseView = TestDriveOutcomeCounts &
  Readonly<{
    /** Las que ya se debían: realizadas + no asistió + canceladas + vencidas. */
    due: number;
    /** Realizadas sobre `due`, en %, con un decimal; null sin ninguna. */
    rate: number | null;
  }>;

export type AttentionView = Readonly<{
  open: number;
  /** Abiertas con actividad en los últimos 2 días. */
  active: number;
  warning: number;
  stale: number;
  /** Enfriándose + Inactivas: las que piden intervención. */
  needsAttention: number;
}>;

export type StockStatusView = Readonly<{
  status: VehicleStatus;
  count: number;
  /** Porcentaje del total de unidades, con un decimal; null sin unidades. */
  share: number | null;
}>;

export type StockValuationView = Readonly<{
  currency: Currency;
  /** Unidades publicadas con precio en esta moneda. */
  units: number;
  /** Suma exacta del precio publicado. */
  amount: string;
}>;

export type StockHealthView = Readonly<{
  /** Todas las unidades de la organización, en cualquier estado. */
  total: number;
  statuses: readonly StockStatusView[];
  /** Disponibles + reservadas. */
  published: number;
  /** Una entrada por moneda de P1, en el orden de CURRENCIES. */
  valuation: readonly StockValuationView[];
  /** Publicadas sin precio: no suman a la valorización (DEC-005). */
  unpriced: number;
  /** Días promedio desde el ingreso a Porandú, redondeados; null sin publicadas. */
  averageAgeDays: number | null;
}>;

/** El período de la vista: sin los instantes, que solo usa la base. */
export type MetricsPeriodView = Readonly<
  Pick<MetricsPeriod, "kind" | "from" | "to" | "days" | "label" | "isDefault">
>;

export type CockpitMetrics = Readonly<{
  period: MetricsPeriodView;
  /** Por qué se ignoró el período pedido (es-PY); null si se usó. */
  notice: string | null;
  /** Instante de la lectura (ISO) y su hora de Asunción ("14:32"). */
  generatedAt: string;
  generatedLabel: string;
  /** Hoy. */
  funnel: FunnelView;
  /** Período: ventas cerradas, perdidas y tasa de conversión. */
  conversion: ConversionView;
  /** Período. */
  salesCycle: SalesCycleView;
  /** Período. */
  lossReasons: LossReasonsView;
  /** Hoy: una entrada por moneda de P1, en el orden de CURRENCIES. */
  quoteValue: readonly CurrencyValueView[];
  /** Período (por `scheduled_at`). */
  testDrives: TestDrivePulseView;
  /** Hoy. */
  attention: AttentionView;
  /** Hoy. */
  stock: StockHealthView;
}>;

/* Reglas. */

// Constantes BigInt sin literales `n`: el target de TypeScript es ES2017.
const ZERO = BigInt(0);
const TWO = BigInt(2);
const THOUSAND = BigInt(1000);

function assertCount(value: number, name: string): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError(`metrics: invalid ${name}`);
  }
}

function assertCounts(counts: Readonly<Record<string, number>>): void {
  for (const [name, value] of Object.entries(counts)) assertCount(value, name);
}

/**
 * Parte sobre total, en %, con un decimal. Se redondea sobre enteros
 * (milésimas), la mitad hacia arriba, como el win rate (DEC-037 §6): 1 de 3
 * → 33,3. Sin total no hay proporción: null, nunca 0 % (DEC-005).
 */
export function shareOf(part: number, total: number): number | null {
  assertCount(part, "part");
  assertCount(total, "total");
  if (part > total) throw new RangeError("metrics: part exceeds total");
  if (total === 0) return null;
  return Math.round((part * 1000) / total) / 10;
}

/** La misma proporción, exacta, para montos en centavos. */
function amountShare(part: bigint, total: bigint): number | null {
  if (part < ZERO || part > total) {
    throw new RangeError("metrics: invalid amount share");
  }
  if (total === ZERO) return null;
  return Number((part * THOUSAND * TWO + total) / (total * TWO)) / 10;
}

/**
 * Días promedio de una suma de segundos enteros, redondeados al día más
 * cercano (la mitad hacia arriba), en enteros exactos. Sin filas, null.
 */
export function averageDays(
  totalSeconds: number,
  count: number,
): number | null {
  assertCount(totalSeconds, "seconds");
  assertCount(count, "count");
  if (count === 0) return null;
  const denominator = BigInt(count) * BigInt(SECONDS_PER_DAY);
  return Number(
    (BigInt(totalSeconds) * TWO + denominator) / (denominator * TWO),
  );
}

/**
 * Frontera de las pruebas vencidas: `now` menos la franja de 60 minutos
 * (DEC-047 §3.3, la de testDrivePhase()). Una prueba abierta agendada en
 * este instante o antes terminó su franja: falta registrar el resultado.
 */
export function overdueTestDriveCutoff(now: Date): Date {
  if (Number.isNaN(now.getTime())) {
    throw new RangeError("metrics: invalid now");
  }
  return new Date(now.getTime() - TEST_DRIVE_SLOT_MS);
}

/** Embudo abierto de hoy: cada etapa con su parte de las abiertas. */
export function buildFunnel(counts: OpenOpportunityCounts): FunnelView {
  assertCounts(counts.byStage);
  const open = FUNNEL_STAGES.reduce(
    (sum, stage) => sum + counts.byStage[stage],
    0,
  );
  return {
    open,
    stages: FUNNEL_STAGES.map((stage) => ({
      stage,
      count: counts.byStage[stage],
      share: shareOf(counts.byStage[stage], open),
    })),
  };
}

/** Atención de hoy: cuántas abiertas piden intervención (DEC-035 §2). */
export function buildAttention(counts: OpenOpportunityCounts): AttentionView {
  const { open } = buildFunnel(counts);
  assertCounts({ warning: counts.warning, stale: counts.stale });
  const needsAttention = counts.warning + counts.stale;
  if (needsAttention > open) {
    throw new RangeError("metrics: attention exceeds open opportunities");
  }
  return {
    open,
    active: open - needsAttention,
    warning: counts.warning,
    stale: counts.stale,
    needsAttention,
  };
}

function wonRows(rows: readonly ClosureGroupRow[]): ClosureGroupRow[] {
  return rows.filter((row) => row.stage === "won");
}

function lostRows(rows: readonly ClosureGroupRow[]): ClosureGroupRow[] {
  return rows.filter((row) => row.stage === "lost");
}

function assertClosureRows(rows: readonly ClosureGroupRow[]): void {
  for (const row of rows) {
    assertCounts({ count: row.count, cycleSeconds: row.cycleSeconds });
    if (row.stage === "lost" && row.lossReason === null) {
      throw new RangeError("metrics: lost closure without reason");
    }
    if (row.stage === "won" && row.lossReason !== null) {
      throw new RangeError("metrics: won closure with a loss reason");
    }
  }
}

const sumOf = (
  rows: readonly ClosureGroupRow[],
  key: "count" | "cycleSeconds",
) => rows.reduce((sum, row) => sum + row[key], 0);

/** Cierres del período → ventas, perdidas y tasa de conversión (DEC-043 §3.2). */
export function buildPeriodConversion(
  rows: readonly ClosureGroupRow[],
): ConversionView {
  assertClosureRows(rows);
  return buildConversion(
    sumOf(wonRows(rows), "count"),
    sumOf(lostRows(rows), "count"),
  );
}

/**
 * Ciclo de venta del período (propuesta DEC-050 §4, la "velocidad del
 * embudo"): días promedio desde el alta de cada oportunidad ganada hasta su
 * cierre. Sin ventas en el período, sin dato.
 */
export function buildSalesCycle(
  rows: readonly ClosureGroupRow[],
): SalesCycleView {
  assertClosureRows(rows);
  const won = wonRows(rows);
  const count = sumOf(won, "count");
  return {
    won: count,
    averageDays: averageDays(sumOf(won, "cycleSeconds"), count),
  };
}

/**
 * Motivos de pérdida del período (DEC-034 §2): los que tienen pérdidas, del
 * más frecuente al menos y, a igual cantidad, en el orden de la lista.
 */
export function buildLossReasons(
  rows: readonly ClosureGroupRow[],
): LossReasonsView {
  assertClosureRows(rows);
  const byReason = new Map<LossReason, number>();
  for (const { lossReason, count } of lostRows(rows)) {
    // assertClosureRows() ya exige el motivo de toda perdida.
    if (lossReason === null) continue;
    byReason.set(lossReason, (byReason.get(lossReason) ?? 0) + count);
  }
  const lost = [...byReason.values()].reduce((sum, count) => sum + count, 0);
  const reasons = LOSS_REASONS.filter(
    (reason) => (byReason.get(reason) ?? 0) > 0,
  )
    .map((reason) => {
      const count = byReason.get(reason) ?? 0;
      return { reason, count, share: shareOf(count, lost) ?? 0 };
    })
    .sort(
      (a, b) =>
        b.count - a.count ||
        LOSS_REASONS.indexOf(a.reason) - LOSS_REASONS.indexOf(b.reason),
    );
  return { lost, reasons };
}

/**
 * Plata en juego hoy (propuesta DEC-050 §5): las cotizaciones aprobadas y
 * enviadas, vigentes y de oportunidades cotizables, sumadas por moneda.
 * Siempre las dos monedas de P1, aunque una esté en cero.
 */
export function buildQuoteValue(
  rows: readonly QuoteValueRow[],
): CurrencyValueView[] {
  const groups = new Map<string, { count: number; cents: bigint }>();
  for (const row of rows) {
    assertCount(row.count, "quotes");
    if (!(CURRENCIES as readonly string[]).includes(row.currency)) {
      throw new RangeError("metrics: invalid quote currency");
    }
    if (!(QUOTE_VALUE_STATUSES as readonly string[]).includes(row.status)) {
      throw new RangeError("metrics: invalid quote status");
    }
    const key = `${row.currency}:${row.status}`;
    const group = groups.get(key) ?? { count: 0, cents: ZERO };
    groups.set(key, {
      count: group.count + row.count,
      // toCents() falla ante un decimal que no es canónico.
      cents: group.cents + toCents(row.amount),
    });
  }
  return CURRENCIES.map((currency) => {
    const approved = groups.get(`${currency}:approved`) ?? {
      count: 0,
      cents: ZERO,
    };
    const sent = groups.get(`${currency}:sent`) ?? { count: 0, cents: ZERO };
    const totalCents = approved.cents + sent.cents;
    return {
      currency,
      total: {
        count: approved.count + sent.count,
        amount: fromCents(totalCents),
      },
      approved: {
        count: approved.count,
        amount: fromCents(approved.cents),
        share: amountShare(approved.cents, totalCents),
      },
      sent: {
        count: sent.count,
        amount: fromCents(sent.cents),
        share: amountShare(sent.cents, totalCents),
      },
    };
  });
}

/**
 * Pulso de las pruebas de manejo del período (propuesta DEC-050 §6): la
 * tasa de realización es realizadas sobre las que ya se debían (realizadas,
 * no asistió, canceladas y vencidas sin resultado). Las que todavía están
 * en horario no cuentan: no se debían.
 */
export function buildTestDrivePulse(
  counts: TestDriveOutcomeCounts,
): TestDrivePulseView {
  assertCounts(counts);
  const due =
    counts.completed + counts.noShow + counts.cancelled + counts.overdue;
  return { ...counts, due, rate: shareOf(counts.completed, due) };
}

function isPublished(status: VehicleStatus): boolean {
  return (PUBLISHED_STOCK_STATUSES as readonly VehicleStatus[]).includes(
    status,
  );
}

/**
 * Salud del stock de hoy (propuesta DEC-050 §7): distribución por
 * `vehicles.status`, valorización del stock publicado por moneda y
 * antigüedad promedio desde el ingreso a Porandú (DEC-025 §7: no es la
 * antigüedad física, que no se registra).
 */
export function buildStockHealth(
  rows: readonly StockGroupRow[],
): StockHealthView {
  const byStatus = new Map<VehicleStatus, number>();
  const valuation = new Map<Currency, { units: number; cents: bigint }>();
  let published = 0;
  let unpriced = 0;
  let publishedAgeSeconds = 0;
  for (const row of rows) {
    assertCounts({ units: row.units, ageSeconds: row.ageSeconds });
    if (!(STOCK_STATUS_ORDER as readonly string[]).includes(row.status)) {
      throw new RangeError("metrics: invalid vehicle status");
    }
    if ((row.currency === null) !== (row.amount === null)) {
      throw new RangeError("metrics: price and currency go together");
    }
    if (
      row.currency !== null &&
      !(CURRENCIES as readonly string[]).includes(row.currency)
    ) {
      throw new RangeError("metrics: invalid vehicle currency");
    }
    byStatus.set(row.status, (byStatus.get(row.status) ?? 0) + row.units);
    if (!isPublished(row.status)) continue;
    published += row.units;
    publishedAgeSeconds += row.ageSeconds;
    if (row.currency === null || row.amount === null) {
      unpriced += row.units;
      continue;
    }
    const current = valuation.get(row.currency) ?? { units: 0, cents: ZERO };
    valuation.set(row.currency, {
      units: current.units + row.units,
      cents: current.cents + toCents(row.amount),
    });
  }
  const total = [...byStatus.values()].reduce((sum, count) => sum + count, 0);
  assertCount(publishedAgeSeconds, "ageSeconds");
  return {
    total,
    statuses: STOCK_STATUS_ORDER.map((status) => {
      const count = byStatus.get(status) ?? 0;
      return { status, count, share: shareOf(count, total) };
    }),
    published,
    valuation: CURRENCIES.map((currency) => {
      const value = valuation.get(currency) ?? { units: 0, cents: ZERO };
      return { currency, units: value.units, amount: fromCents(value.cents) };
    }),
    unpriced,
    averageAgeDays: averageDays(publishedAgeSeconds, published),
  };
}

/** El período resuelto → el período de la vista. */
export function toMetricsPeriodView(period: MetricsPeriod): MetricsPeriodView {
  return {
    kind: period.kind,
    from: period.from,
    to: period.to,
    days: period.days,
    label: period.label,
    isDefault: period.isDefault,
  };
}

/** Lecturas de la base + el período → Métricas del salón. */
export function buildCockpitMetrics(input: {
  period: MetricsPeriod;
  notice: MetricsPeriodNotice | null;
  now: Date;
  opportunities: OpenOpportunityCounts;
  closures: readonly ClosureGroupRow[];
  quotes: readonly QuoteValueRow[];
  testDrives: TestDriveOutcomeCounts;
  stock: readonly StockGroupRow[];
}): CockpitMetrics {
  if (Number.isNaN(input.now.getTime())) {
    throw new RangeError("metrics: invalid now");
  }
  return {
    period: toMetricsPeriodView(input.period),
    notice:
      input.notice === null ? null : METRICS_PERIOD_NOTICE_LABELS[input.notice],
    generatedAt: input.now.toISOString(),
    generatedLabel: chatTime(input.now),
    funnel: buildFunnel(input.opportunities),
    conversion: buildPeriodConversion(input.closures),
    salesCycle: buildSalesCycle(input.closures),
    lossReasons: buildLossReasons(input.closures),
    quoteValue: buildQuoteValue(input.quotes),
    testDrives: buildTestDrivePulse(input.testDrives),
    attention: buildAttention(input.opportunities),
    stock: buildStockHealth(input.stock),
  };
}
