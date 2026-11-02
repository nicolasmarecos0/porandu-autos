import { PageHeader } from "@/components/shell/page-header";
import { WorkspaceLayout } from "@/components/shell/workspace-layout";
import type { CockpitFeed } from "@/domains/cockpit/feed";

import { ActivityTimeline } from "./activity-timeline";
import { CockpitSummary } from "./cockpit-summary";

/*
 * Cockpit (Hito 15, DEC-047): el home action-first del vendedor (MC §7,
 * DEC-017: "¿qué necesita atención ahora?"). Una franja de cuatro números y
 * la línea de tiempo del día, en una columna centrada: en una pantalla
 * ancha la vista no se estira, y el ojo va de la hora a la acción sin
 * cruzar la pantalla. Debajo de `lg` scrollea el conjunto (WorkspaceLayout).
 *
 * La hora de "Actualizado" es la del request: el feed no se refresca solo
 * (sin tiempo real, DEC-047 §8); volver a abrir el Cockpit lo vuelve a leer.
 */

export function CockpitView({
  title,
  feed,
}: {
  title: string;
  feed: CockpitFeed;
}) {
  return (
    <WorkspaceLayout
      header={
        <PageHeader
          title={title}
          status={
            <p className="truncate text-label text-text-muted">
              Actualizado{" "}
              <time dateTime={feed.generatedAt}>{feed.generatedLabel}</time>
            </p>
          }
        />
      }
    >
      <div className="mx-auto flex w-full max-w-4xl flex-col gap-section">
        <CockpitSummary tiles={feed.summary} />
        <ActivityTimeline feed={feed} />
      </div>
    </WorkspaceLayout>
  );
}
