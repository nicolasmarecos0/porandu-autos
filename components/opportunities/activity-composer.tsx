"use client";

import { useState } from "react";
import { MessageForm } from "@/components/conversations/message-form";
import { cn } from "@/components/ui/cn";

import { NoteForm } from "./note-form";

/*
 * Qué se registra en el muro de actividad (Hito 4, DEC-036 §11): una nota de
 * la bitácora (DEC-033) o un mensaje de la conversación. Un selector de dos
 * botones (aria-pressed, como los filtros de la cola) elige el formulario;
 * cada uno envía a su propia Server Action.
 */

type Kind = "note" | "message";

const KINDS: readonly { id: Kind; label: string }[] = [
  { id: "note", label: "Nota" },
  { id: "message", label: "Mensaje" },
];

export function ActivityComposer({ opportunityId }: { opportunityId: string }) {
  const [kind, setKind] = useState<Kind>("note");
  return (
    <div className="flex flex-col gap-3">
      <div
        role="group"
        aria-label="Qué registrás"
        className="grid w-full max-w-xs grid-cols-2 gap-0.5 rounded-md bg-surface-3 p-0.5"
      >
        {KINDS.map((item) => {
          const active = kind === item.id;
          return (
            <button
              key={item.id}
              type="button"
              aria-pressed={active}
              onClick={() => setKind(item.id)}
              className={cn(
                "flex h-7 items-center justify-center rounded-sm text-label transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring",
                active
                  ? "bg-surface-1 font-semibold text-text-primary shadow-sm"
                  : "text-text-secondary hover:text-text-primary",
              )}
            >
              {item.label}
            </button>
          );
        })}
      </div>
      {kind === "note" ? (
        <NoteForm opportunityId={opportunityId} />
      ) : (
        <MessageForm opportunityId={opportunityId} />
      )}
    </div>
  );
}
