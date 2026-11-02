import Link from "next/link";
import type { ReactNode } from "react";
import { getNavItem } from "@/components/shell/navigation";
import { Panel, PanelHeader } from "@/components/ui/panel";
import type { CockpitEvent, CockpitFeed } from "@/domains/cockpit/feed";
import { RECENT_WINDOW_DAYS } from "@/domains/cockpit/window";

import { TimelineItem } from "./timeline-item";

/*
 * Línea de tiempo del Cockpit (Hito 15, DEC-047 §4): un solo hilo vertical,
 * de arriba hacia abajo, anclado en "Ahora":
 *
 *   PRÓXIMAS          pruebas en curso o por venir hasta mañana, la más
 *    ○ Hoy 15:00      cercana arriba
 *   ● AHORA · 14:32 ────────────────────────────────────────────────
 *   HOY               lo reciente, de lo más nuevo a lo más viejo,
 *    ● 14:20          agrupado por día de Asunción
 *   AYER
 *    ● 18:05
 *
 * Server Component, sin JavaScript de cliente: cada acción es un enlace.
 * Cada día es una `section` con su título y una lista ordenada, para que un
 * lector de pantalla recorra el feed en el mismo orden en que se ve. Sin
 * animaciones: es la pantalla que más se abre en el día.
 */

const conversations = getNavItem("conversations");
const calendar = getNavItem("calendar");

const INLINE_LINK_CLASS_NAME =
  "font-semibold text-brand underline-offset-2 hover:text-brand-strong hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring";

function TimelineSection({
  id,
  label,
  events,
  empty,
}: {
  id: string;
  label: string;
  events: readonly CockpitEvent[];
  empty: string;
}) {
  return (
    <section aria-labelledby={id}>
      <h3
        id={id}
        className="px-4 pt-3 pb-0.5 text-overline text-text-muted uppercase"
      >
        {label}
      </h3>
      {events.length === 0 ? (
        <p className="px-4 py-2 text-body text-text-muted">{empty}</p>
      ) : (
        <ol className="mx-4">
          {events.map((event) => (
            <TimelineItem key={event.key} event={event} />
          ))}
        </ol>
      )}
    </section>
  );
}

function NowMarker({ iso, label }: { iso: string; label: string }) {
  return (
    <div className="mx-4 my-1 flex items-center gap-3">
      <span
        aria-hidden="true"
        className="flex size-8 shrink-0 items-center justify-center"
      >
        <span className="size-2.5 rounded-full bg-brand ring-4 ring-brand-soft" />
      </span>
      <p className="shrink-0 text-overline text-brand-strong uppercase">
        Ahora · <time dateTime={iso}>{label}</time>
      </p>
      <span aria-hidden="true" className="h-px flex-1 bg-brand-border" />
    </div>
  );
}

function Note({ children }: { children: ReactNode }) {
  return (
    <p className="px-4 pt-1 pb-2 text-label text-text-muted">{children}</p>
  );
}

export function ActivityTimeline({ feed }: { feed: CockpitFeed }) {
  const hiddenUpcoming = feed.upcomingTotal - feed.upcoming.length;
  const hiddenRecent = feed.recentTotal - feed.recentShown;

  return (
    <Panel>
      <section aria-labelledby="cockpit-activity">
        <PanelHeader>
          <h2 id="cockpit-activity" className="text-heading text-text-primary">
            Actividad
          </h2>
          <span className="ml-auto truncate text-label text-text-muted">
            Hasta mañana · últimos {RECENT_WINDOW_DAYS} días
          </span>
        </PanelHeader>

        <div className="pb-2">
          <TimelineSection
            id="cockpit-upcoming"
            label="Próximas pruebas"
            events={feed.upcoming}
            empty="Sin pruebas de manejo hoy ni mañana."
          />
          {hiddenUpcoming > 0 ? (
            <Note>
              {hiddenUpcoming === 1
                ? "Hay 1 prueba más hasta mañana. "
                : `Hay ${hiddenUpcoming.toLocaleString("es-PY")} pruebas más hasta mañana. `}
              <Link
                href={calendar.href}
                prefetch={false}
                className={INLINE_LINK_CLASS_NAME}
              >
                Ver {calendar.label.toLocaleLowerCase("es-PY")}
              </Link>
            </Note>
          ) : null}

          <NowMarker iso={feed.generatedAt} label={feed.generatedLabel} />

          {feed.recent.length === 0 ? (
            <p className="px-4 py-2 text-body text-text-muted">
              Nada nuevo: sin chats sin leer, pruebas vencidas ni movimientos en
              los últimos {RECENT_WINDOW_DAYS} días.
            </p>
          ) : (
            feed.recent.map((group) => (
              <TimelineSection
                key={group.key}
                id={`cockpit-day-${group.key}`}
                label={group.label}
                events={group.events}
                empty=""
              />
            ))
          )}

          {hiddenRecent > 0 ? (
            <Note>
              Se muestran los {feed.recentShown.toLocaleString("es-PY")} eventos
              más recientes de {feed.recentTotal.toLocaleString("es-PY")}. El
              resto sigue en{" "}
              <Link
                href={conversations.href}
                prefetch={false}
                className={INLINE_LINK_CLASS_NAME}
              >
                {conversations.label}
              </Link>
              ,{" "}
              <Link
                href={calendar.href}
                prefetch={false}
                className={INLINE_LINK_CLASS_NAME}
              >
                {calendar.label}
              </Link>{" "}
              y cada oportunidad.
            </Note>
          ) : null}
        </div>
      </section>
    </Panel>
  );
}
