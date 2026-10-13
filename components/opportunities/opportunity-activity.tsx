import { Badge } from "@/components/ui/badge";
import { Panel, PanelHeader } from "@/components/ui/panel";
import type { ActivityEntry } from "@/domains/conversations/timeline";

import { ActivityComposer } from "./activity-composer";

/*
 * Muro de actividad en /opportunities/[id] (Hito 4, DEC-036 §11): las notas
 * de la bitácora (DEC-033) y los mensajes registrados, juntos y del más
 * reciente al más viejo.
 *
 *   ┌ Actividad ──────────────────────────────────────── 3 registros ┐
 *   │ [Nota | Mensaje]                                                │
 *   │ Canal [WhatsApp ▾]  Dirección [Recibido del cliente ▾]          │
 *   │ Mensaje [                                         ] 0/4.096     │
 *   │ [Registrar mensaje]                                             │
 *   │ │ (Mensaje recibido) WhatsApp · Vos · 13 oct 2026 18:40         │
 *   │ │ ¿Sigue disponible la Hilux?                                   │
 *   │ │ (Nota) Otro miembro · 13 oct 2026 10:02                       │
 *   │ │ Pidió cotizar con entrega de USD 10.000.                      │
 *   └─────────────────────────────────────────────────────────────────┘
 *
 * Server Component: el muro llega armado del servidor (activityTimeline()),
 * con el autor como "Vos" u "Otro miembro" y sin ids de usuario. Solo el
 * selector y los formularios son de cliente. Append-only: nada se edita ni
 * se borra.
 */

function countLabel(count: number): string {
  return count === 1 ? "1 registro" : `${count} registros`;
}

function EntryHeader({ entry }: { entry: ActivityEntry }) {
  return (
    <span className="flex flex-wrap items-center gap-x-2 gap-y-1 text-caption text-text-muted">
      <Badge tone={entry.kind === "message" ? "brand" : "neutral"}>
        {entry.label}
      </Badge>
      {entry.kind === "message" ? (
        <span className="text-text-secondary">{entry.channelLabel}</span>
      ) : null}
      <span>
        {entry.author} · {entry.at}
      </span>
    </span>
  );
}

export function OpportunityActivity({
  opportunityId,
  activity,
}: {
  opportunityId: string;
  activity: readonly ActivityEntry[];
}) {
  return (
    <section aria-labelledby="activity-heading" className="max-w-3xl">
      <Panel>
        <PanelHeader>
          <h2 id="activity-heading" className="text-heading text-text-primary">
            Actividad
          </h2>
          <span className="ml-auto text-caption text-text-muted">
            {countLabel(activity.length)}
          </span>
        </PanelHeader>
        <div className="flex flex-col gap-4 px-4 py-3.5">
          <ActivityComposer opportunityId={opportunityId} />
          {activity.length === 0 ? (
            <p className="text-body text-text-secondary">
              Todavía no hay actividad. Registrá acá las notas de la negociación
              y los mensajes que se cruzan con el cliente.
            </p>
          ) : (
            <ol
              aria-label="Muro de actividad de la oportunidad"
              className="flex flex-col gap-3 border-l-2 border-border-subtle pl-3"
            >
              {activity.map((entry) => (
                <li
                  key={`${entry.kind}:${entry.id}`}
                  className="flex flex-col gap-1"
                >
                  <EntryHeader entry={entry} />
                  <p className="text-body break-words whitespace-pre-line text-text-primary">
                    {entry.body}
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
