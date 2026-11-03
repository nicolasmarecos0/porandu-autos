import Link from "next/link";

import { cn } from "@/components/ui/cn";
import {
  METRICS_PERIOD_LABELS,
  METRICS_PERIOD_SHORT_LABELS,
  METRICS_PERIODS,
  type MetricsPeriodKind,
} from "@/domains/cockpit/metrics-period";

import { metricsPeriodHref } from "./links";

/*
 * Selector del período de las Métricas del salón (propuesta DEC-050 §3).
 * Server Component: el período viaja en la URL (`?period=`) y cambiarlo es
 * una navegación GET, sin Server Actions ni estado de cliente, así que se
 * comparte, se recarga y el botón atrás vuelve al anterior.
 *
 * - Cada período es un enlace; el activo lleva `aria-current="page"`. El
 *   nombre accesible es el completo ("Últimos 7 días"), que contiene el
 *   visible ("7 días").
 * - `prefetch={false}` (DEC-043 §6): pasar el mouse no dispara las
 *   lecturas agregadas. `scroll={false}`: cambiar el período no salta al
 *   inicio de la página.
 * - En un teléfono ocupa todo el ancho, en cuatro segmentos iguales de
 *   40 px de alto; desde `sm`, se ajusta a su contenido.
 */

export function PeriodPicker({ current }: { current: MetricsPeriodKind }) {
  return (
    <nav aria-label="Período" className="w-full sm:w-auto">
      <ul className="grid grid-cols-4 gap-0.5 rounded-lg border border-border-subtle bg-surface-3 p-0.5">
        {METRICS_PERIODS.map((kind) => {
          const active = kind === current;
          return (
            <li key={kind}>
              <Link
                href={metricsPeriodHref(kind)}
                prefetch={false}
                scroll={false}
                aria-current={active ? "page" : undefined}
                aria-label={METRICS_PERIOD_LABELS[kind]}
                className={cn(
                  "flex h-10 items-center justify-center rounded-md px-3 text-label font-semibold whitespace-nowrap transition-[background-color,color,box-shadow] duration-150 ease-out-strong focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-focus-ring sm:h-8",
                  active
                    ? "bg-surface-1 text-brand-strong shadow-sm"
                    : "text-text-secondary hover:bg-surface-2 hover:text-text-primary",
                )}
              >
                {METRICS_PERIOD_SHORT_LABELS[kind]}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
