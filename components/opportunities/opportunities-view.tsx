"use client";

import { useEffect, useRef, useState } from "react";
import { NextBestActionCard } from "@/components/intelligence/next-best-action";
import { ScoreStrip } from "@/components/intelligence/score-strip";
import { WhyNowCard } from "@/components/intelligence/why-now";
import { TooltipProvider } from "@/components/ui/tooltip";
import { VehicleRail } from "@/components/vehicle-rail/vehicle-rail";
import { formatElapsedLong } from "@/domains/opportunities/recency";
import type { Opportunity } from "@/domains/opportunities/types";
import type { ScoreComposition } from "@/domains/scoring/types";
import { OpportunityQueue } from "./opportunity-queue";
import { ProspectCard } from "./prospect-card";
import { RecencyEmoji } from "./recency-emoji";
import { useOpportunityQueue } from "./use-opportunity-queue";

type OpportunitiesViewProps = {
  title: string;
  opportunities: readonly Opportunity[];
  referenceMinuteOfDay: number;
  /** Composición para explicar el Porandú Score: dato de la fuente. */
  scoreComposition: ScoreComposition;
};

const ID_PREFIX = "opportunity";

/**
 * Opportunities (DEC-015): Reference-first + Porandú DNA.
 *
 *   ┌ identidad ──┬ strip de scores ────────┬ busca ───────┐
 *   │ prospecto   │ ¿Qué hacer?             │ Top Match    │
 *   ├ cola ───────┤ ¿Por qué ahora?         │ alternativa  │
 *   │             │ (fuertes / a validar)   │ trade-in     │
 *   └─────────────┴─────────────────────────┴──────────────┘
 *
 * Cada columna tiene scroll propio. Los datos llegan del loader de la página
 * (PostgreSQL, tenant-scoped). Lo que la fuente no trae ("sin dato") no se
 * muestra: sin NBA, señales ni matches inventados.
 */
export function OpportunitiesView({
  title,
  opportunities,
  referenceMinuteOfDay,
  scoreComposition,
}: OpportunitiesViewProps) {
  const queue = useOpportunityQueue(opportunities, ID_PREFIX);
  const { selected } = queue;
  const [showSources, setShowSources] = useState(true);
  const centerRef = useRef<HTMLElement>(null);
  const rightRef = useRef<HTMLElement>(null);

  // Cada oportunidad se lee desde arriba.
  const selectedKey = selected?.id;
  useEffect(() => {
    centerRef.current?.scrollTo({ top: 0 });
    rightRef.current?.scrollTo({ top: 0 });
  }, [selectedKey]);

  return (
    <TooltipProvider delayDuration={350}>
      <div className="flex min-h-0 flex-1 gap-3 p-3">
        <h1 className="sr-only">{title}</h1>

        <aside
          aria-label="Prospecto y cola"
          className="flex min-h-0 w-75 shrink-0 flex-col gap-3"
        >
          {selected ? <ProspectCard opportunity={selected} /> : null}
          <OpportunityQueue
            opportunities={opportunities}
            queue={queue}
            idPrefix={ID_PREFIX}
            referenceMinuteOfDay={referenceMinuteOfDay}
            scoreComposition={scoreComposition}
          />
        </aside>

        <section
          ref={centerRef}
          aria-label="Decisión"
          className="flex min-w-0 flex-1 flex-col gap-3 overflow-y-auto pt-2 pb-6"
        >
          {selected ? (
            <>
              <ScoreStrip
                scores={selected.scores}
                composition={scoreComposition}
              />
              {selected.nba ? (
                <NextBestActionCard
                  nba={selected.nba}
                  done={queue.done.has(selected.id)}
                  onToggleDone={() => queue.toggleDone(selected.id)}
                />
              ) : null}
              <div className="mt-1 flex items-baseline justify-between px-0.5">
                <h2 className="text-heading text-text-primary">
                  ¿Por qué ahora?
                </h2>
                {selected.drivers.length > 0 ? (
                  <button
                    type="button"
                    aria-pressed={showSources}
                    onClick={() => setShowSources((value) => !value)}
                    className="rounded-sm text-label text-brand hover:text-brand-strong hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring"
                  >
                    {showSources ? "Ocultar fuentes" : "Mostrar fuentes"}
                  </button>
                ) : null}
              </div>
              <WhyNowCard
                drivers={selected.drivers}
                showSources={showSources}
                footer={
                  <>
                    <RecencyEmoji minutes={selected.lastActivity.minutes} />
                    Última actividad{" "}
                    {formatElapsedLong(
                      selected.lastActivity.minutes,
                      referenceMinuteOfDay,
                    )}
                    {selected.lastActivity.summary
                      ? ` · ${selected.lastActivity.summary}`
                      : null}
                  </>
                }
              />
            </>
          ) : opportunities.length === 0 ? (
            <EmptyQueue />
          ) : null}
        </section>

        <aside
          ref={rightRef}
          aria-label="¿Qué ofrecerle?"
          className="flex w-98 shrink-0 flex-col gap-3 overflow-y-auto pb-6"
        >
          {selected ? <VehicleRail opportunity={selected} /> : null}
        </aside>
      </div>
    </TooltipProvider>
  );
}

/** Organización sin oportunidades: estado vacío, sin datos de ejemplo. */
function EmptyQueue() {
  return (
    <div className="rounded-lg bg-surface-1 px-5 py-8 text-center shadow-card">
      <p className="text-heading text-text-primary">
        Todavía no hay oportunidades
      </p>
      <p className="mt-1 text-label text-text-muted">
        Cuando esta organización registre oportunidades, vas a ver acá a quién
        atender primero.
      </p>
    </div>
  );
}
