import { WalletIcon } from "@/components/ui/icons";
import type {
  CurrencyValueView,
  QuoteValueStatus,
} from "@/domains/cockpit/metrics";
import {
  QUOTE_VALUE_STATUS_LABELS,
  quotesLabel,
} from "@/domains/cockpit/metrics-presentation";
import { formatPercent } from "@/domains/dashboard/presentation";
import { formatMoney, type Currency } from "@/domains/money";

import { SegmentedBar, Swatch } from "./bars";
import { pipelineStageHref } from "./links";
import {
  DrillLink,
  MetricBand,
  MetricTile,
  MoneyValue,
  TodayTag,
} from "./metric-band";

/*
 * Valor comercial (propuesta DEC-050 §5): la plata en juego hoy, una
 * tarjeta por moneda. Nunca se suman ni comparan guaraníes con dólares
 * (DEC-025 §5): no hay conversión. Cada tarjeta parte su total entre las
 * aprobadas que falta entregar y las enviadas que esperan la respuesta del
 * cliente, en dos pasos de la rampa de marca (no son estados buenos ni
 * malos), con los montos exactos en la leyenda.
 */

const CURRENCY_TITLES: Readonly<Record<Currency, string>> = {
  PYG: "En juego en guaraníes",
  USD: "En juego en dólares",
};

const STATUS_FILL: Readonly<Record<QuoteValueStatus, string>> = {
  approved: "bg-brand-border",
  sent: "bg-brand",
};

const STATUSES: readonly QuoteValueStatus[] = ["approved", "sent"];

export function ValueBand({
  quoteValue,
}: {
  quoteValue: readonly CurrencyValueView[];
}) {
  return (
    <MetricBand
      id="metrics-value"
      title="Valor comercial"
      description="Cotizaciones aprobadas o enviadas, vigentes, de oportunidades abiertas. Cada moneda por separado, sin conversión."
      icon={WalletIcon}
      action={
        <DrillLink href={pipelineStageHref("negotiating")}>
          Ver negociaciones
        </DrillLink>
      }
    >
      <div className="grid gap-section md:grid-cols-2">
        {quoteValue.map((value) => (
          <CurrencyTile key={value.currency} value={value} />
        ))}
      </div>
    </MetricBand>
  );
}

function CurrencyTile({ value }: { value: CurrencyValueView }) {
  const empty = value.total.count === 0;
  return (
    <MetricTile title={CURRENCY_TITLES[value.currency]} scope={<TodayTag />}>
      <div className="flex flex-col gap-0.5">
        <MoneyValue
          amount={value.total.amount}
          currency={value.currency}
          muted={empty}
        />
        <p className="text-caption text-text-muted">
          {empty
            ? "Ninguna cotización en juego"
            : quotesLabel(value.total.count)}
        </p>
      </div>
      {empty ? null : (
        <>
          <SegmentedBar
            segments={STATUSES.map((status) => ({
              key: status,
              label: `${QUOTE_VALUE_STATUS_LABELS[status]}: ${formatMoney({
                amount: value[status].amount,
                currency: value.currency,
              })}`,
              value: value[status].share ?? 0,
              fill: STATUS_FILL[status],
            }))}
          />
          <dl className="flex flex-col gap-1.5">
            {STATUSES.map((status) => (
              <div
                key={status}
                className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 text-label"
              >
                <dt className="flex items-center gap-1.5 text-text-secondary">
                  <Swatch fill={STATUS_FILL[status]} />
                  {QUOTE_VALUE_STATUS_LABELS[status]}
                </dt>
                <dd className="text-text-muted tabular-nums">
                  <span className="font-semibold text-text-primary">
                    {formatMoney({
                      amount: value[status].amount,
                      currency: value.currency,
                    })}
                  </span>
                  {` · ${quotesLabel(value[status].count)}`}
                  {value[status].share === null
                    ? null
                    : ` · ${formatPercent(value[status].share)}`}
                </dd>
              </div>
            ))}
          </dl>
        </>
      )}
    </MetricTile>
  );
}
