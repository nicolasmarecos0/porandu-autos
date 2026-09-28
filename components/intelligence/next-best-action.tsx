import { Button } from "@/components/ui/button";
import { cn } from "@/components/ui/cn";
import {
  CheckIcon,
  ConversationsIcon,
  DocumentIcon,
  LockIcon,
  MapPinIcon,
  PhoneIcon,
  SteeringIcon,
  SwapIcon,
  UndoIcon,
  type IconProps,
} from "@/components/ui/icons";
import { Tooltip } from "@/components/ui/tooltip";
import type { NbaKind, NextBestAction } from "@/domains/opportunities/types";
import type { ComponentType } from "react";

const NBA_ICONS: Record<NbaKind, ComponentType<IconProps>> = {
  call: PhoneIcon,
  message: ConversationsIcon,
  testDrive: SteeringIcon,
  offer: DocumentIcon,
  tradeIn: SwapIcon,
  visit: MapPinIcon,
};

type NextBestActionCardProps = {
  nba: NextBestAction;
  /** Estado simulado en cliente (B1 §3.2): no persiste. */
  done: boolean;
  onToggleDone: () => void;
};

/**
 * ¿Qué hacer?: 1 acción primaria con su porqué y las secundarias. Una acción
 * que cambia condiciones económicas no se completa acá: requiere aprobación
 * humana antes de enviarse al cliente.
 */
export function NextBestActionCard({
  nba,
  done,
  onToggleDone,
}: NextBestActionCardProps) {
  const Icon = NBA_ICONS[nba.kind];
  return (
    <section
      aria-label="¿Qué hacer?"
      className="relative shrink-0 overflow-hidden rounded-lg bg-surface-1 shadow-card"
    >
      <span
        aria-hidden="true"
        className="absolute inset-y-0 left-0 w-1 bg-brand"
      />
      <div className="flex items-center gap-4 py-3.5 pr-4 pl-5">
        <span className="flex size-10 shrink-0 items-center justify-center rounded-md bg-brand text-brand-contrast shadow-sm">
          <Icon className="size-5" />
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="text-overline text-brand uppercase">¿Qué hacer?</h2>
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
      <p className="border-t border-border-subtle bg-surface-2 py-2 pr-4 pl-5 text-caption text-text-secondary">
        <span className="font-semibold text-text-muted">Después</span> ·{" "}
        {nba.secondary.join(" · ")}
      </p>
    </section>
  );
}
