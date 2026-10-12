import { Button } from "@/components/ui/button";
import { cn } from "@/components/ui/cn";
import {
  CheckIcon,
  ConversationsIcon,
  DocumentIcon,
  LockIcon,
  MapPinIcon,
  PhoneIcon,
  StockIcon,
  SteeringIcon,
  SwapIcon,
  UndoIcon,
  type IconProps,
} from "@/components/ui/icons";
import { Tooltip } from "@/components/ui/tooltip";
import type { NbaKind, NextBestAction } from "@/domains/opportunities/types";
import type { RecencyState } from "@/domains/scoring/types";
import type { ComponentType } from "react";

import { RecencyStatus } from "./recency-status";

const NBA_ICONS: Record<NbaKind, ComponentType<IconProps>> = {
  call: PhoneIcon,
  message: ConversationsIcon,
  testDrive: SteeringIcon,
  offer: DocumentIcon,
  tradeIn: SwapIcon,
  visit: MapPinIcon,
  note: DocumentIcon,
  linkVehicle: StockIcon,
};

type NextBestActionCardProps = {
  nba: NextBestAction;
  /** Estado simulado en cliente (B1 §3.2): no persiste. */
  done: boolean;
  onToggleDone: () => void;
  /**
   * Recencia de la oportunidad (motor de inteligencia, DEC-035), con el
   * tiempo ya formateado. Los fixtures de B1 no la traen.
   */
  recency?: { state: RecencyState; elapsed: string };
};

/** Acento de la tarjeta: rojo si la acción es urgente (riesgo de pérdida). */
const ACCENTS = {
  normal: {
    rule: "bg-brand",
    icon: "bg-brand text-brand-contrast",
    title: "text-brand",
  },
  urgent: {
    rule: "bg-danger",
    icon: "bg-danger text-text-inverse",
    title: "text-danger",
  },
} as const;

/**
 * ¿Qué hacer?: 1 acción primaria con su porqué y las secundarias. Desde
 * Hito 3 la elige el motor de inteligencia (DEC-035): una acción urgente
 * (riesgo de pérdida) se destaca en rojo, y la recencia acompaña el título.
 * Una acción que cambia condiciones económicas no se completa acá: requiere
 * aprobación humana antes de enviarse al cliente.
 */
export function NextBestActionCard({
  nba,
  done,
  onToggleDone,
  recency,
}: NextBestActionCardProps) {
  const Icon = NBA_ICONS[nba.kind];
  const accent = ACCENTS[nba.urgent ? "urgent" : "normal"];
  return (
    <section
      aria-label="¿Qué hacer?"
      className="relative shrink-0 overflow-hidden rounded-lg bg-surface-1 shadow-card"
    >
      <span
        aria-hidden="true"
        className={cn("absolute inset-y-0 left-0 w-1", accent.rule)}
      />
      <div className="flex items-center gap-4 py-3.5 pr-4 pl-5">
        <span
          className={cn(
            "flex size-10 shrink-0 items-center justify-center rounded-md shadow-sm",
            accent.icon,
          )}
        >
          <Icon className="size-5" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <h2 className={cn("text-overline uppercase", accent.title)}>
              ¿Qué hacer?
              {nba.urgent ? <span className="sr-only"> Urgente.</span> : null}
            </h2>
            {recency ? (
              <RecencyStatus state={recency.state} elapsed={recency.elapsed} />
            ) : null}
          </div>
          <p
            className={cn(
              "text-heading",
              done
                ? "text-text-muted line-through decoration-border-strong"
                : "text-text-primary",
            )}
          >
            {nba.action}
          </p>
          <p className="text-label text-text-secondary">{nba.reason}</p>
        </div>
        <div className="flex shrink-0 flex-col items-end">
          {nba.needsApproval ? (
            <Tooltip content="Cambia condiciones económicas: se aprueba antes de enviarse al cliente.">
              <span className="inline-flex items-center gap-1.5 rounded-full border border-warning-border bg-warning-soft px-2.5 py-1 text-caption font-semibold text-warning">
                <LockIcon className="size-3" />
                Requiere aprobación
              </span>
            </Tooltip>
          ) : (
            <Button onClick={onToggleDone} aria-pressed={done}>
              {done ? (
                <>
                  <UndoIcon className="size-3.5" />
                  Hecha · deshacer
                </>
              ) : (
                <>
                  <CheckIcon className="size-3.5" />
                  Marcar como hecha
                </>
              )}
            </Button>
          )}
        </div>
      </div>
      {nba.secondary.length > 0 ? (
        <p className="border-t border-border-subtle bg-surface-2 py-2 pr-4 pl-5 text-caption text-text-secondary">
          <span className="font-semibold text-text-muted">Después</span> ·{" "}
          {nba.secondary.join(" · ")}
        </p>
      ) : null}
    </section>
  );
}
