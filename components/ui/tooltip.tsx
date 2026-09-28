"use client";

import * as TooltipPrimitive from "@radix-ui/react-tooltip";
import type { ReactElement, ReactNode } from "react";

/** Comparte el delay entre tooltips vecinos (p. ej. los ítems del rail). */
export function TooltipProvider({ children }: { children: ReactNode }) {
  return (
    <TooltipPrimitive.Provider delayDuration={150} skipDelayDuration={300}>
      {children}
    </TooltipPrimitive.Provider>
  );
}

type TooltipProps = {
  content: ReactNode;
  side?: "top" | "right" | "bottom" | "left";
  /** Elemento interactivo que dispara el tooltip (hover y foco). */
  children: ReactElement;
};

/**
 * Tooltip accesible (Radix): se abre con hover y con foco de teclado y se
 * cierra con Escape. Complementa, no reemplaza, el nombre accesible del trigger.
 */
export function Tooltip({ content, side = "top", children }: TooltipProps) {
  return (
    <TooltipPrimitive.Root>
      <TooltipPrimitive.Trigger asChild>{children}</TooltipPrimitive.Trigger>
      <TooltipPrimitive.Portal>
        <TooltipPrimitive.Content
          side={side}
          sideOffset={8}
          className="z-50 rounded-sm bg-surface-inverse-raised px-2 py-1 text-label text-text-inverse shadow-md"
        >
          {content}
          <TooltipPrimitive.Arrow className="fill-surface-inverse-raised" />
        </TooltipPrimitive.Content>
      </TooltipPrimitive.Portal>
    </TooltipPrimitive.Root>
  );
}
