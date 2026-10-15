import { initialsOf } from "@/domains/opportunities/prospect";
import {
  isTerminalStage,
  OPPORTUNITY_STAGES,
  type Stage,
} from "@/domains/opportunities/stages";
import { evaluateRecency } from "@/domains/scoring/engine";

/*
 * Métricas del Dashboard Directivo (Hito 5, DEC-037). Puro: no carga datos
 * ni conoce la base, React o Next. La base cuenta (db/queries/dashboard.ts)
 * y este módulo arma lo que ve la gerencia: win rate, días sin actividad y
 * la lista de oportunidades en riesgo. Nada se persiste: se calcula en cada
 * lectura, con `now` explícito.
 *
 *   oportunidades ─► activas · ganadas y perdidas del mes ─► win rate
 *                 └► Enfriándose · Inactivas (cortes de DEC-035 §2)
 *   unidades + vínculos ─► en stock · reservadas · vendidas del mes
 */

/** Etapas abiertas: las oportunidades activas del pipeline (DEC-032 §1). */
export const OPEN_STAGES: readonly Stage[] = OPPORTUNITY_STAGES.filter(
  (stage) => !isTerminalStage(stage),
);

/** Cuántas oportunidades en riesgo lista el dashboard, como máximo. */
export const AT_RISK_LIST_LIMIT = 10;

/** Conteos de oportunidades que hace la base (DEC-037 §6 y §8). */
export type OpportunityCounts = Readonly<{
  /** Abiertas hoy, sin importar cuándo nacieron. */
  open: number;
  /** `won` con cierre (`updated_at`) en el mes. */
  wonInMonth: number;
  /** `lost` con cierre (`updated_at`) en el mes. */
  lostInMonth: number;
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
  /** Vendidas cuya oportunidad ganada se cerró en el mes. */
  soldInMonth: number;
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

/** Lo que muestra el Dashboard Directivo. */
export type ExecutiveDashboard = Readonly<{
  /** Mes en curso, en es-PY: "octubre de 2026". */
  periodLabel: string;
  pipeline: Readonly<{
    open: number;
    won: number;
    lost: number;
    /** Porcentaje con un decimal; `null` sin cierres en el mes (DEC-005). */
    winRate: number | null;
  }>;
  inventory: Readonly<{
    inStock: number;
    reserved: number;
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

function assertCount(value: number, name: string): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError(`dashboard: invalid ${name}`);
  }
}

/**
 * Win rate del mes: ganadas sobre cerradas (ganadas + perdidas), en %, con
 * un decimal. Una oportunidad abierta todavía no ganó ni perdió, así que no
 * cuenta. Sin cierres no hay tasa: `null` ("Sin dato"), nunca 0 % (DEC-005).
 * Se redondea sobre enteros (milésimas) para que el resultado sea exacto:
 * 2 de 3 → 66,7.
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

/** Conteos y filas de la base → Dashboard Directivo. */
export function buildExecutiveDashboard(input: {
  periodLabel: string;
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
  return {
    periodLabel: input.periodLabel,
    pipeline: {
      open: opportunities.open,
      won: opportunities.wonInMonth,
      lost: opportunities.lostInMonth,
      winRate: winRate(opportunities.wonInMonth, opportunities.lostInMonth),
    },
    inventory: {
      inStock: inventory.inStock,
      reserved: inventory.reserved,
      sold: inventory.soldInMonth,
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
