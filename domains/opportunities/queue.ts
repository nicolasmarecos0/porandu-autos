import { BUCKETS } from "./labels";
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
        .toSorted((a, b) => b.scores.porandu - a.scores.porandu),
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
