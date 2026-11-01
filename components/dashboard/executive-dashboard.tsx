import type { ReactNode } from "react";
import { WorkspaceLayout } from "@/components/shell/workspace-layout";
import { Badge } from "@/components/ui/badge";
import { CalendarIcon } from "@/components/ui/icons";
import type { ExecutiveDashboard } from "@/domains/dashboard/metrics";
import { countLabel, formatCount } from "@/domains/dashboard/presentation";

import { AtRiskList } from "./at-risk-list";
import { KpiCard } from "./kpi-card";
import { KpiRow } from "./kpi-row";
import { RangePicker } from "./range-picker";

/**
 * Dashboard Directivo de /intelligence (Hito 5, DEC-037; DEC-043 §9): lo que
 * la gerencia necesita ver sin recorrer la cola, el stock, las cotizaciones
 * ni la agenda.
 *
 *   encabezado: título, rango elegido y selector de rango
 *   ─────────────────────────────────────────────┬──────────────────────
 *   fila de KPIs (ventas, conversión,             │ Oportunidades
 *   cotizaciones, test drives)                    │ en riesgo
 *   Pipeline comercial · Salud del inventario     │
 *   · Atención                                    │
 *
 * Solo lectura. Server Components: los números llegan formateados del
 * servidor y lo único de cliente es el drawer del rango personalizado.
 */
export function ExecutiveDashboardView({
  title,
  dashboard,
}: {
  title: string;
  dashboard: ExecutiveDashboard;
}) {
  const { range, conversion, pipeline, inventory, attention } = dashboard;
  const needsAttention = attention.warning + attention.stale;
  return (
    <WorkspaceLayout
      header={
        <header className="shrink-0 border-b border-border-subtle bg-surface-1 px-gutter py-3">
          <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
            <div className="flex min-w-0 flex-col gap-1">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <h1 className="text-title text-text-primary">{title}</h1>
                <Badge tone="brand">Dashboard directivo</Badge>
              </div>
              <p
                aria-live="polite"
                className="flex items-center gap-1.5 text-label text-text-secondary"
              >
                <CalendarIcon
                  aria-hidden="true"
                  className="size-4 shrink-0 text-text-muted"
                />
                <span className="font-semibold text-text-primary">
                  {range.label}
                </span>
              </p>
            </div>
            <RangePicker range={range} today={dashboard.today} />
          </div>
        </header>
      }
      aside={<AtRiskList atRisk={dashboard.atRisk} />}
    >
      {dashboard.notice ? (
        <p
          role="status"
          className="rounded-lg border border-warning-border bg-warning-soft px-4 py-2.5 text-label text-warning"
        >
          {dashboard.notice}
        </p>
      ) : null}

      <KpiRow
        conversion={conversion}
        pendingQuotes={dashboard.pendingQuotes}
        weekTestDrives={dashboard.weekTestDrives}
      />

      <MetricSection id="pipeline" title="Pipeline comercial" columns={2}>
        <KpiCard
          label="Oportunidades activas"
          value={formatCount(pipeline.open)}
          hint="Nuevas, en calificación y en negociación, hoy"
        />
        <KpiCard
          label="Perdidas"
          value={formatCount(conversion.lost)}
          hint="Cerradas sin venta en el rango"
        />
      </MetricSection>

      <MetricSection id="inventory" title="Salud del inventario">
        <KpiCard
          label="En stock"
          value={formatCount(inventory.inStock)}
          hint="Unidades sin reserva ni venta, hoy"
        />
        <KpiCard
          label="Reservadas"
          value={formatCount(inventory.reserved)}
          hint="Vinculadas a una oportunidad en negociación, hoy"
        />
        <KpiCard
          label="Vendidas en el rango"
          value={formatCount(inventory.sold)}
          hint="Unidades de las ventas cerradas en el rango"
        />
      </MetricSection>

      <MetricSection
        id="attention"
        title="Atención"
        caption={
          needsAttention === 0
            ? "Ninguna requiere atención"
            : `${countLabel(needsAttention, "requiere", "requieren")} atención`
        }
        columns={2}
      >
        <KpiCard
          label="Enfriándose"
          value={formatCount(attention.warning)}
          tone={attention.warning > 0 ? "warning" : "neutral"}
          hint="De 2 a 5 días sin actividad del cliente"
        />
        <KpiCard
          label="Inactivas"
          value={formatCount(attention.stale)}
          tone={attention.stale > 0 ? "danger" : "neutral"}
          hint="Más de 5 días sin actividad del cliente"
        />
      </MetricSection>
    </WorkspaceLayout>
  );
}

/** Bloque de indicadores: encabezado y una grilla de tarjetas (`dl`). */
function MetricSection({
  id,
  title,
  caption,
  columns = 3,
  children,
}: {
  id: string;
  title: string;
  caption?: string;
  columns?: 2 | 3;
  children: ReactNode;
}) {
  return (
    <section aria-labelledby={`${id}-heading`} className="flex flex-col gap-2">
      <div className="flex items-baseline justify-between gap-3">
        <h2
          id={`${id}-heading`}
          className="text-overline text-text-muted uppercase"
        >
          {title}
        </h2>
        {caption ? (
          <p className="text-caption text-text-muted">{caption}</p>
        ) : null}
      </div>
      <dl
        className={
          columns === 2
            ? "grid gap-section sm:grid-cols-2"
            : "grid gap-section sm:grid-cols-3"
        }
      >
        {children}
      </dl>
    </section>
  );
}
