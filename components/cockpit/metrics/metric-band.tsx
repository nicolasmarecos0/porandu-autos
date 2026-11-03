import Link from "next/link";
import type { ComponentType, ReactNode } from "react";

import { cn } from "@/components/ui/cn";
import {
  CalendarIcon,
  ChevronRightIcon,
  type IconProps,
} from "@/components/ui/icons";
import type { MetricsPeriodView } from "@/domains/cockpit/metrics";
import {
  METRICS_PERIOD_LABELS,
  METRICS_PERIOD_SHORT_LABELS,
} from "@/domains/cockpit/metrics-period";
import { formatMoney, type Currency } from "@/domains/money";

/*
 * Piezas de las Métricas del salón (propuesta DEC-050 §8), Server
 * Components con los tokens de DEC-013:
 *
 *   MetricBand   bloque con ícono, título, descripción y su drill-down
 *   MetricTile   tarjeta de un indicador: título, alcance, valor, contexto
 *   TodayTag /   alcance escrito de cada número: "Hoy" (existencias) o el
 *   PeriodTag    período elegido (flujos, DEC-037 §4)
 *   DrillLink    enlace a la superficie donde se actúa (MC §2.8: métricas
 *                con acción)
 */

export function MetricBand({
  id,
  title,
  description,
  icon: Icon,
  action,
  children,
}: {
  id: string;
  title: string;
  description: string;
  icon: ComponentType<IconProps>;
  /** Drill-down del bloque (DrillLink). */
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section aria-labelledby={`${id}-heading`} className="flex flex-col gap-3">
      <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-1.5">
        <div className="flex min-w-0 items-start gap-2.5">
          <span
            aria-hidden="true"
            className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-brand-soft text-brand-strong"
          >
            <Icon className="size-4.5" />
          </span>
          <div className="flex min-w-0 flex-col">
            <h2 id={`${id}-heading`} className="text-heading text-text-primary">
              {title}
            </h2>
            <p className="text-caption text-text-muted">{description}</p>
          </div>
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}

export function MetricTile({
  title,
  scope,
  action,
  className,
  children,
}: {
  title: string;
  /** TodayTag o PeriodTag: a qué tiempo responde el número. */
  scope: ReactNode;
  /** Drill-down propio de la tarjeta, al pie. */
  action?: ReactNode;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div
      className={cn(
        // `@container`: el contenido se acomoda al ancho de la tarjeta, no
        // al de la pantalla (dos tarjetas lado a lado en una tablet).
        "@container flex min-w-0 flex-col gap-3 rounded-xl border border-border-subtle bg-surface-1 p-4 shadow-card",
        className,
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <h3 className="text-label font-semibold text-text-secondary">
          {title}
        </h3>
        {scope}
      </div>
      {children}
      {action ? (
        <div className="mt-auto border-t border-border-subtle pt-2.5">
          {action}
        </div>
      ) : null}
    </div>
  );
}

const TAG =
  "inline-flex shrink-0 items-center gap-1 rounded-full border px-2 py-0.5 text-caption whitespace-nowrap";

/** Existencias: el estado de hoy, no depende del período (DEC-037 §4). */
export function TodayTag() {
  return (
    <span
      title="Estado de hoy: no depende del período"
      className={cn(
        TAG,
        "border-border-default bg-surface-2 text-text-secondary",
      )}
    >
      Hoy
    </span>
  );
}

/** Flujos: lo que pasó en el período elegido. */
export function PeriodTag({ period }: { period: MetricsPeriodView }) {
  return (
    <span
      title={period.label}
      className={cn(TAG, "border-brand-border bg-brand-soft text-brand-strong")}
    >
      <CalendarIcon aria-hidden="true" className="size-3" />
      <span className="sr-only">{METRICS_PERIOD_LABELS[period.kind]}</span>
      <span aria-hidden="true">{METRICS_PERIOD_SHORT_LABELS[period.kind]}</span>
    </span>
  );
}

export function DrillLink({
  href,
  children,
}: {
  href: string;
  children: ReactNode;
}) {
  return (
    <Link
      href={href}
      prefetch={false}
      className="inline-flex items-center gap-0.5 rounded-sm text-label font-semibold text-brand underline-offset-2 hover:text-brand-strong hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring"
    >
      {children}
      <ChevronRightIcon aria-hidden="true" className="size-3.5" />
    </Link>
  );
}

/** El número protagonista de una tarjeta. Sin dato se atenúa (DEC-005). */
export function MetricValue({
  muted = false,
  children,
}: {
  muted?: boolean;
  children: ReactNode;
}) {
  return (
    <p
      className={cn(
        "text-display tabular-nums",
        muted ? "text-text-muted" : "text-text-primary",
      )}
    >
      {children}
    </p>
  );
}

/**
 * Un monto exacto: la moneda chica y el monto protagonista, como el precio
 * de Stock. En un teléfono baja de tamaño para que un monto en guaraníes no
 * desborde, y como último recurso corta la línea antes que la página.
 */
export function MoneyValue({
  amount,
  currency,
  muted = false,
}: {
  amount: string;
  currency: Currency;
  muted?: boolean;
}) {
  const [prefix, ...digits] = formatMoney({ amount, currency }).split(" ");
  return (
    <p
      className={cn(
        "flex min-w-0 flex-wrap items-baseline gap-x-1.5 [overflow-wrap:anywhere] tabular-nums",
        muted ? "text-text-muted" : "text-text-primary",
      )}
    >
      <span className="text-label font-semibold text-text-muted">{prefix}</span>
      <span className="text-title sm:text-metric">{digits.join(" ")}</span>
    </p>
  );
}
