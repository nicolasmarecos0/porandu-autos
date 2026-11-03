import Link from "next/link";

import { STATUS_EDGE } from "@/components/stock/stock-status";
import { StockIcon } from "@/components/ui/icons";
import type { StockHealthView } from "@/domains/cockpit/metrics";
import {
  averageDaysLabel,
  STOCK_STATUS_TITLES,
  unitsCountLabel,
} from "@/domains/cockpit/metrics-presentation";
import { formatCount, formatPercent } from "@/domains/dashboard/presentation";

import { SegmentedBar, Swatch } from "./bars";
import { CATALOG_HREF, stockStatusHref } from "./links";
import {
  DrillLink,
  MetricBand,
  MetricTile,
  MetricValue,
  MoneyValue,
  TodayTag,
} from "./metric-band";

/*
 * Salud del stock (propuesta DEC-050 §7), estado de hoy:
 *
 *   Distribución          las unidades por `vehicles.status`, con los
 *                         colores de la Stock List (DEC-026); cada estado
 *                         lleva al catálogo filtrado (o al Inventario, para
 *                         las que están en preparación)
 *   Valor publicado       disponibles y reservadas con precio, por moneda
 *   Antigüedad promedio   días desde el ingreso a Porandú de las publicadas
 *
 * Lo que falta se dice: una publicada sin precio no suma y se cuenta aparte
 * (DEC-005).
 */

const ROW_LINK =
  "rounded-sm text-text-secondary underline-offset-2 hover:text-brand-strong hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring";

export function StockBand({ stock }: { stock: StockHealthView }) {
  return (
    <MetricBand
      id="metrics-stock"
      title="Salud del stock"
      description="Inventario a la venta y su rotación, con el estado de cada unidad en Stock"
      icon={StockIcon}
      action={<DrillLink href={CATALOG_HREF}>Ver catálogo</DrillLink>}
    >
      <div className="grid gap-section md:grid-cols-2 xl:grid-cols-3">
        <MetricTile
          title="Distribución del inventario"
          scope={<TodayTag />}
          className="md:col-span-2 xl:col-span-1"
        >
          <div className="flex flex-col gap-0.5">
            <MetricValue>{formatCount(stock.total)}</MetricValue>
            <p className="text-caption text-text-muted">
              {stock.total === 0
                ? "Sin unidades cargadas"
                : stock.total === 1
                  ? "unidad en total"
                  : "unidades en total"}
            </p>
          </div>
          {stock.total > 0 ? (
            <SegmentedBar
              segments={stock.statuses.map(({ status, count }) => ({
                key: status,
                label: `${STOCK_STATUS_TITLES[status]}: ${formatCount(count)}`,
                value: count,
                fill: STATUS_EDGE[status],
              }))}
            />
          ) : null}
          <dl className="flex flex-col gap-1.5">
            {stock.statuses.map(({ status, count, share }) => (
              <div
                key={status}
                className="flex items-baseline justify-between gap-3 text-label"
              >
                <dt className="flex items-center gap-1.5">
                  <Swatch fill={STATUS_EDGE[status]} />
                  <Link
                    href={stockStatusHref(status)}
                    prefetch={false}
                    className={ROW_LINK}
                  >
                    {STOCK_STATUS_TITLES[status]}
                  </Link>
                </dt>
                <dd className="text-text-muted tabular-nums">
                  <span className="font-semibold text-text-primary">
                    {formatCount(count)}
                  </span>
                  {share === null ? null : ` · ${formatPercent(share)}`}
                </dd>
              </div>
            ))}
          </dl>
        </MetricTile>

        <MetricTile title="Valor del stock publicado" scope={<TodayTag />}>
          {stock.published === 0 ? (
            <p className="text-label text-text-muted">
              Sin unidades disponibles ni reservadas.
            </p>
          ) : (
            <>
              <dl className="flex flex-col gap-3">
                {stock.valuation.map((value) => (
                  <div key={value.currency} className="flex flex-col gap-0.5">
                    <dt className="sr-only">
                      {value.currency === "PYG" ? "En guaraníes" : "En dólares"}
                    </dt>
                    <dd>
                      <MoneyValue
                        amount={value.amount}
                        currency={value.currency}
                        muted={value.units === 0}
                      />
                    </dd>
                    <dd className="text-caption text-text-muted">
                      {value.units === 0
                        ? "Ninguna unidad con precio en esta moneda"
                        : `${unitsCountLabel(value.units)} con precio publicado`}
                    </dd>
                  </div>
                ))}
              </dl>
              <p className="text-caption text-text-muted">
                {stock.unpriced > 0
                  ? `${unitsCountLabel(stock.unpriced)} sin precio publicado: no ${stock.unpriced === 1 ? "suma" : "suman"}. `
                  : ""}
                Disponibles y reservadas; cada moneda por separado.
              </p>
            </>
          )}
        </MetricTile>

        <MetricTile title="Antigüedad promedio" scope={<TodayTag />}>
          <MetricValue muted={stock.averageAgeDays === null}>
            {averageDaysLabel(stock.averageAgeDays)}
          </MetricValue>
          <p className="text-caption text-text-muted">
            {stock.published === 0
              ? "Sin unidades disponibles ni reservadas."
              : `De ${unitsCountLabel(stock.published)} ${stock.published === 1 ? "disponible o reservada" : "disponibles o reservadas"}, desde su ingreso a Porandú.`}
          </p>
        </MetricTile>
      </div>
    </MetricBand>
  );
}
