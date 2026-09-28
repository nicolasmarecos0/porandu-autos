"use client";

import { useEffect, useEffectEvent, useState } from "react";
import { groupQueue, type QueueTab } from "@/domains/opportunities/queue";
import type { Opportunity } from "@/domains/opportunities/types";

function isTypingTarget(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLElement &&
    (/^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName) ||
      target.isContentEditable)
  );
}

/**
 * Estado de UI de la cola: filtro por urgencia, oportunidad seleccionada y
 * acciones marcadas como hechas (estado simulado en cliente, B1 §3.2).
 *
 * `J`/`K` recorren la cola desde cualquier lugar de la página. Sin animación:
 * es una acción de teclado que se repite cientos de veces por día.
 */
export function useOpportunityQueue(
  opportunities: readonly Opportunity[],
  idPrefix: string,
) {
  const [tab, setTab] = useState<QueueTab>("all");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [done, setDone] = useState<ReadonlySet<string>>(() => new Set());

  const groups = groupQueue(opportunities, tab);
  const ordered = groups.flatMap((group) => group.items);
  const selected = ordered.find((op) => op.id === selectedId) ?? ordered[0];

  const move = (delta: number) => {
    if (ordered.length === 0) return;
    const index = selected ? ordered.indexOf(selected) : -1;
    const next =
      ordered[Math.min(Math.max(index + delta, 0), ordered.length - 1)];
    if (next) setSelectedId(next.id);
  };

  const selectEdge = (edge: "first" | "last") => {
    const next = edge === "first" ? ordered[0] : ordered.at(-1);
    if (next) setSelectedId(next.id);
  };

  const handleGlobalKey = useEffectEvent((event: KeyboardEvent) => {
    if (event.metaKey || event.ctrlKey || event.altKey) return;
    if (isTypingTarget(event.target)) return;
    if (event.key === "j") move(1);
    else if (event.key === "k") move(-1);
  });

  useEffect(() => {
    const listener = (event: KeyboardEvent) => handleGlobalKey(event);
    document.addEventListener("keydown", listener);
    return () => document.removeEventListener("keydown", listener);
  }, []);

  const selectedKey = selected?.id;
  useEffect(() => {
    if (!selectedKey) return;
    document
      .getElementById(`${idPrefix}-${selectedKey}`)
      ?.scrollIntoView({ block: "nearest" });
  }, [idPrefix, selectedKey]);

  const toggleDone = (id: string) =>
    setDone((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return {
    tab,
    setTab,
    groups,
    selected,
    select: setSelectedId,
    move,
    selectEdge,
    done,
    toggleDone,
  };
}

export type OpportunityQueueState = ReturnType<typeof useOpportunityQueue>;
