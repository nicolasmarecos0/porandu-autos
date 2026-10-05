"use client";

import * as AlertDialogPrimitive from "@radix-ui/react-alert-dialog";
import type { ComponentProps, ReactNode } from "react";

/*
 * Confirmación de una acción con consecuencias (patrón WAI-ARIA
 * alertdialog, primitiva de Radix). Es modal: atrapa el foco, anuncia
 * título y descripción y devuelve el foco al trigger. A diferencia del
 * drawer, no se cierra con un click en el velo y abre con el foco en
 * "Cancelar", la opción que no cambia nada. Escape la cierra, salvo que el
 * contenido lo impida (p. ej. mientras se guarda).
 *
 * Motion: aparece en 160 ms (escala 0.97 → 1 y opacidad, ease-out) y sale
 * sin animación. Con reduced motion no anima.
 */

export const ConfirmDialog = AlertDialogPrimitive.Root;
export const ConfirmDialogTrigger = AlertDialogPrimitive.Trigger;
export const ConfirmDialogCancel = AlertDialogPrimitive.Cancel;

type ConfirmDialogContentProps = Pick<
  ComponentProps<typeof AlertDialogPrimitive.Content>,
  "onEscapeKeyDown" | "onCloseAutoFocus"
> & {
  title: string;
  description: string;
  children: ReactNode;
};

export function ConfirmDialogContent({
  title,
  description,
  children,
  ...props
}: ConfirmDialogContentProps) {
  return (
    <AlertDialogPrimitive.Portal>
      <AlertDialogPrimitive.Overlay className="fixed inset-0 z-40 bg-overlay data-[state=open]:animate-overlay-in motion-reduce:animate-none" />
      <AlertDialogPrimitive.Content
        className="fixed top-1/2 left-1/2 z-40 flex w-[calc(100%-2rem)] max-w-md -translate-x-1/2 -translate-y-1/2 flex-col rounded-lg border border-border-subtle bg-surface-1 shadow-lg focus:outline-none data-[state=open]:animate-dialog-in motion-reduce:animate-none"
        {...props}
      >
        <header className="px-5 pt-4.5 pb-3">
          <AlertDialogPrimitive.Title className="text-title text-text-primary">
            {title}
          </AlertDialogPrimitive.Title>
          <AlertDialogPrimitive.Description className="mt-1 text-body text-text-secondary">
            {description}
          </AlertDialogPrimitive.Description>
        </header>
        {children}
      </AlertDialogPrimitive.Content>
    </AlertDialogPrimitive.Portal>
  );
}
