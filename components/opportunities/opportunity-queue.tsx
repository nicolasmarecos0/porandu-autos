import type { KeyboardEvent } from "react";
import { PoranduRing } from "@/components/intelligence/porandu-ring";
import { ScoreBreakdown } from "@/components/intelligence/score-breakdown";
import { cn } from "@/components/ui/cn";
import { ChevronRightIcon } from "@/components/ui/icons";
import { Kbd } from "@/components/ui/kbd";
import { Tooltip } from "@/components/ui/tooltip";
import { QUEUE_TABS, countByTab } from "@/domains/opportunities/queue";
import { formatElapsedShort } from "@/domains/opportunities/recency";
import type { Opportunity } from "@/domains/opportunities/types";
import type { ScoreComposition } from "@/domains/scoring/types";
import { RecencyEmoji } from "./recency-emoji";
import type { OpportunityQueueState } from "./use-opportunity-queue";

type OpportunityQueueProps = {
  opportunities: readonly Opportunity[];
  queue: OpportunityQueueState;
  idPrefix: string;
  referenceMinuteOfDay: number;
  scoreComposition: ScoreComposition;
};

/**
 * Cola operativa: filtro por urgencia y filas agrupadas ("Actuar ahora",
 * "Durante el día", "En seguimiento") ordenadas por Porandú Score. Es un
 * listbox: `↑`/`↓`, `Inicio`/`Fin` con foco en la lista; `J`/`K` desde
 * cualquier lugar.
 */
export function OpportunityQueue({
  opportunities,
  queue,
  idPrefix,
  referenceMinuteOfDay,
  scoreComposition,
}: OpportunityQueueProps) {
  const onListKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const keys: Record<string, () => void> = {
      ArrowDown: () => queue.move(1),
      ArrowUp: () => queue.move(-1),
      Home: () => queue.selectEdge("first"),
      End: () => queue.selectEdge("last"),
    };
    const action = keys[event.key];
    if (!action) return;
    event.preventDefault();
    action();
  };

  return (
    <section
      aria-label="Cola de oportunidades"
      className="flex min-h-0 flex-1 flex-col"
    >
      <div className="flex items-center justify-between px-0.5">
        <h2 className="text-label font-semibold text-text-primary">
          Cola de oportunidades
        </h2>
        <span className="flex items-center gap-1 text-caption text-text-muted">
          <Kbd>J</Kbd>
          <Kbd>K</Kbd>
        </span>
      </div>

      <div
        role="group"
        aria-label="Filtrar por urgencia"
        className="mt-2 grid grid-cols-[1fr_1fr_0.8fr_1.45fr] gap-0.5 rounded-md bg-surface-3 p-0.5"
      >
        {QUEUE_TABS.map((item) => {
          const isActive = queue.tab === item.id;
          return (
            <button
              key={item.id}
              type="button"
              aria-pressed={isActive}
              onClick={() => queue.setTab(item.id)}
              className={cn(
                "flex h-6 items-center justify-center gap-1 rounded-sm text-caption transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring",
                isActive
                  ? "bg-surface-1 font-semibold text-text-primary shadow-sm"
                  : "text-text-secondary hover:text-text-primary",
              )}
            >
              {item.label}
              <span
                className={cn(
                  "tabular-nums",
                  isActive ? "text-brand" : "text-text-muted",
                )}
              >
                {countByTab(opportunities, item.id)}
              </span>
            </button>
          );
        })}
      </div>

      <div
        role="listbox"
        aria-label="Oportunidades"
        tabIndex={0}
        aria-activedescendant={
          queue.selected ? `${idPrefix}-${queue.selected.id}` : undefined
        }
        onKeyDown={onListKeyDown}
        className="-mx-1 mt-2 flex min-h-0 flex-1 flex-col gap-1.5 overflow-y-auto rounded-md px-1 pt-0.5 pb-3 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-focus-ring"
      >
        {queue.groups.map((group) => (
          <div
            key={group.id}
            role="group"
            aria-label={group.label}
            className="contents"
          >
            <p
              aria-hidden="true"
              className="mt-1.5 px-0.5 text-overline text-text-muted uppercase first:mt-0"
            >
              {group.label}
            </p>
            {group.items.map((op) => (
              <QueueRow
                key={op.id}
                id={`${idPrefix}-${op.id}`}
                opportunity={op}
                composition={scoreComposition}
                selected={op.id === queue.selected?.id}
                done={queue.done.has(op.id)}
                elapsed={formatElapsedShort(
                  op.lastActivity.minutes,
                  referenceMinuteOfDay,
                )}
                onSelect={() => queue.select(op.id)}
              />
            ))}
          </div>
        ))}
        {queue.groups.length === 0 ? (
          <p className="py-8 text-center text-label text-text-muted">
            No hay oportunidades en esta vista.
          </p>
        ) : null}
      </div>
    </section>
  );
}

type QueueRowProps = {
  id: string;
  opportunity: Opportunity;
  composition: ScoreComposition;
  selected: boolean;
  done: boolean;
  elapsed: string;
  onSelect: () => void;
};

function QueueRow({
  id,
  opportunity,
  composition,
  selected,
  done,
  elapsed,
  onSelect,
}: QueueRowProps) {
  const { prospect, interest, scores, lastActivity } = opportunity;
  return (
    <div
      id={id}
      role="option"
      aria-selected={selected}
      onClick={onSelect}
      className={cn(
        "flex h-14 shrink-0 cursor-default items-center gap-3 rounded-md px-3 shadow-card ring-1",
        selected
          ? "bg-brand-soft ring-brand"
          : "bg-surface-1 ring-border-subtle hover:ring-border-strong",
      )}
    >
      <Tooltip
        content={<ScoreBreakdown scores={scores} composition={composition} />}
        side="right"
      >
        <span>
          <PoranduRing
            scores={scores}
            composition={composition}
            size={36}
            stroke={3.5}
            tone="onLight"
          >
            <span
              className={cn(
                "text-caption font-semibold tabular-nums",
                scores.porandu >= 85
                  ? "text-brand-strong"
                  : scores.porandu >= 70
                    ? "text-text-primary"
                    : "text-text-muted",
              )}
            >
              {scores.porandu}
            </span>
          </PoranduRing>
        </span>
      </Tooltip>
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-1.5">
          <span
            className={cn(
              "truncate text-label font-semibold",
              done
                ? "text-text-muted line-through decoration-border-strong"
                : "text-text-primary",
            )}
          >
            {prospect.name}
          </span>
          {prospect.live ? (
            <>
              <span
                aria-hidden="true"
                className="size-1.5 shrink-0 rounded-full bg-success"
              />
              <span className="sr-only">En vivo</span>
            </>
          ) : null}
        </span>
        <span className="block truncate text-caption text-text-muted">
          {interest.model} {interest.version}
        </span>
      </span>
      <span className="flex shrink-0 flex-col items-end gap-0.5 text-caption text-text-muted tabular-nums">
        <RecencyEmoji minutes={lastActivity.minutes} />
        {elapsed}
      </span>
      <ChevronRightIcon
        className={cn(
          "size-4 shrink-0",
          selected ? "text-brand" : "text-text-muted",
        )}
      />
    </div>
  );
}
