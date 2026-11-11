import { WorkspaceLayout } from "@/components/shell/workspace-layout";
import type { CockpitFeed } from "@/domains/cockpit/feed";

import { ActivityTimeline } from "./activity-timeline";
import { CockpitHeader } from "./cockpit-header";
import { CockpitSummary } from "./cockpit-summary";

/*
 * Cockpit (Hito 15, DEC-047): el home action-first del vendedor (MC §7,
 * DEC-017: "¿qué necesita atención ahora?"). Una franja de cuatro números y
 * la línea de tiempo del día, en una columna centrada: en una pantalla
 * ancha la vista no se estira, y el ojo va de la hora a la acción sin
 * cruzar la pantalla. Debajo de `lg` scrollea el conjunto (WorkspaceLayout).
 * El encabezado lleva el selector Cockpit · Métricas (propuesta DEC-050):
 * las métricas de la gerencia son una vista aparte, el feed no las repite.
 *
 * La hora de "Actualizado" es la del request: el feed no se refresca solo
 * (sin tiempo real, DEC-047 §8); volver a abrir el Cockpit lo vuelve a leer.
 */

export function CockpitView({
  title,
  feed,
  canViewMetrics,
}: {
  title: string;
  feed: CockpitFeed;
  canViewMetrics: boolean;
}) {
  return (
    <WorkspaceLayout
      header={
        <CockpitHeader
          title={title}
          current="feed"
          canViewMetrics={canViewMetrics}
          aside={
            <p className="text-label text-text-muted">
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
