"use client";

import { useEffect, useRef, useState } from "react";
import { NextBestActionCard } from "@/components/intelligence/next-best-action";
import { ScoreDock, ScoreStrip } from "@/components/intelligence/score-strip";
import { WhyNowCard } from "@/components/intelligence/why-now";
import { cn } from "@/components/ui/cn";
import { ChevronLeftIcon, CloseIcon } from "@/components/ui/icons";
import { TooltipProvider } from "@/components/ui/tooltip";
import { VehicleRail } from "@/components/vehicle-rail/vehicle-rail";
import {
  formatElapsedLong,
  formatElapsedShort,
} from "@/domains/opportunities/recency";
import type { Opportunity } from "@/domains/opportunities/types";
import type { ScoreComposition } from "@/domains/scoring/types";
import {
  NewOpportunityDrawer,
  type OpportunityCreated,
} from "./new-opportunity-drawer";
import { OpportunitiesViewSwitch } from "./opportunities-view-switch";
import { OpportunityQueue } from "./opportunity-queue";
import { DemandCard } from "./demand-card";
import { ProspectCard } from "./prospect-card";
import { RecencyEmoji } from "./recency-emoji";
import { useOpportunityQueue } from "./use-opportunity-queue";

type OpportunitiesViewProps = {
  title: string;
  opportunities: readonly Opportunity[];
  referenceMinuteOfDay: number;
  /** Composición para explicar el Porandú Score: dato de la fuente. */
  scoreComposition: ScoreComposition;
  /** Oportunidad elegida al abrir (`?op=`, desde la tabla, DEC-055). */
  initialSelectedId?: string | null;
};

const ID_PREFIX = "opportunity";

/** Teléfono: por debajo de `md` (48rem), la vista es maestro/detalle. */
const PHONE_QUERY = "(width < 48rem)";

/** Región visible en el teléfono. Desde `md` se ven las dos juntas. */
type Pane = "list" | "detail";

/**
 * Opportunities (DEC-015): Reference-first + Porandú DNA.
 *
 *   ┌ identidad ──┬ strip de scores ────────┬ busca ───────┐
 *   │ prospecto   │ ¿Qué hacer?             │ Top Match    │
 *   ├ cola ───────┤ ¿Por qué ahora?         │ alternativa  │
 *   │             │ (fuertes / a validar)   │ trade-in     │
 *   └─────────────┴─────────────────────────┴──────────────┘
 *
 * "Busca" es la demanda estructurada (H1.4): Current Truth resumida, con
 * edición en el drawer "Lo que busca" y el historial en /opportunities/[id].
 *
 * Responsive (DEC-055):
 * - desde `xl`, las tres columnas, cada una con scroll propio;
 * - de `md` a `xl`, la columna izquierda y una sola columna con scroll: la
 *   decisión y, debajo, ¿qué ofrecerle?;
 * - en el teléfono, maestro/detalle: la cola ocupa la pantalla; abrir una
 *   oportunidad muestra su detalle con "Volver" y los cuatro scores fijos
 *   abajo. El foco va al título del detalle y, al volver, a la cola.
 *
 * Los datos llegan del loader de la página (PostgreSQL, tenant-scoped).
 * Desde Hito 3 (DEC-035), el Porandú Score con su desglose, la recencia y
 * "¿Qué hacer?" los deriva el motor de inteligencia en el loader. Lo que la
 * fuente no trae ("sin dato") no se muestra: sin señales ni matches
 * inventados.
 *
 * "Nueva oportunidad" (H1.2) abre el alta manual en un drawer. Al crear, la
 * Server Action revalida la página, la cola trae la oportunidad nueva y la
 * vista la selecciona.
 *
 * Arriba de la cola, el selector de vista lleva al embudo de ventas por
 * etapa (/opportunities/pipeline, propuesta DEC-048) y a la tabla
 * (/opportunities/table, DEC-055): son vistas de Opportunities, no ítems de
 * la navegación (DEC-001).
 */
export function OpportunitiesView({
  title,
  opportunities,
  referenceMinuteOfDay,
  scoreComposition,
  initialSelectedId = null,
}: OpportunitiesViewProps) {
  const queue = useOpportunityQueue(
    opportunities,
    ID_PREFIX,
    initialSelectedId,
  );
  const { selected } = queue;
  const [showSources, setShowSources] = useState(true);
  const [created, setCreated] = useState<OpportunityCreated | null>(null);
  // Quien llega desde la tabla con `?op=` viene a ver esa oportunidad.
  const [pane, setPane] = useState<Pane>(initialSelectedId ? "detail" : "list");
  const asideRef = useRef<HTMLElement>(null);
  const detailRef = useRef<HTMLDivElement>(null);
  const detailHeadingRef = useRef<HTMLHeadingElement>(null);
  const centerRef = useRef<HTMLElement>(null);
  const rightRef = useRef<HTMLElement>(null);

  // Cada oportunidad se lee desde arriba.
  const selectedKey = selected?.id;
  useEffect(() => {
    detailRef.current?.scrollTo({ top: 0 });
    centerRef.current?.scrollTo({ top: 0 });
    rightRef.current?.scrollTo({ top: 0 });
  }, [selectedKey]);

  const openDetail = (opportunityId: string) => {
    queue.select(opportunityId);
    setPane("detail");
    // En el teléfono, el foco acompaña el cambio de región. Desde `md` la
    // cola conserva el foco: ↑/↓ siguen recorriéndola.
    if (window.matchMedia(PHONE_QUERY).matches) {
      requestAnimationFrame(() => detailHeadingRef.current?.focus());
    }
  };

  const backToList = () => {
    setPane("list");
    requestAnimationFrame(() =>
      asideRef.current?.querySelector<HTMLElement>('[role="listbox"]')?.focus(),
    );
  };

  return (
    <TooltipProvider delayDuration={350}>
      <div className="flex min-h-0 flex-1 gap-3 p-3">
        <h1 className="sr-only">{title}</h1>

        <aside
          ref={asideRef}
          aria-label="Prospecto y cola"
          className={cn(
            "flex min-h-0 w-full flex-col gap-3 md:w-64 md:shrink-0 lg:w-72 xl:w-75",
            pane === "detail" && "max-md:hidden",
          )}
        >
          <OpportunitiesViewSwitch current="queue" />
          <NewOpportunityDrawer
            onCreated={(result) => {
              queue.setTab("all");
              queue.select(result.opportunityId);
              setCreated(result);
            }}
          />
          <CreatedNotice created={created} onDismiss={() => setCreated(null)} />
          {selected ? (
            <ProspectCard opportunity={selected} className="max-md:hidden" />
          ) : null}
          <OpportunityQueue
            opportunities={opportunities}
            queue={queue}
            idPrefix={ID_PREFIX}
            referenceMinuteOfDay={referenceMinuteOfDay}
            scoreComposition={scoreComposition}
            onOpen={openDetail}
          />
        </aside>

        <div
          ref={detailRef}
          className={cn(
            "flex min-h-0 min-w-0 flex-1 flex-col gap-3 overflow-y-auto max-md:pb-24 xl:flex-row xl:overflow-hidden",
            pane === "list" && "max-md:hidden",
          )}
        >
          {selected ? (
            <>
              <div className="flex shrink-0 items-center gap-2 md:hidden">
                <button
                  type="button"
                  onClick={backToList}
                  className="inline-flex h-9 shrink-0 items-center gap-1 rounded-md pr-3 pl-1.5 text-label font-semibold text-brand hover:bg-brand-soft focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring"
                >
                  <ChevronLeftIcon className="size-4.5" />
                  Volver
                </button>
                <h2
                  ref={detailHeadingRef}
                  tabIndex={-1}
                  className="min-w-0 flex-1 truncate text-heading text-text-primary focus:outline-none"
                >
                  {selected.prospect.name}
                </h2>
              </div>
              <ProspectCard opportunity={selected} className="md:hidden" />
            </>
          ) : null}

          <section
            ref={centerRef}
            aria-label="Decisión"
            className="flex min-w-0 shrink-0 flex-col gap-3 pt-2 xl:min-h-0 xl:flex-1 xl:shrink xl:overflow-y-auto xl:pb-6"
          >
            {selected ? (
              <>
                <ScoreStrip
                  scores={selected.scores}
                  composition={scoreComposition}
                  explanation={selected.scoreExplanation}
                  className="max-md:hidden"
                />
                {selected.nba ? (
                  <NextBestActionCard
                    nba={selected.nba}
                    done={queue.done.has(selected.id)}
                    onToggleDone={() => queue.toggleDone(selected.id)}
                    recency={
                      selected.lastActivity.state
                        ? {
                            state: selected.lastActivity.state,
                            elapsed: formatElapsedShort(
                              selected.lastActivity.minutes,
                              referenceMinuteOfDay,
                            ),
                          }
                        : undefined
                    }
                  />
                ) : null}
                <div className="mt-2 flex items-baseline justify-between gap-3 px-0.5">
                  <h2 className="text-title text-text-primary">
                    ¿Por qué ahora?
                  </h2>
                  {selected.drivers.length > 0 ? (
                    <button
                      type="button"
                      aria-pressed={showSources}
                      onClick={() => setShowSources((value) => !value)}
                      className="shrink-0 rounded-sm text-label font-medium text-brand hover:text-brand-strong hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring"
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
            className="flex shrink-0 flex-col gap-3 pb-6 xl:min-h-0 xl:w-98 xl:overflow-y-auto"
          >
            {selected?.demand ? (
              <DemandCard
                key={selected.id}
                opportunityId={selected.id}
                demand={selected.demand}
              />
            ) : null}
            {selected ? <VehicleRail opportunity={selected} /> : null}
          </aside>

          {selected ? <ScoreDock scores={selected.scores} /> : null}
        </div>
      </div>
    </TooltipProvider>
  );
}

/**
 * Confirmación del alta. Dice qué contacto quedó asociado: si el teléfono ya
 * era de un contacto, se usó ese y su nombre no cambió. El texto también se
 * anuncia por la región `status`, que existe siempre.
 */
function CreatedNotice({
  created,
  onDismiss,
}: {
  created: OpportunityCreated | null;
  onDismiss: () => void;
}) {
  const message = created
    ? created.contactReused
      ? `Oportunidad creada. El teléfono ya era de ${created.contactName}: se usó ese contacto, sin cambios.`
      : `Oportunidad creada para ${created.contactName}.`
    : "";
  return (
    <div role="status" className={created ? undefined : "sr-only"}>
      {created ? (
        <p className="flex items-start gap-2 rounded-md border border-success-border bg-success-soft py-2 pr-1.5 pl-3 text-label text-success">
          <span className="min-w-0 flex-1 pt-0.5">{message}</span>
          <button
            type="button"
            aria-label="Cerrar aviso"
            onClick={onDismiss}
            className="flex size-6 shrink-0 items-center justify-center rounded-sm hover:bg-success-border/40 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-focus-ring"
          >
            <CloseIcon className="size-3.5" />
          </button>
        </p>
      ) : null}
    </div>
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
        Cargá la primera con «Nueva oportunidad». Vas a ver acá a quién atender
        primero.
      </p>
    </div>
  );
}
