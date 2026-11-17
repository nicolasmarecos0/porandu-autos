import { PURCHASE_TYPES, type PurchaseType } from "@/domains/demand/facts";
import type { SubScoreKey } from "@/domains/scoring/types";

import type { Opportunity } from "./types";

/*
 * Vista Tabla de Opportunities (DEC-055): búsqueda dentro de lo que la cola
 * ya leyó, orden por columna y paginación. Lógica pura: sin React, Next ni
 * datos. Todo lo que muestra una fila sale del ViewModel real de la cola;
 * lo que no llega es "sin dato" y nunca se completa.
 */

/** Columnas por las que se ordena. */
export type TableSortKey = "porandu" | SubScoreKey | "activity";

export type SortDirection = "asc" | "desc";

export type TableSort = Readonly<{
  key: TableSortKey;
  direction: SortDirection;
}>;

/** Orden inicial: Porandú Score de mayor a menor, como la cola. */
export const DEFAULT_TABLE_SORT: TableSort = {
  key: "porandu",
  direction: "desc",
};

/** Filas por página que ofrece la tabla. */
export const TABLE_PAGE_SIZES = [10, 25, 50] as const;

export type TablePageSize = (typeof TABLE_PAGE_SIZES)[number];

export const DEFAULT_TABLE_PAGE_SIZE: TablePageSize = 10;

/**
 * Dirección con la que empieza cada columna: los scores, del más alto al
 * más bajo; la actividad, de la más reciente a la más vieja.
 */
const FIRST_DIRECTION: Readonly<Record<TableSortKey, SortDirection>> = {
  porandu: "desc",
  intent: "desc",
  fit: "desc",
  deal: "desc",
  activity: "asc",
};

/**
 * Orden después de pedir una columna: la misma columna invierte la
 * dirección; otra empieza por su dirección natural.
 */
export function nextTableSort(
  current: TableSort,
  key: TableSortKey,
): TableSort {
  if (current.key === key) {
    return { key, direction: current.direction === "asc" ? "desc" : "asc" };
  }
  return { key, direction: FIRST_DIRECTION[key] };
}

/** Valor de una fila para una columna; `null` es "sin dato". */
function sortValue(opportunity: Opportunity, key: TableSortKey) {
  if (key === "activity") return opportunity.lastActivity.minutes;
  return opportunity.scores[key];
}

/**
 * Ordena las filas. Un "sin dato" va siempre al final, en cualquier
 * dirección: no es ni el mejor ni el peor valor (DEC-005). Con el mismo
 * valor, primero la de actividad más reciente; después, el orden de entrada.
 */
export function sortTableRows(
  rows: readonly Opportunity[],
  sort: TableSort,
): Opportunity[] {
  const sign = sort.direction === "asc" ? 1 : -1;
  return rows.toSorted((a, b) => {
    const left = sortValue(a, sort.key);
    const right = sortValue(b, sort.key);
    if (left === null && right === null) {
      return a.lastActivity.minutes - b.lastActivity.minutes;
    }
    if (left === null) return 1;
    if (right === null) return -1;
    if (left !== right) return (left - right) * sign;
    return a.lastActivity.minutes - b.lastActivity.minutes;
  });
}

/** Sin mayúsculas ni tildes: "Ramón" encuentra "ramon". */
function fold(text: string): string {
  return text
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLocaleLowerCase("es-PY");
}

/** Vehículo que busca: la demanda (H1.4) o, si nunca se cargó, el legado. */
export function tableVehicle(opportunity: Opportunity): string | null {
  if (opportunity.demand) return opportunity.demand.vehicle?.title ?? null;
  const { model, version } = opportunity.interest;
  const legacy = [model, version].filter(Boolean).join(" ");
  return legacy || null;
}

/**
 * ¿La fila coincide con lo que se tipeó? Busca en el nombre del prospecto,
 * el vehículo que busca y el responsable. Una búsqueda vacía coincide con
 * todo.
 */
export function matchesTableQuery(
  opportunity: Opportunity,
  query: string,
): boolean {
  const needle = fold(query.trim());
  if (needle === "") return true;
  return [
    opportunity.prospect.name,
    tableVehicle(opportunity),
    opportunity.owner?.name,
  ].some(
    (field) =>
      field !== null && field !== undefined && fold(field).includes(needle),
  );
}

/**
 * Forma de pago declarada en la demanda; `null` si no se sabe. Sale del
 * mismo resumen tipado que la tarjeta del prospecto, sin parsear textos.
 */
export function tablePayment(opportunity: Opportunity): PurchaseType | null {
  const value = opportunity.demand?.facts.purchase_type.input.purchaseType;
  return PURCHASE_TYPES.find((type) => type === value) ?? null;
}

/** Señales rápidas de una fila, todas de datos reales del ViewModel. */
export type TableSignal = "live" | "tradeIn" | "urgent";

export function tableSignals(opportunity: Opportunity): TableSignal[] {
  const signals: TableSignal[] = [];
  if (opportunity.prospect.live) signals.push("live");
  if (opportunity.demand?.facts.trade_in_intent.input.tradeIn === "yes") {
    signals.push("tradeIn");
  }
  if (opportunity.nba?.urgent) signals.push("urgent");
  return signals;
}

export type TablePage<T> = Readonly<{
  items: readonly T[];
  /** Página mostrada (desde 1), ya acotada a las que existen. */
  page: number;
  pageCount: number;
  /** Posición de la primera y la última fila mostradas (desde 1); 0 sin filas. */
  from: number;
  to: number;
  total: number;
}>;

/** Recorta una página. Un número de página fuera de rango se acota. */
export function paginate<T>(
  rows: readonly T[],
  page: number,
  size: number,
): TablePage<T> {
  if (!Number.isInteger(size) || size <= 0) {
    throw new Error(`invalid page size: ${size}`);
  }
  const total = rows.length;
  const pageCount = Math.max(1, Math.ceil(total / size));
  const current = Math.min(Math.max(Math.trunc(page) || 1, 1), pageCount);
  const start = (current - 1) * size;
  const items = rows.slice(start, start + size);
  return {
    items,
    page: current,
    pageCount,
    from: items.length === 0 ? 0 : start + 1,
    to: start + items.length,
    total,
  };
}
