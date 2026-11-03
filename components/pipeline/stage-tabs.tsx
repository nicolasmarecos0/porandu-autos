"use client";

import { useEffect, useRef, useState, type RefObject } from "react";

import { cn } from "@/components/ui/cn";
import type { PipelineColumn } from "@/domains/opportunities/pipeline";
import { isStage, type Stage } from "@/domains/opportunities/stages";

import { pipelineColumnId } from "./links";

/*
 * Tira de etapas del embudo en pantallas chicas (propuesta DEC-048):
 * debajo de `xl` las columnas no entran a lo ancho y el tablero se recorre
 * de a una columna, con scroll horizontal y snap. La tira dice en qué etapa
 * se está y cuántas hay en cada una, y un toque lleva a cualquiera.
 *
 * La etapa visible la sigue un IntersectionObserver sobre el tablero (la
 * columna con más superficie a la vista). Llevar a una columna respeta
 * "reducir movimiento". Desde `xl` se ven las cinco columnas y la tira no
 * se muestra.
 */

function prefersReducedMotion(): boolean {
  return (
    typeof window !== "undefined" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

export function StageTabs({
  columns,
  boardRef,
}: {
  columns: readonly PipelineColumn[];
  boardRef: RefObject<HTMLDivElement | null>;
}) {
  const [current, setCurrent] = useState<Stage>(columns[0]?.stage ?? "new");
  const ratios = useRef(new Map<Stage, number>());

  useEffect(() => {
    const root = boardRef.current;
    if (!root || typeof IntersectionObserver === "undefined") return;
    const seen = ratios.current;
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const stage = entry.target.getAttribute("data-stage");
          if (isStage(stage)) seen.set(stage, entry.intersectionRatio);
        }
        let best: Stage | null = null;
        let bestRatio = 0;
        for (const [stage, ratio] of seen) {
          if (ratio > bestRatio) {
            best = stage;
            bestRatio = ratio;
          }
        }
        if (best) setCurrent(best);
      },
      { root, threshold: [0, 0.25, 0.5, 0.75, 1] },
    );
    root
      .querySelectorAll("[data-stage]")
      .forEach((column) => observer.observe(column));
    return () => {
      observer.disconnect();
      seen.clear();
    };
  }, [boardRef]);

  function show(stage: Stage) {
    setCurrent(stage);
    document.getElementById(pipelineColumnId(stage))?.scrollIntoView({
      behavior: prefersReducedMotion() ? "auto" : "smooth",
      block: "nearest",
      inline: "start",
    });
  }

  return (
    <nav
      aria-label="Etapas del embudo"
      className="shrink-0 border-b border-border-subtle bg-surface-1 xl:hidden"
    >
      <ul className="flex [scrollbar-width:none] gap-1 overflow-x-auto px-gutter py-2">
        {columns.map((column) => {
          const active = column.stage === current;
          return (
            <li key={column.stage} className="shrink-0">
              <button
                type="button"
                aria-controls={pipelineColumnId(column.stage)}
                aria-current={active ? "true" : undefined}
                onClick={() => show(column.stage)}
                className={cn(
                  "inline-flex h-8 items-center gap-1.5 rounded-full border px-3 text-label whitespace-nowrap transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring",
                  active
                    ? "border-brand bg-brand font-semibold text-brand-contrast"
                    : "border-border-default bg-surface-1 text-text-secondary hover:border-border-strong",
                )}
              >
                {column.label}
                <span
                  className={cn(
                    "tabular-nums",
                    active ? "text-brand-contrast" : "text-text-muted",
                  )}
                >
                  {column.total}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
