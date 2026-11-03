"use client";

import type { SyntheticEvent } from "react";

import { cn } from "@/components/ui/cn";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { SwapIcon } from "@/components/ui/icons";
import type { PipelineCard } from "@/domains/opportunities/pipeline";
import { moveTargets } from "@/domains/opportunities/pipeline-moves";
import type { Stage } from "@/domains/opportunities/stages";

/*
 * "Mover a…" de una tarjeta del embudo (propuesta DEC-048): la alternativa
 * al arrastre para el teclado, los lectores de pantalla y el teléfono, donde
 * un toque es más confiable que mantener presionado y arrastrar. Ofrece
 * exactamente los pases de la máquina de DEC-032 desde la etapa de la
 * tarjeta; un cierre lleva "…" porque abre la confirmación con sus datos.
 *
 * Menú de Radix no modal (como las acciones de un miembro, DEC-038 §8), así
 * la confirmación del cierre que abre recibe el foco sin pelear con él. El
 * botón no deja que su presión inicie un arrastre de la tarjeta.
 */

/** Evita que tocar el botón inicie el arrastre de la tarjeta. */
function keepFromDragging(event: SyntheticEvent) {
  event.stopPropagation();
}

export function MoveMenu({
  card,
  disabled = false,
  onMove,
}: {
  card: PipelineCard;
  disabled?: boolean;
  onMove: (card: PipelineCard, to: Stage) => void;
}) {
  const targets = moveTargets(card.stage);
  if (targets.length === 0) return null;
  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          disabled={disabled}
          aria-label={`Cambiar la etapa de ${card.name}`}
          title="Cambiar etapa"
          onMouseDown={keepFromDragging}
          onTouchStart={keepFromDragging}
          className={cn(
            "-my-1 -mr-1.5 flex size-8 shrink-0 cursor-pointer items-center justify-center rounded-md text-text-muted transition-colors hover:bg-surface-2 hover:text-text-primary focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-focus-ring disabled:cursor-wait disabled:opacity-50 data-[state=open]:bg-surface-2 data-[state=open]:text-text-primary",
          )}
        >
          <SwapIcon aria-hidden="true" className="size-4" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent>
        <DropdownMenuLabel>Mover a</DropdownMenuLabel>
        {targets.map((target) => (
          <DropdownMenuItem
            key={target.to}
            tone={target.to === "lost" ? "danger" : "neutral"}
            onSelect={() => onMove(card, target.to)}
          >
            {target.closes ? `${target.label}…` : target.label}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
