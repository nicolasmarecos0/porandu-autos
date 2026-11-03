"use client";

import { useDroppable } from "@dnd-kit/core";

import { STAGE_TONES } from "@/components/opportunities/stage-badge";
import { cn } from "@/components/ui/cn";
import type {
  PipelineCard,
  PipelineColumn,
} from "@/domains/opportunities/pipeline";
import {
  dropZone,
  type DropZone,
} from "@/domains/opportunities/pipeline-moves";
import { isTerminalStage, type Stage } from "@/domains/opportunities/stages";

import { pipelineColumnId } from "./links";
import { DraggablePipelineCard } from "./pipeline-card";

/*
 * Columna del embudo (propuesta DEC-048): una etapa de DEC-032 con su
 * cantidad, sus inactivas y sus tarjetas, con scroll propio. Toda la
 * columna es zona de suelta. Mientras se arrastra una tarjeta, cada columna
 * dice qué pasaría al soltarla ahí: avanzar (marca), cerrar (éxito o
 * peligro, pide los datos) o nada (atenuada). La pista que acompaña a la
 * tarjeta arrastrada (DragHint) repite lo de la columna de abajo, con el
 * porqué de un pase que no existe. El color acompaña siempre al texto
 * (DEC-013).
 */

const ACCENTS = {
  neutral: "bg-border-strong",
  brand: "bg-brand",
  warning: "bg-warning",
  success: "bg-success",
  danger: "bg-danger",
} as const;

function zoneClasses(stage: Stage, zone: DropZone, isOver: boolean): string {
  switch (zone.state) {
    case "source":
      return "ring-1 ring-border-default";
    case "advance":
      return isOver
        ? "bg-brand-soft ring-2 ring-brand"
        : "bg-brand-soft/50 ring-2 ring-brand-border";
    case "close":
      return stage === "won"
        ? isOver
          ? "bg-success-soft ring-2 ring-success"
          : "bg-success-soft/50 ring-2 ring-success-border"
        : isOver
          ? "bg-danger-soft ring-2 ring-danger"
          : "bg-danger-soft/50 ring-2 ring-danger-border";
    case "blocked":
      return isOver ? "ring-2 ring-danger-border" : "opacity-55";
  }
}

const HINT_TONES = {
  advance: "border-brand-border bg-surface-1 text-brand-strong",
  won: "border-success-border bg-surface-1 text-success",
  lost: "border-danger-border bg-surface-1 text-danger",
} as const;

function DropHint({ stage, zone }: { stage: Stage; zone: DropZone }) {
  // Una columna sin pase no se anuncia: el porqué lo dice la pista que
  // acompaña a la tarjeta arrastrada (DragHint) y, al soltar, el aviso.
  if (zone.state === "source" || zone.state === "blocked") return null;
  const tone =
    zone.state === "advance"
      ? HINT_TONES.advance
      : stage === "won"
        ? HINT_TONES.won
        : HINT_TONES.lost;
  return (
    <p
      aria-hidden="true"
      className={cn(
        "sticky top-0 z-10 mb-2 flex items-start gap-1.5 rounded-md border border-dashed px-2.5 py-2 text-caption font-semibold shadow-sm",
        tone,
      )}
    >
      {zone.hint}
    </p>
  );
}

function EmptyColumn({ closed, days }: { closed: boolean; days: number }) {
  return (
    <p className="rounded-lg border border-dashed border-border-default px-3 py-6 text-center text-caption text-text-muted">
      {closed
        ? `Sin cierres en los últimos ${days} días`
        : "Sin oportunidades en esta etapa"}
    </p>
  );
}

type PipelineColumnViewProps = Readonly<{
  column: PipelineColumn;
  /** Etapa de la tarjeta que se arrastra, o null. */
  dragFrom: Stage | null;
  /** Tarjetas que se están guardando. */
  saving: ReadonlySet<string>;
  closedWindowDays: number;
  onMove: (card: PipelineCard, to: Stage) => void;
}>;

export function PipelineColumnView({
  column,
  dragFrom,
  saving,
  closedWindowDays,
  onMove,
}: PipelineColumnViewProps) {
  const { setNodeRef, isOver } = useDroppable({ id: column.stage });
  const zone = dragFrom ? dropZone(dragFrom, column.stage) : null;
  const headingId = `${pipelineColumnId(column.stage)}-heading`;
  const closed = isTerminalStage(column.stage);
  const hidden = column.total - column.cards.length;

  return (
    <section
      ref={setNodeRef}
      id={pipelineColumnId(column.stage)}
      data-stage={column.stage}
      aria-labelledby={headingId}
      className={cn(
        "flex min-h-0 w-[85%] shrink-0 snap-start flex-col rounded-xl bg-bg-subtle/70 transition-[background-color,box-shadow,opacity] duration-150 ease-out-strong sm:w-72 xl:w-auto xl:min-w-0 xl:flex-1",
        zone ? zoneClasses(column.stage, zone, isOver) : null,
      )}
    >
      <header className="flex flex-col gap-1 px-3 pt-3 pb-2">
        <span
          aria-hidden="true"
          className={cn(
            "h-0.5 w-8 rounded-full",
            ACCENTS[STAGE_TONES[column.stage]],
          )}
        />
        <div className="flex min-w-0 items-center gap-2">
          <h2
            id={headingId}
            className="truncate text-label font-semibold text-text-primary"
          >
            {column.label}
          </h2>
          <span className="shrink-0 rounded-full bg-surface-1 px-2 py-px text-caption font-semibold text-text-secondary tabular-nums shadow-sm">
            {column.total}
            <span className="sr-only">
              {column.total === 1 ? " oportunidad" : " oportunidades"}
            </span>
          </span>
          {column.stale > 0 ? (
            <span className="ml-auto inline-flex shrink-0 items-center gap-1 text-caption font-semibold text-danger">
              <span
                aria-hidden="true"
                className="size-1.5 rounded-full bg-danger"
              />
              {column.stale === 1 ? "1 inactiva" : `${column.stale} inactivas`}
            </span>
          ) : null}
        </div>
        <p className="truncate text-caption text-text-muted">{column.hint}</p>
      </header>

      {/* `relative`: la columna recorta lo posicionado de sus tarjetas. */}
      <div className="relative min-h-0 flex-1 overflow-y-auto overscroll-y-contain px-2 pb-2">
        {zone ? <DropHint stage={column.stage} zone={zone} /> : null}
        {column.cards.length > 0 ? (
          <ol className="flex flex-col gap-2">
            {column.cards.map((card) => (
              <li key={card.id}>
                <DraggablePipelineCard
                  card={card}
                  saving={saving.has(card.id)}
                  onMove={onMove}
                />
              </li>
            ))}
          </ol>
        ) : (
          <EmptyColumn closed={closed} days={closedWindowDays} />
        )}
        {hidden > 0 ? (
          <p className="px-1 pt-2.5 text-caption text-text-muted">
            Se muestran {column.cards.length} de {column.total}
            {closed
              ? ": las más recientes."
              : ": las de mayor Porandú Score. Todas están en la cola."}
          </p>
        ) : null}
      </div>
    </section>
  );
}
