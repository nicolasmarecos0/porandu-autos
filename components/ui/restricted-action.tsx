"use client";

import { cn } from "./cn";
import { LockIcon } from "./icons";
import { Tooltip, TooltipProvider } from "./tooltip";

/*
 * Una acción que el rol de la membership activa no puede hacer (Hito 22,
 * DEC-054 §6): se ve dónde estaría, con un candado, y un tooltip dice quién
 * la hace. No es un `disabled` nativo, que no recibe foco ni hover (el
 * tooltip no se abriría): es un botón `aria-disabled` que no hace nada, con
 * el motivo también como texto para lectores de pantalla. No es una
 * barrera: la Server Action responde UNAUTHORIZED_ROLE y la base lo
 * rechaza igual.
 */
export function RestrictedAction({
  label,
  reason,
  className,
}: {
  label: string;
  /** Por qué no está disponible (CAPABILITY_REQUIREMENTS). */
  reason: string;
  className?: string;
}) {
  return (
    <TooltipProvider>
      <Tooltip content={reason}>
        <button
          type="button"
          aria-disabled="true"
          onClick={(event) => event.preventDefault()}
          className={cn(
            "inline-flex h-8 shrink-0 cursor-not-allowed items-center justify-center gap-1.5 rounded-md border border-dashed border-border-default bg-surface-2 px-3 text-label font-semibold text-text-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring",
            className,
          )}
        >
          <LockIcon aria-hidden="true" className="size-3.5 shrink-0" />
          {label}
          <span className="sr-only">. {reason}</span>
        </button>
      </Tooltip>
    </TooltipProvider>
  );
}
