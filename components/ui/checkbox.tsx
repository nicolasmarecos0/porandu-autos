"use client";

import * as CheckboxPrimitive from "@radix-ui/react-checkbox";
import type { ComponentProps } from "react";

import { cn } from "./cn";
import { CheckIcon } from "./icons";

/*
 * Casilla de verificación (patrón WAI-ARIA checkbox, primitiva de Radix):
 * `role="checkbox"` con `aria-checked`, Espacio la cambia y la etiqueta la
 * pone quien la usa (un `<label htmlFor>` o `aria-labelledby`). Se usa en el
 * checklist físico de la entrega (Hito 21, DEC-053).
 *
 * 20 × 20 px dentro de su fila (el área táctil la da la fila entera, ≥ 44
 * px en el teléfono). Marcada: relleno de marca y check; el check entra en
 * 120 ms (escala y opacidad, ease-out) y sale sin animación. Con reduced
 * motion no anima. El color nunca es la única señal: el check se ve.
 */
export function Checkbox({
  className,
  ...props
}: ComponentProps<typeof CheckboxPrimitive.Root>) {
  return (
    <CheckboxPrimitive.Root
      className={cn(
        "peer inline-flex size-5 shrink-0 items-center justify-center rounded-sm border border-border-strong bg-surface-1 text-brand-contrast transition-[background-color,border-color] duration-150 ease-out-strong hover:border-brand focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring disabled:cursor-not-allowed disabled:opacity-60 data-[state=checked]:border-brand data-[state=checked]:bg-brand motion-reduce:transition-none",
        className,
      )}
      {...props}
    >
      <CheckboxPrimitive.Indicator className="flex items-center justify-center data-[state=checked]:animate-checkbox-in motion-reduce:animate-none">
        <CheckIcon className="size-3.5" strokeWidth={2.5} />
      </CheckboxPrimitive.Indicator>
    </CheckboxPrimitive.Root>
  );
}
