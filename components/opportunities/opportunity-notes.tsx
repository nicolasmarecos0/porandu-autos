import { Panel, PanelHeader } from "@/components/ui/panel";
import type { NoteEntry } from "@/domains/opportunities/notes";

import { NoteForm } from "./note-form";

/*
 * Bitácora comercial en /opportunities/[id] (Hito 2, DEC-033 §1): qué pasó
 * en la negociación, de la nota más reciente a la más vieja.
 *
 *   ┌ Notas ─────────────────────────────────────────── 2 notas ┐
 *   │ Nueva nota  [                                    ] 0/1000 │
 *   │ [Agregar nota]                                            │
 *   │ │ Vos · 11 oct 2026 14:32                                 │
 *   │ │ Pidió cotizar con la Hilux 2025 y entrega de USD 10.000.│
 *   └───────────────────────────────────────────────────────────┘
 *
 * Server Component: la bitácora llega armada del servidor, con el autor como
 * "Vos" u "Otro miembro" y sin ids de usuario. Solo el formulario es de
 * cliente. Append-only: una nota no se edita ni se borra.
 */

function countLabel(count: number): string {
  return count === 1 ? "1 nota" : `${count} notas`;
}

export function OpportunityNotes({
  opportunityId,
  notes,
}: {
  opportunityId: string;
  notes: readonly NoteEntry[];
}) {
  return (
    <section aria-labelledby="notes-heading" className="max-w-3xl">
      <Panel>
        <PanelHeader>
          <h2 id="notes-heading" className="text-heading text-text-primary">
            Notas
          </h2>
          <span className="ml-auto text-caption text-text-muted">
            {countLabel(notes.length)}
          </span>
        </PanelHeader>
        <div className="flex flex-col gap-4 px-4 py-3.5">
          <NoteForm opportunityId={opportunityId} />
          {notes.length === 0 ? (
            <p className="text-body text-text-secondary">
              Todavía no hay notas. Registrá acá lo que se habla con el cliente
              durante la negociación.
            </p>
          ) : (
            <ol
              aria-label="Bitácora de la oportunidad"
              className="flex flex-col gap-3 border-l-2 border-border-subtle pl-3"
            >
              {notes.map((note) => (
                <li key={note.id} className="flex flex-col gap-0.5">
                  <span className="text-caption text-text-muted">
                    {note.author} · {note.at}
                  </span>
                  <p className="text-body break-words whitespace-pre-line text-text-primary">
                    {note.body}
                  </p>
                </li>
              ))}
            </ol>
          )}
        </div>
      </Panel>
    </section>
  );
}
