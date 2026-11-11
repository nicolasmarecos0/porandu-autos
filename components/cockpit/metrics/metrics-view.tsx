import Link from "next/link";

import { WorkspaceLayout } from "@/components/shell/workspace-layout";
import { buttonClassName } from "@/components/ui/button";
import { CalendarIcon, LockIcon } from "@/components/ui/icons";
import { CAPABILITY_REQUIREMENTS, RESTRICTED_LABEL } from "@/lib/auth/roles";
import { COCKPIT_PATH } from "@/lib/cockpit/paths";
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
          canViewMetrics
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

/**
 * Estado vacío de las Métricas para un rol sin `metrics.view` (Hito 22,
 * DEC-054 §5): dice de quién es la vista y lleva al feed del Cockpit, donde
 * el vendedor sigue su día. No hay números: el loader no leyó nada.
 */
export function CockpitMetricsRestricted({ title }: { title: string }) {
  return (
    <WorkspaceLayout
      header={
        <CockpitHeader title={title} current="metrics" canViewMetrics={false} />
      }
    >
      <section
        aria-labelledby="metrics-restricted-heading"
        className="mx-auto mt-6 flex w-full max-w-md flex-col items-center gap-3 rounded-lg border border-dashed border-border-default bg-surface-1 px-6 py-10 text-center"
      >
        <span className="flex size-11 items-center justify-center rounded-full bg-surface-2 text-text-muted">
          <LockIcon aria-hidden="true" className="size-5" />
        </span>
        <p className="text-caption font-semibold tracking-wide text-text-muted uppercase">
          {RESTRICTED_LABEL}
        </p>
        <h2
          id="metrics-restricted-heading"
          className="text-heading text-text-primary"
        >
          Las Métricas del salón son de la gerencia
        </h2>
        <p className="text-label text-text-secondary">
          {CAPABILITY_REQUIREMENTS["metrics.view"]} Tu actividad del día, tus
          oportunidades y tu agenda siguen en el Cockpit.
        </p>
        <Link
          href={COCKPIT_PATH}
          prefetch={false}
          className={buttonClassName("primary", "mt-1 h-10 sm:h-8")}
        >
          Ir al Cockpit
        </Link>
      </section>
    </WorkspaceLayout>
  );
}
