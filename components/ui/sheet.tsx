"use client";

import * as DialogPrimitive from "@radix-ui/react-dialog";
import type { ComponentProps, ReactNode } from "react";

import { cn } from "./cn";
import { CloseIcon } from "./icons";

/*
 * Hoja de detalle: un diálogo modal de Radix con dos formas según el ancho.
 *
 * - Teléfono y tablet chica: hoja inferior que sube desde abajo, con hasta
 *   el 92 % del alto y el pie respetando el área segura del dispositivo.
 * - Desde md: panel lateral derecho de 30rem, como el Drawer.
 *
 * Atrapa el foco, se cierra con Escape, con el velo o con el botón, devuelve
 * el foco a donde estaba y anuncia título y descripción (SheetTitle y
 * SheetDescription van dentro del contenido). El cuerpo tiene scroll propio
 * y el pie (acciones) queda fijo.
 *
 * Motion: entra en 240 ms (ease-out fuerte) y sale sin animación. Con
 * reduced motion no anima.
 */

export const Sheet = DialogPrimitive.Root;
export const SheetTitle = DialogPrimitive.Title;
export const SheetDescription = DialogPrimitive.Description;
export const SheetClose = DialogPrimitive.Close;

type SheetContentProps = Pick<
  ComponentProps<typeof DialogPrimitive.Content>,
  "onOpenAutoFocus" | "onCloseAutoFocus"
> & {
  /** Etiqueta accesible de la hoja, si el título no alcanza. */
  "aria-label"?: string;
  /** Pie fijo: las acciones de la hoja. */
  footer?: ReactNode;
  children: ReactNode;
};

export function SheetContent({
  footer,
  children,
  ...props
}: SheetContentProps) {
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay className="fixed inset-0 z-40 bg-overlay data-[state=open]:animate-overlay-in motion-reduce:animate-none" />
      <DialogPrimitive.Content
        className={cn(
          "fixed right-0 bottom-0 left-0 z-40 flex max-h-[92dvh] flex-col rounded-t-xl border-t border-border-subtle bg-surface-1 shadow-lg focus:outline-none data-[state=open]:animate-sheet-in motion-reduce:animate-none",
          "md:top-0 md:left-auto md:max-h-none md:w-full md:max-w-120 md:rounded-none md:border-t-0 md:border-l md:data-[state=open]:animate-drawer-in",
        )}
        {...props}
      >
        <span
          aria-hidden="true"
          className="mx-auto mt-2 h-1 w-10 shrink-0 rounded-full bg-border-strong md:hidden"
        />
        <DialogPrimitive.Close
          aria-label="Cerrar"
          className="absolute top-4 right-4 z-10 flex size-9 items-center justify-center rounded-full bg-surface-1 text-text-muted shadow-sm ring-1 ring-border-subtle transition-colors hover:text-text-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring md:top-3 md:right-3"
        >
          <CloseIcon className="size-4.5" />
        </DialogPrimitive.Close>
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
          {children}
        </div>
        {footer ? (
          <div className="shrink-0 border-t border-border-subtle bg-surface-2 px-5 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
            {footer}
          </div>
        ) : null}
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  );
}
