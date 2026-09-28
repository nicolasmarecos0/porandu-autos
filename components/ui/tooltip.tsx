"use client";

import * as TooltipPrimitive from "@radix-ui/react-tooltip";
import type { ReactElement, ReactNode } from "react";

type TooltipProviderProps = {
  /** Demora del primer tooltip. Superficies densas usan una mayor. */
  delayDuration?: number;
  children: ReactNode;
};

/** Comparte el delay entre tooltips vecinos (p. ej. los ítems del rail). */
export function TooltipProvider({
  delayDuration = 150,
  children,
}: TooltipProviderProps) {
  return (
    <TooltipPrimitive.Provider
      delayDuration={delayDuration}
      skipDelayDuration={300}
    >
      {children}
    </TooltipPrimitive.Provider>
  );
}

type TooltipProps = {
  content: ReactNode;
  side?: "top" | "right" | "bottom" | "left";
  align?: "start" | "center" | "end";
  /** Elemento que dispara el tooltip (hover y, si es interactivo, foco). */
  children: ReactElement;
};

/**
 * Tooltip accesible (Radix): se abre con hover y con foco de teclado y se
 * cierra con Escape. Complementa, no reemplaza, el nombre accesible del trigger.
 *
 * Motion: el primer tooltip entra en 125 ms desde el trigger
 * (`delayed-open`); los vecinos abren al instante (`instant-open`) y la salida
 * es inmediata.
 */
export function Tooltip({
  content,
  side = "top",
  align,
  children,
}: TooltipProps) {
  return (
    <TooltipPrimitive.Root>
      <TooltipPrimitive.Trigger asChild>{children}</TooltipPrimitive.Trigger>
      <TooltipPrimitive.Portal>
        <TooltipPrimitive.Content
          side={side}
          align={align}
          sideOffset={8}
          collisionPadding={12}
          className="z-50 max-w-72 origin-(--radix-tooltip-content-transform-origin) rounded-md bg-surface-inverse-raised px-2.5 py-1.5 text-label text-text-inverse shadow-md data-[state=delayed-open]:animate-tooltip-in motion-reduce:animate-none"
        >
          {content}
          <TooltipPrimitive.Arrow className="fill-surface-inverse-raised" />
        </TooltipPrimitive.Content>
      </TooltipPrimitive.Portal>
    </TooltipPrimitive.Root>
  );
}
