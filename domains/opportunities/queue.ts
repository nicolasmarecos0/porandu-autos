import { BUCKETS } from "./labels";
import { RECENCY_BANDS } from "./recency";
import type { Bucket, Opportunity } from "./types";

/*
 * Cola de oportunidades: agrupación por urgencia y orden por Porandú Score.
 * Lógica pura; la selección y el estado de UI viven en components/.
 */

export type QueueTab = Bucket | "all";

export const QUEUE_TABS: readonly { id: QueueTab; label: string }[] = [
  { id: "all", label: "Todas" },
  { id: "now", label: "Ahora" },
  { id: "today", label: "Hoy" },
  { id: "followUp", label: "Seguimiento" },
];

export type QueueGroup = {
  id: Bucket;
  label: string;
  items: readonly Opportunity[];
};

/**
 * Regla TEMPORAL de urgencia mientras no exista Intelligence (Hito 1): la
 * urgencia sale de las bandas de recencia aprobadas (B1 §3.2), sin guardarse.
 *   🔥/🟢 (< 30 min) → Actuar ahora · 🟡 (30 min–2 h) → Durante el día ·
 *   ❄️ (> 2 h) → En seguimiento.
 * No es una regla comercial: se reemplaza cuando la urgencia la calcule el
 * motor de inteligencia.
 */
export function bucketFromRecency(minutes: number): Bucket {
  if (minutes < RECENCY_BANDS.recent) return "now";
  if (minutes < RECENCY_BANDS.today) return "today";
  return "followUp";
}

/*
 * Prioridad dentro de un grupo: Porandú Score descendente. Una oportunidad
 * sin score (sin dato) va después de las que tienen score, y entre ellas
 * primero la de actividad más reciente. Con el mismo score se conserva el
 * orden de entrada.
 */
function byPriority(a: Opportunity, b: Opportunity): number {
  const left = a.scores.porandu;
  const right = b.scores.porandu;
  if (left !== null && right !== null) return right - left;
  if (left !== null) return -1;
  if (right !== null) return 1;
  return a.lastActivity.minutes - b.lastActivity.minutes;
}

export function groupQueue(
  opportunities: readonly Opportunity[],
  tab: QueueTab,
): QueueGroup[] {
  return BUCKETS.filter((bucket) => tab === "all" || bucket.id === tab)
    .map((bucket) => ({
      id: bucket.id,
      label: bucket.label,
      items: opportunities
        .filter((op) => op.bucket === bucket.id)
        .toSorted(byPriority),
    }))
    .filter((group) => group.items.length > 0);
}

export function countByTab(
  opportunities: readonly Opportunity[],
  tab: QueueTab,
): number {
  return tab === "all"
    ? opportunities.length
    : opportunities.filter((op) => op.bucket === tab).length;
}
