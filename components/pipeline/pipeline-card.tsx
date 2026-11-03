"use client";

import { useDraggable } from "@dnd-kit/core";
import Link from "next/link";
import type { ComponentType } from "react";

import { Avatar } from "@/components/ui/avatar";
import { cn } from "@/components/ui/cn";
import {
  AlertIcon,
  BoxIcon,
  CheckIcon,
  ChevronRightIcon,
  CloseIcon,
  DocumentIcon,
  SteeringIcon,
  type IconProps,
} from "@/components/ui/icons";
import type {
  CardRecency,
  PendingAction,
  PendingActionKind,
  PipelineCard,
} from "@/domains/opportunities/pipeline";
import type { DropZone } from "@/domains/opportunities/pipeline-moves";
import { isTerminalStage, type Stage } from "@/domains/opportunities/stages";
import type { RecencyState } from "@/domains/scoring/types";
import { opportunityPath } from "@/lib/quotes/paths";

import { pipelineTargetHref } from "./links";
import { MoveMenu } from "./move-menu";

/*
 * Tarjeta del embudo (propuesta DEC-048): quién, qué busca o qué se negocia
 * y, en una abierta, dos señales sutiles. El color siempre acompaña un
 * texto (DEC-013).
 *
 *   ┌──────────────────────────────────────────────┐
 *   │ (MG) María González                  72   ⇄ │  nombre → workspace · score · Mover
 *   │ Toyota Hilux · 2022 a 2024                   │  unidad vinculada o lo que busca
 *   │ ● Inactiva · 6 d  ▣ Cotización por aprobar +1│  inactividad · pendiente
 *   └──────────────────────────────────────────────┘
 *
 * Una cerrada muestra su cierre ("✓ Ganada · hoy", "✕ Perdida · Precio ·
 * ayer") y no se arrastra ni ofrece pases: es una etapa final.
 */

const RECENCY_DOT: Readonly<Record<RecencyState, string>> = {
  active: "bg-success",
  warning: "bg-warning",
  stale: "bg-danger",
};

const RECENCY_TEXT: Readonly<Record<RecencyState, string>> = {
  active: "text-text-muted",
  warning: "font-semibold text-warning",
  stale: "font-semibold text-danger",
};

const PENDING_ICONS: Readonly<
  Record<PendingActionKind, ComponentType<IconProps>>
> = {
  quote_approval: DocumentIcon,
  test_drive_result: SteeringIcon,
  link_vehicle: BoxIcon,
};

const PENDING_TONES: Readonly<Record<PendingAction["tone"], string>> = {
  brand: "border-brand-border bg-brand-soft text-brand-strong",
  warning: "border-warning-border bg-warning-soft text-warning",
};

/** "hace 2 h" en una activa; "Inactiva · 6 d" cuando enfría. */
function recencyText(recency: CardRecency): string {
  if (recency.state !== "active")
    return `${recency.label} · ${recency.elapsed}`;
  return recency.elapsed === "ahora" ? "ahora" : `hace ${recency.elapsed}`;
}

function RecencyMark({ recency }: { recency: CardRecency }) {
  return (
    <span
      title={recency.description}
      className={cn(
        "inline-flex items-center gap-1.5 text-caption whitespace-nowrap",
        RECENCY_TEXT[recency.state],
      )}
    >
      <span
        aria-hidden="true"
        className={cn(
          "size-1.5 shrink-0 rounded-full",
          RECENCY_DOT[recency.state],
        )}
      />
      <span aria-hidden="true">{recencyText(recency)}</span>
      <span className="sr-only">
        {recency.state === "active"
          ? recency.description
          : `${recency.label}. ${recency.description}`}
      </span>
    </span>
  );
}

function PendingChip({
  action,
  interactive,
}: {
  action: PendingAction;
  interactive: boolean;
}) {
  const Icon = PENDING_ICONS[action.kind];
  const className = cn(
    "inline-flex max-w-full min-w-0 items-center gap-1 rounded-full border px-2 py-0.5 text-caption font-semibold",
    PENDING_TONES[action.tone],
  );
  const content = (
    <>
      <Icon aria-hidden="true" className="size-3.5 shrink-0" />
      <span className="truncate">{action.label}</span>
    </>
  );
  if (!interactive) return <span className={className}>{content}</span>;
  return (
    <Link
      href={pipelineTargetHref(action.target)}
      prefetch={false}
      draggable={false}
      title={action.description}
      className={cn(
        className,
        "transition-[border-color,background-color] hover:border-current focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-focus-ring",
      )}
    >
      {content}
      <span className="sr-only">. {action.description}</span>
    </Link>
  );
}

function ClosureLine({ card }: { card: PipelineCard }) {
  const { closure } = card;
  if (!closure) return null;
  const won = card.stage === "won";
  const Icon = won ? CheckIcon : CloseIcon;
  return (
    <p
      className={cn(
        "flex min-w-0 items-center gap-1.5 text-caption",
        won ? "text-success" : "text-danger",
      )}
    >
      <Icon
        aria-hidden="true"
        className="size-3.5 shrink-0"
        strokeWidth={2.25}
      />
      <span className="font-semibold">{closure.label}</span>
      {closure.reason ? (
        <span className="truncate">· {closure.reason}</span>
      ) : null}
      <span className="shrink-0 text-text-muted">
        ·{" "}
        {closure.at ? (
          <time dateTime={closure.at}>{closure.when}</time>
        ) : (
          closure.when
        )}
      </span>
    </p>
  );
}

type PipelineCardViewProps = Readonly<{
  card: PipelineCard;
  /** Mientras la Server Action guarda el pase. */
  saving?: boolean;
  /** La copia que sigue al puntero mientras se arrastra. */
  overlay?: boolean;
  /** Ofrece "Mover a…" (no en la copia del arrastre). */
  onMove?: (card: PipelineCard, to: Stage) => void;
}>;

/** La tarjeta, sin el arrastre: la usan la columna y la copia flotante. */
export function PipelineCardView({
  card,
  saving = false,
  overlay = false,
  onMove,
}: PipelineCardViewProps) {
  const closed = isTerminalStage(card.stage);
  const nameId = `pipeline-card-${card.id}`;
  const [primary, ...more] = card.pending;
  const interactive = !overlay;

  return (
    <article
      aria-labelledby={nameId}
      aria-busy={saving || undefined}
      className={cn(
        "flex flex-col gap-2 rounded-lg border bg-surface-1 p-3 transition-[border-color,box-shadow,opacity] duration-150 ease-out-strong",
        overlay
          ? "rotate-[0.75deg] border-brand-border shadow-lg motion-reduce:rotate-0"
          : "border-border-subtle shadow-card",
        !closed && interactive && "hover:border-border-default hover:shadow-md",
        saving && "opacity-75",
      )}
    >
      <div className="flex flex-col gap-1">
        <div className="flex min-w-0 items-center gap-2">
          <Avatar
            initials={card.initials}
            size="xs"
            tone={closed ? "neutral" : "brand"}
          />
          <h3
            id={nameId}
            className="min-w-0 flex-1 truncate text-label font-semibold text-text-primary"
          >
            {interactive ? (
              <Link
                href={opportunityPath(card.id)}
                prefetch={false}
                draggable={false}
                className="rounded-xs hover:text-brand hover:underline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-focus-ring"
              >
                {card.name}
              </Link>
            ) : (
              card.name
            )}
          </h3>
          {card.score !== null ? (
            <span
              title="Porandú Score"
              className="shrink-0 rounded-md border border-border-subtle bg-surface-2 px-1.5 py-0.5 text-caption font-semibold text-text-secondary tabular-nums"
            >
              <span className="sr-only">Porandú Score </span>
              {card.score}
            </span>
          ) : null}
          {onMove && interactive ? (
            <MoveMenu card={card} disabled={saving} onMove={onMove} />
          ) : null}
        </div>
        <p
          className="truncate text-caption text-text-secondary"
          title={
            card.detail ? `${card.headline} · ${card.detail}` : card.headline
          }
        >
          {card.headlineSource === "unit" ? (
            <span className="sr-only">Unidad: </span>
          ) : (
            <span className="sr-only">Busca: </span>
          )}
          {card.headline}
          {card.detail ? (
            <span className="text-text-muted"> · {card.detail}</span>
          ) : null}
        </p>
      </div>

      {closed ? (
        <ClosureLine card={card} />
      ) : (
        <div className="flex min-w-0 flex-wrap items-center gap-x-2.5 gap-y-1.5">
          {card.recency ? <RecencyMark recency={card.recency} /> : null}
          {primary ? (
            <PendingChip action={primary} interactive={interactive} />
          ) : null}
          {more.length > 0 ? (
            <span
              title={more.map((action) => action.label).join(" · ")}
              className="text-caption font-semibold text-text-muted tabular-nums"
            >
              +{more.length}
              <span className="sr-only">
                {" "}
                más: {more.map((action) => action.label).join(", ")}
              </span>
            </span>
          ) : null}
          {saving ? (
            <span className="ml-auto inline-flex items-center gap-1.5 text-caption text-text-muted">
              <span
                aria-hidden="true"
                className="size-1.5 rounded-full bg-brand motion-safe:animate-pulse"
              />
              Guardando…
            </span>
          ) : null}
        </div>
      )}
    </article>
  );
}

const DRAG_HINT_TONES = {
  advance: "bg-brand text-brand-contrast",
  won: "bg-success text-brand-contrast",
  lost: "bg-danger text-brand-contrast",
  blocked: "border border-danger-border bg-surface-1 text-danger",
} as const;

/**
 * Pista que acompaña a la tarjeta arrastrada: qué pasa si se suelta en la
 * columna de abajo, o por qué ahí no hay pase. Sigue al puntero, así nunca
 * la tapa la tarjeta. Es visual: el lector de pantalla oye los anuncios del
 * arrastre y, al soltar, el aviso.
 */
export function DragHint({ stage, zone }: { stage: Stage; zone: DropZone }) {
  if (zone.state === "source") return null;
  const tone =
    zone.state === "advance"
      ? DRAG_HINT_TONES.advance
      : zone.state === "blocked"
        ? DRAG_HINT_TONES.blocked
        : stage === "won"
          ? DRAG_HINT_TONES.won
          : DRAG_HINT_TONES.lost;
  const Icon = zone.state === "blocked" ? AlertIcon : ChevronRightIcon;
  return (
    <p
      aria-hidden="true"
      className={cn(
        "inline-flex max-w-full items-start gap-1.5 self-start rounded-lg px-2.5 py-1.5 text-caption font-semibold shadow-md",
        tone,
      )}
    >
      <Icon className="mt-px size-3.5 shrink-0" strokeWidth={2.25} />
      {zone.hint}
    </p>
  );
}

/**
 * La tarjeta arrastrable. Toda la tarjeta es el asa: el mouse arrastra
 * después de moverse unos píxeles (un click en el nombre sigue abriendo la
 * oportunidad) y el dedo, después de mantener presionado (deslizar sigue
 * desplazando el tablero). Una cerrada o una que se está guardando no se
 * arrastra.
 */
export function DraggablePipelineCard({
  card,
  saving,
  onMove,
}: {
  card: PipelineCard;
  saving: boolean;
  onMove: (card: PipelineCard, to: Stage) => void;
}) {
  const disabled = saving || isTerminalStage(card.stage);
  const { setNodeRef, listeners, isDragging } = useDraggable({
    id: card.id,
    disabled,
  });
  return (
    <div
      ref={setNodeRef}
      {...(disabled ? {} : (listeners ?? {}))}
      className={cn(
        "touch-manipulation rounded-lg select-none",
        !disabled && "cursor-grab active:cursor-grabbing",
        isDragging && "opacity-40",
      )}
    >
      <PipelineCardView card={card} saving={saving} onMove={onMove} />
    </div>
  );
}
