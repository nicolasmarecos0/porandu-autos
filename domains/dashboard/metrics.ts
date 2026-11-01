import { initialsOf } from "@/domains/opportunities/prospect";
import {
  isTerminalStage,
  OPPORTUNITY_STAGES,
  type Stage,
} from "@/domains/opportunities/stages";
import { evaluateRecency } from "@/domains/scoring/engine";

import type {
  ConversionView,
  PendingQuotesView,
  WeekTestDrivesView,
} from "./commercial";
import {
  RANGE_NOTICE_LABELS,
  type DashboardRange,
  type DashboardRangeNotice,
} from "./range";

/*
 * Métricas del Dashboard Directivo (Hito 5, DEC-037; rango y KPIs
 * comerciales, DEC-043). Puro: no carga datos ni conoce la base, React o
 * Next. La base cuenta (db/queries/dashboard.ts y dashboard-commercial.ts),
 * domains/dashboard/commercial.ts arma los KPIs comerciales y este módulo
 * arma lo que ve la gerencia. Nada se persiste: se calcula en cada lectura,
 * con `now` explícito.
 *
 *   rango (URL) ─► ventas cerradas · perdidas · tasa de conversión
 *               └► unidades vendidas en el rango
 *   hoy         ─► oportunidades activas · cotizaciones pendientes
 *               └► en stock · reservadas · Enfriándose · Inactivas
 *   esta semana ─► test drives (lunes a domingo, como /calendar)
 *
 * Las reglas no cambian con DEC-043: el win rate de DEC-037 §6 es la tasa de
 * conversión del rango, y los cortes de recencia siguen los de DEC-035 §2.
 */

/** Etapas abiertas: las oportunidades activas del pipeline (DEC-032 §1). */
export const OPEN_STAGES: readonly Stage[] = OPPORTUNITY_STAGES.filter(
  (stage) => !isTerminalStage(stage),
);

/** Cuántas oportunidades en riesgo lista el dashboard, como máximo. */
export const AT_RISK_LIST_LIMIT = 10;

/**
 * Conteos de oportunidades que hace la base (DEC-037 §6 y §8). Son estado
 * de hoy: no dependen del rango. Los cierres del rango los cuenta
 * selectClosedCounts() y llegan como ConversionView.
 */
export type OpportunityCounts = Readonly<{
  /** Abiertas hoy, sin importar cuándo nacieron. */
  open: number;
  /** Abiertas Enfriándose (de 2 a 5 días sin actividad). */
  warning: number;
  /** Abiertas Inactivas (más de 5 días sin actividad). */
  stale: number;
}>;

/**
 * Conteos del inventario (DEC-037 §7). Cada unidad está en una sola
 * categoría, según las oportunidades que la tienen vinculada: vendida (una
 * `won`) > reservada (una `negotiating`) > en stock (el resto).
 */
export type InventoryCounts = Readonly<{
  inStock: number;
  reserved: number;
  /** Vendidas cuya oportunidad ganada se cerró en el rango (DEC-043 §2). */
  soldInRange: number;
}>;

/** Una oportunidad abierta e Inactiva, como la lee la base. */
export type AtRiskRow = Readonly<{
  id: string;
  contactName: string;
  stage: Stage;
  lastActivityAt: Date;
}>;

/** Las oportunidades en riesgo que lee la base y cuántas hay en total. */
export type AtRiskRows = Readonly<{
  rows: readonly AtRiskRow[];
  total: number;
}>;

/** Oportunidad en riesgo, lista para la vista. */
export type AtRiskOpportunity = Readonly<{
  id: string;
  contactName: string;
  initials: string;
  stage: Stage;
  /** Días enteros sin actividad del cliente (DEC-035 §2). */
  daysInactive: number;
}>;

/**
 * El rango de la vista: lo que necesitan el encabezado y el selector. Sin
 * los instantes (`start`, `end`), que solo usa la base.
 */
export type DashboardRangeView = Readonly<
  Pick<DashboardRange, "kind" | "from" | "to" | "days" | "label" | "isDefault">
>;

/** Lo que muestra el Dashboard Directivo. */
export type ExecutiveDashboard = Readonly<{
  /** Rango de los flujos (DEC-043 §2): "Mes en curso: noviembre de 2026". */
  range: DashboardRangeView;
  /** Por qué se ignoró el rango pedido (es-PY); null si se usó. */
  notice: string | null;
  /** `YYYY-MM-DD` de hoy en Asunción: el último día que se puede elegir. */
  today: string;
  /** Ventas cerradas, perdidas y tasa de conversión del rango (DEC-043 §3). */
  conversion: ConversionView;
  /** Cotizaciones abiertas hoy (DEC-043 §4). */
  pendingQuotes: PendingQuotesView;
  /** Pruebas de manejo de la semana en curso (DEC-043 §5). */
  weekTestDrives: WeekTestDrivesView;
  pipeline: Readonly<{
    /** Oportunidades abiertas hoy. */
    open: number;
  }>;
  inventory: Readonly<{
    inStock: number;
    reserved: number;
    /** Vendidas en el rango. */
    sold: number;
  }>;
  attention: Readonly<{
    warning: number;
    stale: number;
  }>;
  atRisk: Readonly<{
    /** De la más vieja a la más reciente, a lo sumo AT_RISK_LIST_LIMIT. */
    items: readonly AtRiskOpportunity[];
    /** Todas las Inactivas, aunque la lista muestre menos. */
    total: number;
  }>;
}>;

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

function assertCount(value: number, name: string): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError(`dashboard: invalid ${name}`);
  }
}

/**
 * Win rate: ganadas sobre cerradas (ganadas + perdidas), en %, con un
 * decimal. Una oportunidad abierta todavía no ganó ni perdió, así que no
 * cuenta. Sin cierres no hay tasa: `null` ("Sin dato"), nunca 0 % (DEC-005).
 * Se redondea sobre enteros (milésimas) para que el resultado sea exacto:
 * 2 de 3 → 66,7. Es la regla de la tasa de conversión del rango (DEC-043
 * §3.2).
 */
export function winRate(won: number, lost: number): number | null {
  assertCount(won, "won");
  assertCount(lost, "lost");
  const closed = won + lost;
  if (closed === 0) return null;
  return Math.round((won * 1000) / closed) / 10;
}

/** Fila de la base → oportunidad en riesgo de la vista. */
export function toAtRiskOpportunity(
  row: AtRiskRow,
  now: Date,
): AtRiskOpportunity {
  return {
    id: row.id,
    contactName: row.contactName,
    initials: initialsOf(row.contactName),
    stage: row.stage,
    daysInactive: evaluateRecency(row.lastActivityAt, now).days,
  };
}

/** El rango resuelto → el rango de la vista. */
export function toRangeView(range: DashboardRange): DashboardRangeView {
  return {
    kind: range.kind,
    from: range.from,
    to: range.to,
    days: range.days,
    label: range.label,
    isDefault: range.isDefault,
  };
}

/**
 * Conteos y filas de la base, más los KPIs comerciales ya armados por
 * domains/dashboard/commercial.ts → Dashboard Directivo.
 */
export function buildExecutiveDashboard(input: {
  range: DashboardRange;
  notice: DashboardRangeNotice | null;
  /** `YYYY-MM-DD` de hoy en la zona del dashboard. */
  today: string;
  conversion: ConversionView;
  pendingQuotes: PendingQuotesView;
  weekTestDrives: WeekTestDrivesView;
  opportunities: OpportunityCounts;
  inventory: InventoryCounts;
  atRisk: AtRiskRows;
  now: Date;
}): ExecutiveDashboard {
  const { opportunities, inventory, atRisk, now } = input;
  for (const [name, value] of Object.entries({
    ...opportunities,
    ...inventory,
    atRiskTotal: atRisk.total,
  })) {
    assertCount(value, name);
  }
  if (!ISO_DAY.test(input.today)) {
    throw new RangeError("dashboard: invalid today");
  }
  return {
    range: toRangeView(input.range),
    notice: input.notice === null ? null : RANGE_NOTICE_LABELS[input.notice],
    today: input.today,
    conversion: input.conversion,
    pendingQuotes: input.pendingQuotes,
    weekTestDrives: input.weekTestDrives,
    pipeline: { open: opportunities.open },
    inventory: {
      inStock: inventory.inStock,
      reserved: inventory.reserved,
      sold: inventory.soldInRange,
    },
    attention: { warning: opportunities.warning, stale: opportunities.stale },
    atRisk: {
      items: atRisk.rows
        .slice(0, AT_RISK_LIST_LIMIT)
        .map((row) => toAtRiskOpportunity(row, now)),
      total: Math.max(atRisk.total, atRisk.rows.length),
    },
  };
}
