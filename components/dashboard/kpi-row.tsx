import Link from "next/link";
import type { ReactNode } from "react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/components/ui/cn";
import {
  ChevronRightIcon,
  DocumentIcon,
  PercentIcon,
  SteeringIcon,
  WalletIcon,
  type IconProps,
} from "@/components/ui/icons";
import { WEEK_PARAM } from "@/domains/calendar/week";
import type { ExecutiveDashboard } from "@/domains/dashboard/metrics";
import {
  conversionBasis,
  countLabel,
  formatCount,
  formatPercent,
  NO_DATA,
  pendingQuotesBreakdown,
  weekTestDrivesBreakdown,
} from "@/domains/dashboard/presentation";

import { RatioMeter } from "./kpi-card";

/*
 * Fila de KPIs del Dashboard Directivo (DEC-043 §9): lo primero que lee la
 * gerencia. Cuatro tarjetas en una `dl`, cada una con su alcance escrito al
 * pie, porque no todas siguen el rango elegido:
 *
 *   Ventas cerradas · Tasa de conversión → el rango (DEC-043 §3)
 *   Cotizaciones pendientes             → hoy (DEC-043 §4)
 *   Test drives de la semana            → la semana en curso (DEC-043 §5)
 *
 * Server Component, sin JavaScript de cliente. Los colores de estado solo
 * acompañan a un texto (DEC-013): las vencidas llevan el tono de advertencia
 * junto a su rótulo.
 *
 * Grilla: una columna en teléfono, dos desde `sm` y cuatro desde `xl`, donde
 * la columna central (sin el rail) ya deja unos 200 px por tarjeta.
 */

/** Alcance de las tarjetas que siguen el rango de la URL. */
const RANGE_SCOPE = "En el rango elegido";

/** Alcance de las existencias: no dependen del rango (DEC-043 §2). */
const TODAY_SCOPE = "Estado de hoy";

const calendarHref = (weekKey: string) =>
  `/calendar?${WEEK_PARAM}=${encodeURIComponent(weekKey)}`;

type KpiRowProps = Pick<
  ExecutiveDashboard,
  "conversion" | "pendingQuotes" | "weekTestDrives"
>;

export function KpiRow({
  conversion,
  pendingQuotes,
  weekTestDrives,
}: KpiRowProps) {
  return (
    <section aria-labelledby="kpis-heading" className="flex flex-col gap-2">
      <h2 id="kpis-heading" className="text-overline text-text-muted uppercase">
        Indicadores clave
      </h2>
      <dl className="grid gap-section sm:grid-cols-2 xl:grid-cols-4">
        <HeadlineKpi
          icon={WalletIcon}
          label="Ventas cerradas"
          value={formatCount(conversion.won)}
          scope={RANGE_SCOPE}
        >
          <span>Oportunidades ganadas con cierre en el rango</span>
        </HeadlineKpi>

        <HeadlineKpi
          icon={PercentIcon}
          label="Tasa de conversión"
          value={formatPercent(conversion.rate)}
          muted={conversion.rate === null}
          scope={RANGE_SCOPE}
        >
          {conversion.rate === null ? (
            <span>{NO_DATA}: no hubo cierres en el rango</span>
          ) : (
            <>
              <RatioMeter percent={conversion.rate} />
              <span>{conversionBasis(conversion.won, conversion.closed)}</span>
            </>
          )}
        </HeadlineKpi>

        <HeadlineKpi
          icon={DocumentIcon}
          label="Cotizaciones pendientes"
          value={formatCount(pendingQuotes.total)}
          scope={TODAY_SCOPE}
        >
          <span>{pendingQuotesBreakdown(pendingQuotes)}</span>
          {pendingQuotes.expired > 0 ? (
            <Badge tone="warning" className="self-start">
              {countLabel(
                pendingQuotes.expired,
                "vencida sin cerrar",
                "vencidas sin cerrar",
              )}
            </Badge>
          ) : null}
        </HeadlineKpi>

        <HeadlineKpi
          icon={SteeringIcon}
          label="Test drives de la semana"
          value={formatCount(weekTestDrives.scheduled)}
          scope={
            <span className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
              <span className="tabular-nums">{weekTestDrives.weekLabel}</span>
              <Link
                href={calendarHref(weekTestDrives.weekKey)}
                prefetch={false}
                className="inline-flex items-center gap-0.5 rounded-sm font-semibold text-brand underline-offset-2 hover:text-brand-strong hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring"
              >
                Ver agenda
                <ChevronRightIcon aria-hidden="true" className="size-3.5" />
              </Link>
            </span>
          }
        >
          <span>{weekTestDrivesBreakdown(weekTestDrives)}</span>
          {weekTestDrives.cancelled > 0 ? (
            <span>
              {countLabel(weekTestDrives.cancelled, "cancelada", "canceladas")}{" "}
              fuera de la agenda
            </span>
          ) : null}
        </HeadlineKpi>
      </dl>
    </section>
  );
}

type HeadlineKpiProps = {
  icon: (props: IconProps) => ReactNode;
  /** Rótulo del indicador ("Ventas cerradas"). */
  label: string;
  /** Valor ya formateado en es-PY ("1.234", "66,7%"). */
  value: string;
  /** Un valor sin dato se atenúa (DEC-005): no es un cero. */
  muted?: boolean;
  /** A qué período responde el número ("En el rango elegido", "Hoy"). */
  scope: ReactNode;
  /** Contexto que explica el número. */
  children: ReactNode;
};

/**
 * Tarjeta de la fila de KPIs: un grupo de la `dl` con su `dt` (ícono y
 * rótulo) y tres `dd` (valor, contexto y alcance). Más protagonista que las
 * tarjetas de los bloques de abajo: valor `text-display` y alcance al pie.
 */
function HeadlineKpi({
  icon: Icon,
  label,
  value,
  muted = false,
  scope,
  children,
}: HeadlineKpiProps) {
  return (
    <div className="flex min-h-44 flex-col gap-3 rounded-xl border border-border-subtle bg-surface-1 p-4 shadow-card">
      <dt className="flex items-center gap-2.5 text-label text-text-secondary">
        <span
          aria-hidden="true"
          className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-brand-soft text-brand-strong"
        >
          <Icon className="size-4.5" />
        </span>
        {label}
      </dt>
      <dd
        className={cn(
          "text-display tabular-nums",
          muted ? "text-text-muted" : "text-text-primary",
        )}
      >
        {value}
      </dd>
      <dd className="flex flex-col gap-2 text-caption text-text-muted">
        {children}
      </dd>
      <dd className="mt-auto border-t border-border-subtle pt-2.5 text-caption text-text-muted">
        {scope}
      </dd>
    </div>
  );
}
