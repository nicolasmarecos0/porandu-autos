import Link from "next/link";
import type { ComponentType } from "react";
import { TestDriveStatusChip } from "@/components/calendar/test-drive-status";
import { QuoteStatusChip } from "@/components/quotes/quote-status";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/components/ui/cn";
import {
  AlertIcon,
  ChevronRightIcon,
  ConversationsIcon,
  DocumentIcon,
  NoteIcon,
  SteeringIcon,
  type IconProps,
} from "@/components/ui/icons";
import {
  TEST_DRIVE_PHASE_LABELS,
  type CockpitEvent,
  type CockpitEventKind,
} from "@/domains/cockpit/feed";

import { cockpitTargetHref } from "./links";

/*
 * Un evento de la línea de tiempo (Hito 15, DEC-047 §5):
 *
 *   (◉) 14:32  Ramón Benítez  [chip]                       Responder ›
 *    │         3 mensajes sin leer
 *    │         ¿Tienen la Hilux en blanco?
 *
 * - El nodo sobre el hilo dice el tipo con su ícono (mensaje, prueba,
 *   cotización, nota) y su tono; el tipo también se anuncia en texto para
 *   lectores de pantalla.
 * - Una sola acción rápida, y es un enlace: el Cockpit no cambia nada. Cada
 *   cambio de estado sigue en su módulo, con su confirmación.
 * - `prefetch={false}`: el feed puede tener 40 enlaces a páginas dinámicas;
 *   un prefetch por cada uno serían 40 lecturas tenant-scoped que nadie
 *   pidió (como los enlaces de rango del Dashboard, DEC-043 §6).
 * - Debajo de `sm` la acción baja debajo del texto, alineada con él.
 */

type NodeTone = "brand" | "neutral" | "success" | "warning";

const NODE: Readonly<Record<NodeTone, string>> = {
  brand: "border-brand-border bg-brand-soft text-brand-strong",
  neutral: "border-border-default bg-surface-2 text-text-secondary",
  success: "border-success-border bg-success-soft text-success",
  warning: "border-warning-border bg-warning-soft text-warning",
};

const ICON: Readonly<Record<CockpitEventKind, ComponentType<IconProps>>> = {
  message: ConversationsIcon,
  test_drive: SteeringIcon,
  quote: DocumentIcon,
  note: NoteIcon,
};

/** El tipo, en texto, para lectores de pantalla. */
const KIND_LABEL: Readonly<Record<CockpitEventKind, string>> = {
  message: "WhatsApp",
  test_drive: "Agenda",
  quote: "Cotización",
  note: "Bitácora",
};

function nodeTone(event: CockpitEvent): NodeTone {
  switch (event.kind) {
    case "message":
      return "brand";
    case "test_drive":
      if (event.phase === "overdue") return "warning";
      return event.phase === "in_progress" ? "brand" : "neutral";
    case "quote":
      if (event.status === "expired") return "warning";
      return event.status === "accepted" ? "success" : "neutral";
    case "note":
      return "neutral";
  }
}

function StatusChip({ event }: { event: CockpitEvent }) {
  switch (event.kind) {
    case "test_drive":
      if (event.phase === "overdue") {
        return (
          <Badge tone="warning">
            <AlertIcon className="size-3" strokeWidth={2.25} />
            {TEST_DRIVE_PHASE_LABELS.overdue}
          </Badge>
        );
      }
      if (event.phase === "in_progress") {
        return (
          <Badge tone="brand">
            <span
              aria-hidden="true"
              className="size-1.5 rounded-full bg-brand"
            />
            {TEST_DRIVE_PHASE_LABELS.in_progress}
          </Badge>
        );
      }
      return <TestDriveStatusChip status={event.status} />;
    case "quote":
      return <QuoteStatusChip status={event.status} />;
    case "message":
    case "note":
      return null;
  }
}

const ACTION_CLASS_NAME =
  "-ml-2.5 inline-flex h-8 shrink-0 items-center gap-0.5 self-start rounded-md px-2.5 text-label font-semibold whitespace-nowrap text-brand transition-[transform,background-color,color] duration-150 ease-out-strong hover:bg-brand-soft hover:text-brand-strong focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring active:scale-[0.97] motion-reduce:active:scale-100 sm:ml-0";

export function TimelineItem({ event }: { event: CockpitEvent }) {
  const Icon = ICON[event.kind];
  return (
    <li className="group relative flex gap-3 py-2.5">
      {/* El tramo del hilo hasta el nodo siguiente, con aire arriba y abajo;
          el último del día no lo lleva. Pasa por el centro del nodo
          (size-8 → left-4). */}
      <span
        aria-hidden="true"
        className="absolute top-12 -bottom-1 left-4 w-px -translate-x-1/2 bg-border-default group-last:hidden"
      />
      <span
        aria-hidden="true"
        className={cn(
          "relative flex size-8 shrink-0 items-center justify-center rounded-full border",
          NODE[nodeTone(event)],
        )}
      >
        <Icon className="size-4" />
      </span>
      <div className="flex min-w-0 flex-1 flex-col gap-1 sm:flex-row sm:items-start sm:gap-4">
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
            <time
              dateTime={event.at.toISOString()}
              title={event.timeTitle}
              className="shrink-0 text-label text-text-muted tabular-nums"
            >
              {event.timeLabel}
            </time>
            <p className="min-w-0 truncate text-body font-semibold text-text-primary">
              <span className="sr-only">{KIND_LABEL[event.kind]}: </span>
              {event.title}
            </p>
            <StatusChip event={event} />
          </div>
          <p className="text-body text-text-secondary">{event.headline}</p>
          {event.detail ? (
            <p className="truncate text-label text-text-muted">
              {event.detail}
            </p>
          ) : null}
        </div>
        <Link
          href={cockpitTargetHref(event.action.target)}
          prefetch={false}
          className={ACTION_CLASS_NAME}
        >
          {event.action.label}
          <span className="sr-only">: {event.title}</span>
          <ChevronRightIcon aria-hidden="true" className="size-4" />
        </Link>
      </div>
    </li>
  );
}
