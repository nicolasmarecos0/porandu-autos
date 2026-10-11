"use client";

import { useActionState, useId, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/components/ui/cn";
import {
  NOTE_FIELDS,
  NOTE_MAX_LENGTH,
  noteLength,
  type NoteBodyError,
} from "@/domains/opportunities/notes";
import { addOpportunityNote } from "@/lib/opportunities/actions";
import type { AddNoteState } from "@/lib/opportunities/note";

/*
 * Formulario de una nota de la bitácora (Hito 2, DEC-033 §1). No conoce la
 * base: envía a la Server Action addOpportunityNote() la oportunidad y el
 * texto. El servidor lo normaliza y lo valida de nuevo; el contador y el
 * largo máximo de acá solo ayudan a escribir.
 *
 * Al guardar, el texto se vacía y la página se revalida: la nota aparece
 * arriba de la bitácora, leída del servidor. Un texto inválido o una falla
 * inesperada dejan lo tipeado para corregirlo o reintentar.
 */

const textareaClassName =
  "min-h-24 w-full resize-y rounded-md border border-border-default bg-surface-1 px-3 py-2 text-body text-text-primary transition-[border-color] hover:border-border-strong focus-visible:border-brand focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-focus-ring aria-invalid:border-danger disabled:cursor-not-allowed disabled:bg-surface-2";

const ERRORS: Readonly<Record<NoteBodyError, string>> = {
  empty: "Escribí la nota antes de guardarla.",
  too_long: `La nota puede tener hasta ${NOTE_MAX_LENGTH} caracteres.`,
};

/** Aviso tras un pedido, o null si no hay nada que avisar. */
function noticeOf(
  state: AddNoteState,
): { text: string; tone: "info" | "error" } | null {
  switch (state?.status) {
    case undefined:
    case "invalid":
      return null;
    case "recorded":
      return { text: "Nota agregada a la bitácora.", tone: "info" };
    case "not_found":
      return { text: "No encontramos la oportunidad.", tone: "error" };
    case "failed":
      return {
        text: "No pudimos guardar la nota. No se guardó nada: intentá de nuevo en unos minutos.",
        tone: "error",
      };
  }
}

export function NoteForm({ opportunityId }: { opportunityId: string }) {
  const id = useId();
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [body, setBody] = useState("");
  const [state, action, pending] = useActionState<AddNoteState, FormData>(
    async (previous, formData) => {
      const result = await addOpportunityNote(previous, formData);
      if (result?.status === "recorded") setBody("");
      else textareaRef.current?.focus();
      return result;
    },
    null,
  );

  const length = noteLength(body);
  const tooLong = length > NOTE_MAX_LENGTH;
  const error =
    !pending && state?.status === "invalid" ? ERRORS[state.error] : null;
  const notice = pending ? null : noticeOf(state);
  const errorId = `${id}-error`;
  const countId = `${id}-count`;

  return (
    <form action={action} noValidate aria-busy={pending}>
      <input
        type="hidden"
        name={NOTE_FIELDS.opportunityId}
        value={opportunityId}
      />
      <div className="flex flex-col gap-1.5">
        <label
          htmlFor={`${id}-body`}
          className="text-label text-text-secondary"
        >
          Nueva nota
        </label>
        <textarea
          ref={textareaRef}
          id={`${id}-body`}
          name={NOTE_FIELDS.body}
          rows={3}
          value={body}
          onChange={(event) => setBody(event.currentTarget.value)}
          disabled={pending}
          placeholder="Qué se habló, qué pidió el cliente, próximos pasos…"
          aria-invalid={error || tooLong ? true : undefined}
          aria-describedby={cn(countId, error ? errorId : null) || undefined}
          className={textareaClassName}
        />
        <div className="flex items-start justify-between gap-3">
          <p
            id={errorId}
            className={cn("text-caption text-danger", !error && "sr-only")}
          >
            {error}
          </p>
          <p
            id={countId}
            className={cn(
              "shrink-0 text-caption tabular-nums",
              tooLong ? "text-danger" : "text-text-muted",
            )}
          >
            {length.toLocaleString("es-PY")} /{" "}
            {NOTE_MAX_LENGTH.toLocaleString("es-PY")}
          </p>
        </div>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-3">
        <Button
          type="submit"
          variant="primary"
          disabled={pending}
          className="disabled:cursor-wait disabled:opacity-70"
        >
          {pending ? "Guardando…" : "Agregar nota"}
        </Button>
        <p
          role="status"
          className={cn(
            "text-caption",
            notice
              ? notice.tone === "error"
                ? "text-danger"
                : "text-success"
              : "sr-only",
          )}
        >
          {notice?.text}
        </p>
      </div>
    </form>
  );
}
