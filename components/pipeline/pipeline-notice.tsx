"use client";

import type { Ref } from "react";

import { cn } from "@/components/ui/cn";
import { AlertIcon, CheckIcon, CloseIcon } from "@/components/ui/icons";

import type { PipelineNoticeContent } from "./notices";

/*
 * Aviso del embudo (propuesta DEC-048): qué pasó con el último pase, abajo
 * al centro, sin tapar el tablero. Es una región viva que existe siempre
 * (vacía sin aviso), así el lector de pantalla anuncia cada texto nuevo; el
 * tablero lo limpia a los pocos segundos. Recibe el foco cuando el elemento
 * que lo tenía desaparece (p. ej. la tarjeta que se movió de columna).
 */

export type PipelineNoticeState = PipelineNoticeContent &
  Readonly<{ id: number }>;

export function PipelineNotice({
  notice,
  onDismiss,
  ref,
}: {
  notice: PipelineNoticeState | null;
  onDismiss: () => void;
  ref?: Ref<HTMLDivElement>;
}) {
  const error = notice?.tone === "error";
  return (
    <div
      ref={ref}
      role="status"
      tabIndex={-1}
      className="pointer-events-none fixed inset-x-4 bottom-4 z-30 flex justify-center focus:outline-none"
    >
      {notice ? (
        <p
          key={notice.id}
          className={cn(
            "pointer-events-auto flex max-w-md items-start gap-2 rounded-lg border py-2 pr-1.5 pl-3 text-label shadow-lg motion-safe:animate-dialog-in",
            error
              ? "border-danger-border bg-danger-soft text-danger"
              : "border-transparent bg-surface-inverse text-text-inverse",
          )}
        >
          {error ? (
            <AlertIcon aria-hidden="true" className="mt-px size-4 shrink-0" />
          ) : (
            <CheckIcon
              aria-hidden="true"
              className="mt-px size-4 shrink-0 text-brand-inverse"
              strokeWidth={2.25}
            />
          )}
          <span className="min-w-0 flex-1 pt-px">{notice.text}</span>
          <button
            type="button"
            aria-label="Cerrar aviso"
            onClick={onDismiss}
            className={cn(
              "flex size-6 shrink-0 items-center justify-center rounded-sm focus-visible:outline-2 focus-visible:outline-offset-1",
              error
                ? "hover:bg-danger-border/40 focus-visible:outline-focus-ring"
                : "hover:bg-surface-inverse-hover focus-visible:outline-focus-ring-inverse",
            )}
          >
            <CloseIcon className="size-3.5" />
          </button>
        </p>
      ) : null}
    </div>
  );
}
