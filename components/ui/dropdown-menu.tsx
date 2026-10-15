"use client";

import * as DropdownMenuPrimitive from "@radix-ui/react-dropdown-menu";
import type { ComponentProps, ReactNode } from "react";
import { cn } from "./cn";

/*
 * Menú de acciones (patrón WAI-ARIA menu button, primitiva de Radix):
 * abre con click, Enter, Espacio o flecha abajo, se recorre con flechas y
 * typeahead, se cierra con Escape y devuelve el foco al trigger.
 *
 * Motion: aparece en 160 ms (escala 0.97 → 1 y opacidad, ease-out, desde el
 * borde del trigger) y sale sin animación. Con reduced motion no anima.
 */

export const DropdownMenu = DropdownMenuPrimitive.Root;
export const DropdownMenuTrigger = DropdownMenuPrimitive.Trigger;

export function DropdownMenuContent({
  children,
  className,
  align = "end",
}: {
  children: ReactNode;
  className?: string;
  align?: ComponentProps<typeof DropdownMenuPrimitive.Content>["align"];
}) {
  return (
    <DropdownMenuPrimitive.Portal>
      <DropdownMenuPrimitive.Content
        align={align}
        sideOffset={4}
        className={cn(
          "z-30 min-w-48 origin-(--radix-dropdown-menu-content-transform-origin) rounded-md border border-border-subtle bg-surface-1 p-1 shadow-md data-[state=open]:animate-dialog-in motion-reduce:animate-none",
          className,
        )}
      >
        {children}
      </DropdownMenuPrimitive.Content>
    </DropdownMenuPrimitive.Portal>
  );
}

const itemTones = {
  neutral: "text-text-primary data-highlighted:bg-surface-2",
  danger: "text-danger data-highlighted:bg-danger-soft",
} as const;

export function DropdownMenuItem({
  tone = "neutral",
  onSelect,
  children,
}: {
  tone?: keyof typeof itemTones;
  onSelect: () => void;
  children: ReactNode;
}) {
  return (
    <DropdownMenuPrimitive.Item
      onSelect={onSelect}
      className={cn(
        "flex h-8 cursor-default items-center gap-2 rounded-sm px-2.5 text-label font-semibold outline-none select-none data-disabled:opacity-50",
        itemTones[tone],
      )}
    >
      {children}
    </DropdownMenuPrimitive.Item>
  );
}

export function DropdownMenuLabel({ children }: { children: ReactNode }) {
  return (
    <DropdownMenuPrimitive.Label className="truncate px-2.5 pt-1.5 pb-1 text-caption text-text-muted">
      {children}
    </DropdownMenuPrimitive.Label>
  );
}

export function DropdownMenuSeparator() {
  return (
    <DropdownMenuPrimitive.Separator className="my-1 h-px bg-border-subtle" />
  );
}
