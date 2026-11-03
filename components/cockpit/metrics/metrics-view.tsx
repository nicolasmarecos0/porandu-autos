import { WorkspaceLayout } from "@/components/shell/workspace-layout";
import { CalendarIcon } from "@/components/ui/icons";
import type { CockpitMetrics } from "@/domains/cockpit/metrics";

import { CockpitHeader } from "../cockpit-header";
import { FunnelBand } from "./funnel-band";
import { PeriodPicker } from "./period-picker";
import { PulseBand } from "./pulse-band";
import { StockBand } from "./stock-band";
import { ValueBand } from "./value-band";

/*
 * Métricas del salón (propuesta DEC-050): la vista ejecutiva de la sección
 * Cockpit, para que dueños y gerentes auditen la salud comercial de un
 * vistazo. Mobile-first: una columna en el teléfono que se abre en dos,
 * tres o cuatro tarjetas por bloque según el ancho, centrada y acotada en
 * pantallas anchas.
 *
 *   encabezado: título · Cockpit | Métricas · período (7 · 30 · 90 · Todo)
 *               período elegido y hora de la lectura
 *   ──────────────────────────────────────────────────────────────────
 *   Embudo y conversión   abiertas · conversión · ciclo · motivos
 *   Valor comercial       plata en juego, una tarjeta por moneda
 *   Pulso operativo       realización de pruebas · requieren intervención
 *   Salud del stock       distribución · valor publicado · antigüedad
 *
 * Cada número dice a qué tiempo responde ("Hoy" o el período) y cada
 * bloque lleva a la superficie donde se actúa. Server Components, sin
 * JavaScript de cliente ni librerías de gráficos: barras de Tailwind.
 */

export function CockpitMetricsView({
  title,
  metrics,
}: {
  title: string;
  metrics: CockpitMetrics;
}) {
  const { period } = metrics;
  return (
    <WorkspaceLayout
      header={
        <CockpitHeader
          title={title}
          current="metrics"
          aside={<PeriodPicker current={period.kind} />}
        >
          <p className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-label text-text-secondary">
            <span
              aria-live="polite"
              className="inline-flex items-center gap-1.5 font-semibold text-text-primary"
            >
              <CalendarIcon
                aria-hidden="true"
                className="size-4 shrink-0 text-text-muted"
              />
              {period.label}
            </span>
            <span className="text-text-muted">
              Actualizado{" "}
              <time dateTime={metrics.generatedAt}>
                {metrics.generatedLabel}
              </time>
            </span>
          </p>
        </CockpitHeader>
      }
    >
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 pb-2">
        {metrics.notice ? (
          <p
            role="status"
            className="rounded-lg border border-warning-border bg-warning-soft px-4 py-2.5 text-label text-warning"
          >
            {metrics.notice}
          </p>
        ) : null}
        <FunnelBand
          period={period}
          funnel={metrics.funnel}
          conversion={metrics.conversion}
          salesCycle={metrics.salesCycle}
          lossReasons={metrics.lossReasons}
        />
        <ValueBand quoteValue={metrics.quoteValue} />
        <PulseBand
          period={period}
          testDrives={metrics.testDrives}
          attention={metrics.attention}
        />
        <StockBand stock={metrics.stock} />
      </div>
    </WorkspaceLayout>
  );
}
