import type { ReactNode } from "react";
import { PageHeader } from "@/components/shell/page-header";
import { WorkspaceLayout } from "@/components/shell/workspace-layout";
import { Badge } from "@/components/ui/badge";
import type { ExecutiveDashboard } from "@/domains/dashboard/metrics";
import {
  countLabel,
  formatCount,
  formatPercent,
  NO_DATA,
} from "@/domains/dashboard/presentation";

import { AtRiskList } from "./at-risk-list";
import { KpiCard, RatioMeter } from "./kpi-card";

/**
 * Dashboard Directivo de /intelligence (Hito 5, DEC-037): lo que la
 * gerencia necesita ver del mes en curso sin recorrer la cola ni el stock.
 * Tres bloques de indicadores en una grilla (pipeline, inventario y
 * atención) y, en el rail, las oportunidades en riesgo. Solo lectura y sin
 * JavaScript de cliente: los números llegan formateados del servidor.
 */
export function ExecutiveDashboardView({
  title,
  dashboard,
}: {
  title: string;
  dashboard: ExecutiveDashboard;
}) {
  const { pipeline, inventory, attention } = dashboard;
  const needsAttention = attention.warning + attention.stale;
  return (
    <WorkspaceLayout
      header={
        <PageHeader
          title={title}
          status={<Badge tone="brand">Dashboard directivo</Badge>}
          actions={
            <p className="text-label font-normal text-text-muted">
              Mes en curso:{" "}
              <span className="font-semibold text-text-primary">
                {dashboard.periodLabel}
              </span>
            </p>
          }
        />
      }
      aside={<AtRiskList atRisk={dashboard.atRisk} />}
    >
      <MetricSection id="pipeline" title="Pipeline comercial">
        <KpiCard
          label="Oportunidades activas"
          value={formatCount(pipeline.open)}
          hint="Nuevas, en calificación y en negociación"
        />
        <KpiCard
          label="Ganadas en el mes"
          value={formatCount(pipeline.won)}
          hint={`${countLabel(pipeline.lost, "perdida", "perdidas")} en el mes`}
        />
        <KpiCard
          label="Win rate"
          value={formatPercent(pipeline.winRate)}
          muted={pipeline.winRate === null}
          hint={
            pipeline.winRate === null
              ? `${NO_DATA}: no hubo cierres en el mes`
              : "Ganadas sobre cerradas en el mes"
          }
        >
          {pipeline.winRate === null ? null : (
            <RatioMeter percent={pipeline.winRate} />
          )}
        </KpiCard>
      </MetricSection>

      <MetricSection id="inventory" title="Salud del inventario">
        <KpiCard
          label="En stock"
          value={formatCount(inventory.inStock)}
          hint="Unidades sin reserva ni venta"
        />
        <KpiCard
          label="Reservadas"
          value={formatCount(inventory.reserved)}
          hint="Vinculadas a una oportunidad en negociación"
        />
        <KpiCard
          label="Vendidas en el mes"
          value={formatCount(inventory.sold)}
          hint="Unidades de oportunidades ganadas en el mes"
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
