import Link from "next/link";

import { BoardIcon, CheckIcon } from "@/components/ui/icons";
import type { CockpitMetrics } from "@/domains/cockpit/metrics";
import {
  averageDaysLabel,
  salesCycleBasis,
} from "@/domains/cockpit/metrics-presentation";
import {
  conversionBasis,
  formatCount,
  formatPercent,
} from "@/domains/dashboard/presentation";
import { LOSS_REASON_LABELS, stageLabel } from "@/domains/opportunities/labels";

import { ShareBar } from "./bars";
import { pipelineStageHref, PIPELINE_HREF } from "./links";
import {
  DrillLink,
  MetricBand,
  MetricTile,
  MetricValue,
  PeriodTag,
  TodayTag,
} from "./metric-band";

/*
 * Embudo y conversión (propuesta DEC-050 §4): la velocidad del embudo y la
 * efectividad de cierre.
 *
 *   Embudo abierto      hoy      abiertas por etapa, con su parte
 *   Tasa de conversión  período  ventas sobre cierres (DEC-043 §3.2)
 *   Ciclo de venta      período  días promedio de alta a venta
 *   Motivos de pérdida  período  del más frecuente al menos (DEC-034 §2)
 *
 * Las barras son de un solo tono (una serie, un color). En los motivos, el
 * principal se destaca y el resto va en el tono suave de la misma rampa.
 * Cada etapa lleva a su columna del embudo.
 */

const ROW_LINK =
  "rounded-sm text-text-primary underline-offset-2 hover:text-brand-strong hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring";

type FunnelBandProps = Pick<
  CockpitMetrics,
  "period" | "funnel" | "conversion" | "salesCycle" | "lossReasons"
>;

export function FunnelBand({
  period,
  funnel,
  conversion,
  salesCycle,
  lossReasons,
}: FunnelBandProps) {
  const topLoss = lossReasons.reasons[0]?.count ?? 0;
  return (
    <MetricBand
      id="metrics-funnel"
      title="Embudo y conversión"
      description="Velocidad del embudo y efectividad de cierre"
      icon={BoardIcon}
      action={<DrillLink href={PIPELINE_HREF}>Ver embudo</DrillLink>}
    >
      <div className="grid gap-section md:grid-cols-2 xl:grid-cols-3">
        <MetricTile title="Embudo abierto" scope={<TodayTag />}>
          <div className="flex flex-col">
            <MetricValue>{formatCount(funnel.open)}</MetricValue>
            <p className="text-caption text-text-muted">
              {funnel.open === 1
                ? "oportunidad abierta"
                : "oportunidades abiertas"}
            </p>
          </div>
          <ul className="flex flex-col gap-2.5">
            {funnel.stages.map((stage) => (
              <li key={stage.stage} className="flex flex-col gap-1">
                <div className="flex items-baseline justify-between gap-3 text-label">
                  <Link
                    href={pipelineStageHref(stage.stage)}
                    prefetch={false}
                    className={ROW_LINK}
                  >
                    {stageLabel(stage.stage)}
                  </Link>
                  <span className="text-text-muted tabular-nums">
                    <span className="font-semibold text-text-primary">
                      {formatCount(stage.count)}
                    </span>
                    {stage.share === null
                      ? null
                      : ` · ${formatPercent(stage.share)}`}
                  </span>
                </div>
                <ShareBar percent={stage.share} />
              </li>
            ))}
          </ul>
        </MetricTile>

        {/* Conversión y ciclo, apiladas: juntas miden el cierre. */}
        <div className="flex min-w-0 flex-col gap-section">
          <MetricTile
            title="Tasa de conversión"
            scope={<PeriodTag period={period} />}
            className="flex-1"
          >
            <MetricValue muted={conversion.rate === null}>
              {formatPercent(conversion.rate)}
            </MetricValue>
            <ShareBar percent={conversion.rate} />
            <p className="text-caption text-text-muted">
              {conversion.rate === null
                ? "Sin cierres en el período: todavía no hay tasa."
                : `${conversionBasis(conversion.won, conversion.closed)} (ganadas y perdidas)`}
            </p>
          </MetricTile>

          <MetricTile
            title="Ciclo de venta"
            scope={<PeriodTag period={period} />}
            className="flex-1"
          >
            <MetricValue muted={salesCycle.averageDays === null}>
              {averageDaysLabel(salesCycle.averageDays)}
            </MetricValue>
            <p className="text-caption text-text-muted">
              {salesCycle.won === 0
                ? "Sin ventas en el período."
                : `${salesCycleBasis(salesCycle.won)}, del alta de la oportunidad al cierre.`}
            </p>
          </MetricTile>
        </div>

        <MetricTile
          title="Motivos de pérdida"
          scope={<PeriodTag period={period} />}
          className="md:col-span-2 xl:col-span-1"
        >
          <div className="flex flex-col">
            <MetricValue muted={lossReasons.lost === 0}>
              {formatCount(lossReasons.lost)}
            </MetricValue>
            <p className="text-caption text-text-muted">
              {lossReasons.lost === 1
                ? "oportunidad perdida"
                : "oportunidades perdidas"}
            </p>
          </div>
          {lossReasons.reasons.length === 0 ? (
            <p className="flex items-center gap-1.5 text-label text-text-secondary">
              <CheckIcon aria-hidden="true" className="size-4 text-success" />
              Sin pérdidas en el período
            </p>
          ) : (
            <ul className="flex flex-col gap-2.5">
              {lossReasons.reasons.map((item) => (
                <li key={item.reason} className="flex flex-col gap-1">
                  <div className="flex items-baseline justify-between gap-3 text-label">
                    <span className="text-text-primary">
                      {LOSS_REASON_LABELS[item.reason]}
                    </span>
                    <span className="text-text-muted tabular-nums">
                      <span className="font-semibold text-text-primary">
                        {formatCount(item.count)}
                      </span>
                      {` · ${formatPercent(item.share)}`}
                    </span>
                  </div>
                  <ShareBar
                    percent={item.share}
                    tone={item.count === topLoss ? "brand" : "soft"}
                  />
                </li>
              ))}
            </ul>
          )}
        </MetricTile>
      </div>
    </MetricBand>
  );
}
