"use client";

import {
  NewOpportunityDrawer,
  type OpportunityCreated,
} from "@/components/opportunities/new-opportunity-drawer";
import { OpportunitiesViewSwitch } from "@/components/opportunities/opportunities-view-switch";
import type { PipelineBoard } from "@/domains/opportunities/pipeline";

/*
 * Encabezado del embudo (propuesta DEC-048): título, el selector de vista
 * (Cola · Embudo), "Nueva oportunidad" y una línea de lectura rápida con la
 * foto de la lectura (abiertas, inactivas y con acciones pendientes) y su
 * hora. En pantallas chicas los bloques bajan de línea; la ayuda del
 * arrastre solo aparece donde hay mouse.
 */

function plural(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`;
}

export function createdNotice(created: OpportunityCreated): string {
  return created.contactReused
    ? `Oportunidad creada. El teléfono ya era de ${created.contactName}: se usó ese contacto, sin cambios.`
    : `Oportunidad creada para ${created.contactName}.`;
}

export function PipelineHeader({
  title,
  board,
  onCreated,
}: {
  title: string;
  board: PipelineBoard;
  onCreated: (created: OpportunityCreated) => void;
}) {
  const { summary } = board;
  return (
    <header className="shrink-0 border-b border-border-subtle bg-surface-1 px-gutter pt-3 pb-3">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2.5">
        <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-2">
          <h1 className="text-title text-text-primary">{title}</h1>
          <OpportunitiesViewSwitch current="pipeline" />
        </div>
        <div className="shrink-0">
          <NewOpportunityDrawer onCreated={onCreated} />
        </div>
      </div>
      <p className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-label text-text-muted">
        <span className="tabular-nums">
          {plural(summary.open, "abierta", "abiertas")}
        </span>
        {summary.stale > 0 ? (
          <span className="inline-flex items-center gap-1.5 font-semibold text-danger tabular-nums">
            <span
              aria-hidden="true"
              className="size-1.5 rounded-full bg-danger"
            />
            {plural(summary.stale, "inactiva", "inactivas")}
          </span>
        ) : null}
        {summary.pending > 0 ? (
          <span className="inline-flex items-center gap-1.5 font-semibold text-brand-strong tabular-nums">
            <span
              aria-hidden="true"
              className="size-1.5 rounded-full bg-brand"
            />
            {summary.pending === 1
              ? "1 con acciones pendientes"
              : `${summary.pending} con acciones pendientes`}
          </span>
        ) : null}
        <span>
          Actualizado{" "}
          <time dateTime={board.generatedAt}>{board.generatedLabel}</time>
        </span>
        <span className="hidden pointer-fine:inline">
          · Arrastrá una tarjeta para cambiar su etapa
        </span>
      </p>
    </header>
  );
}
