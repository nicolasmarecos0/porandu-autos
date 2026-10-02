import type { ReactNode } from "react";
import { cn } from "@/components/ui/cn";
import {
  countByStatus,
  STOCK_GROUPS,
  unitsLabel,
  type StockVehicle,
} from "@/domains/vehicles/stock";

import { STATUS_DOT, STATUS_EDGE, STATUS_TEXT } from "./stock-status";

/**
 * Encabezado de Stock: total de unidades y, si hay alguna, la distribución
 * real por estado (medidor segmentado y conteos derivados de la lista). Con
 * 0 unidades no hay medidor ni conteos en cero. `action` es la acción
 * principal de la superficie (H1.3B: "Nueva unidad"), a la derecha del
 * título.
 */
export function StockSummary({
  title,
  vehicles,
  action,
}: {
  title: string;
  vehicles: readonly StockVehicle[];
  action?: ReactNode;
}) {
  const counts = countByStatus(vehicles);
  return (
    <header className="shrink-0 border-b border-border-subtle bg-surface-1 px-gutter pt-3 pb-4">
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-baseline gap-2">
          <h1 className="text-title text-text-primary">{title}</h1>
          <span className="text-label text-text-muted tabular-nums">
            · {unitsLabel(vehicles.length)}
          </span>
        </div>
        {action}
      </div>
      {vehicles.length > 0 ? (
        <div className="mt-3 flex flex-col gap-2.5">
          <div
            role="img"
            aria-label={`Distribución del stock: ${STOCK_GROUPS.map(
              ({ status, title: group }) =>
                `${counts[status]} ${group.toLowerCase()}`,
            ).join(", ")}`}
            className="flex h-2 w-full gap-0.5 overflow-hidden rounded-full bg-surface-3"
          >
            {STOCK_GROUPS.filter(({ status }) => counts[status] > 0).map(
              ({ status }) => (
                <span
                  key={status}
                  className={cn("h-full", STATUS_EDGE[status])}
                  style={{ flexGrow: counts[status] }}
                />
              ),
            )}
          </div>
          <dl className="flex flex-wrap gap-x-10 gap-y-1">
            {STOCK_GROUPS.map(({ status, title: group }) => (
              // dt primero en el DOM; el número se ve primero.
              <div
                key={status}
                className="flex flex-row-reverse items-baseline justify-end gap-2"
              >
                <dt className="flex items-center gap-1.5 text-label text-text-secondary">
                  <span
                    aria-hidden="true"
                    className={cn("size-2 rounded-full", STATUS_DOT[status])}
                  />
                  {group}
                </dt>
                <dd
                  className={cn(
                    "text-metric tabular-nums",
                    STATUS_TEXT[status],
                  )}
                >
                  {counts[status]}
                </dd>
              </div>
            ))}
          </dl>
        </div>
      ) : null}
    </header>
  );
}
