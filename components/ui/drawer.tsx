"use client";

import * as DialogPrimitive from "@radix-ui/react-dialog";
import type { ComponentProps, ReactNode } from "react";
import { CloseIcon } from "./icons";

/*
 * Drawer lateral derecho (Master Context §33: "drawers laterales"). Es un
 * diálogo modal de Radix: atrapa el foco, se cierra con Escape o con el
 * velo, devuelve el foco al trigger y anuncia título y descripción. El
 * contenido se desmonta al cerrar, así que cada apertura empieza limpia.
 *
 * Motion: entra desde la derecha en 220 ms (ease-out) y sale sin animación.
 * Con reduced motion no anima.
 */

export const Drawer = DialogPrimitive.Root;
export const DrawerTrigger = DialogPrimitive.Trigger;
export const DrawerClose = DialogPrimitive.Close;

type DrawerContentProps = Pick<
  ComponentProps<typeof DialogPrimitive.Content>,
  "onOpenAutoFocus" | "onEscapeKeyDown" | "onInteractOutside"
> & {
  title: string;
  description: string;
  /** Deshabilita el botón de cerrar (p. ej. mientras se guarda). */
  closeDisabled?: boolean;
  children: ReactNode;
};

export function DrawerContent({
  title,
  description,
  closeDisabled = false,
  children,
  ...props
}: DrawerContentProps) {
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay className="fixed inset-0 z-40 bg-overlay data-[state=open]:animate-overlay-in motion-reduce:animate-none" />
      <DialogPrimitive.Content
        className="fixed inset-y-0 right-0 z-40 flex w-full max-w-104 flex-col border-l border-border-subtle bg-surface-1 shadow-lg focus:outline-none data-[state=open]:animate-drawer-in motion-reduce:animate-none"
        {...props}
      >
        <header className="flex shrink-0 items-start gap-3 border-b-2 border-brand px-5 pt-4 pb-3.5">
          <div className="min-w-0 flex-1">
            <DialogPrimitive.Title className="text-title text-text-primary">
              {title}
            </DialogPrimitive.Title>
            <DialogPrimitive.Description className="mt-0.5 text-label text-text-muted">
              {description}
            </DialogPrimitive.Description>
          </div>
          <DialogPrimitive.Close
            disabled={closeDisabled}
            aria-label="Cerrar"
            className="-mr-1.5 flex size-8 shrink-0 items-center justify-center rounded-md text-text-muted transition-colors hover:bg-surface-2 hover:text-text-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring disabled:cursor-not-allowed disabled:opacity-50"
          >
            <CloseIcon className="size-4.5" />
          </DialogPrimitive.Close>
        </header>
        {children}
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  );
}
