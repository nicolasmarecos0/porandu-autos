import { cn } from "@/components/ui/cn";
import {
  formatKm,
  formatPrice,
  type StockVehicle,
} from "@/domains/vehicles/stock";

import { countLabel, countsByStatus, STATUS_ORDER, unitsLabel } from "./_data";
import { PriceParts, STATUS_DOT, StatusChip } from "./_status";

/*
 * VARIANTE A — Enterprise Inventory Table (eje: densidad tabular con
 * jerarquía). Sigue siendo una tabla: columnas con ancho fijo, filas de 64 px
 * siempre iguales (la identidad se centra con o sin versión), identidad en dos niveles,
 * precio partido con la moneda chica y vendidas atenuadas como cerradas.
 */

const HEAD = "px-4 py-2.5 text-overline uppercase";

export function VariantA({ vehicles }: { vehicles: readonly StockVehicle[] }) {
  const counts = countsByStatus(vehicles);
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="flex min-h-page-header shrink-0 flex-wrap items-center gap-x-5 gap-y-2 border-b border-border-subtle bg-surface-1 px-gutter py-3">
        <div className="flex items-baseline gap-2">
          <h1 className="text-title text-text-primary">Stock</h1>
          <span className="text-label text-text-muted tabular-nums">
            {unitsLabel(vehicles.length)}
          </span>
        </div>
        {vehicles.length > 0 ? (
          <ul className="flex flex-wrap items-center gap-x-4 gap-y-1 text-label text-text-secondary tabular-nums">
            {STATUS_ORDER.map((status) => (
              <li key={status} className="flex items-center gap-1.5">
                <span
                  aria-hidden="true"
                  className={cn("size-2 rounded-full", STATUS_DOT[status])}
                />
                {countLabel(status, counts[status])}
              </li>
            ))}
          </ul>
        ) : null}
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto p-gutter">
        {vehicles.length === 0 ? (
          <EmptyA />
        ) : (
          <div className="mx-auto max-w-[66rem] overflow-hidden rounded-lg border border-border-subtle bg-surface-1 shadow-card">
            <table className="w-full table-fixed border-collapse">
              <caption className="sr-only">Unidades en stock</caption>
              <TableHead />
              <tbody>
                {vehicles.map((vehicle) => {
                  const sold = vehicle.status === "sold";
                  return (
                    <tr
                      key={vehicle.id}
                      className={cn(
                        "h-16 border-t border-border-subtle transition-colors duration-150 first:border-t-0 hover:bg-surface-2",
                        sold && "bg-surface-2/60",
                      )}
                    >
                      <th
                        scope="row"
                        className="py-0 pr-4 pl-5 text-left font-normal"
                      >
                        <span
                          className={cn(
                            "block truncate text-body font-semibold",
                            sold ? "text-text-muted" : "text-text-primary",
                          )}
                        >
                          {vehicle.brand} {vehicle.model}
                        </span>
                        {vehicle.version ? (
                          <span className="block truncate text-caption text-text-muted">
                            {vehicle.version}
                          </span>
                        ) : null}
                      </th>
                      <td
                        className={cn(
                          "px-4 text-right text-body tabular-nums",
                          sold ? "text-text-muted" : "text-text-primary",
                        )}
                      >
                        {vehicle.year}
                      </td>
                      <td className="px-4 text-right text-body text-text-secondary tabular-nums">
                        {vehicle.km === undefined ? (
                          <span className="text-label text-text-muted">
                            Sin dato
                          </span>
                        ) : (
                          formatKm(vehicle.km)
                        )}
                      </td>
                      <td className="px-4 text-right">
                        <PriceParts
                          label={
                            vehicle.price
                              ? formatPrice(vehicle.price)
                              : undefined
                          }
                          sold={sold}
                        />
                      </td>
                      <td className="pr-4 pl-6">
                        <StatusChip status={vehicle.status} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

function TableHead() {
  return (
    <>
      <colgroup>
        <col />
        <col className="w-20" />
        <col className="w-32" />
        <col className="w-44" />
        <col className="w-40" />
      </colgroup>
      <thead className="sticky top-0 z-10 bg-surface-inverse text-text-inverse-muted">
        <tr>
          <th scope="col" className={cn(HEAD, "pl-5 text-left")}>
            Unidad
          </th>
          <th scope="col" className={cn(HEAD, "text-right")}>
            Año
          </th>
          <th scope="col" className={cn(HEAD, "text-right")}>
            Kilometraje
          </th>
          <th scope="col" className={cn(HEAD, "text-right")}>
            Precio
          </th>
          <th scope="col" className={cn(HEAD, "pl-6 text-left")}>
            Estado
          </th>
        </tr>
      </thead>
    </>
  );
}

function EmptyA() {
  return (
    <div className="mx-auto max-w-[66rem] overflow-hidden rounded-lg border border-border-subtle bg-surface-1 shadow-card">
      <table className="w-full table-fixed border-collapse">
        <caption className="sr-only">Unidades en stock</caption>
        <TableHead />
        <tbody>
          <tr>
            <td colSpan={5} className="px-5 py-12 text-center">
              <p className="text-heading text-text-primary">
                Todavía no hay unidades en stock
              </p>
              <p className="mx-auto mt-1 max-w-md text-label text-text-muted">
                Cada vehículo de la organización va a aparecer en esta tabla con
                su estado, precio y kilometraje.
              </p>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}
