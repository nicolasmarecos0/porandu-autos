import { cn } from "@/components/ui/cn";
import {
  formatKm,
  formatPrice,
  type StockVehicle,
  type VehicleStatus,
} from "@/domains/vehicles/stock";

import { countLabel, countsByStatus, STATUS_ORDER, unitsLabel } from "./_data";
import { LITERAL, PriceParts, STATUS_EDGE, StatusChip } from "./_status";

/*
 * VARIANTE B — Inventory Rows (eje: cada unidad como objeto físico, agrupada
 * por disponibilidad). Filas-card de 68 px con canto de estado, identidad en
 * dos líneas ("Toyota Hilux" / "SRV 2.8 4x4 AT · 2025") y bloques rotulados
 * de km y precio. Las secciones ordenan la lectura comercial (vendible →
 * cerrada) sin filtrar nada; dentro de cada una se respeta el orden del
 * loader. Las vendidas van al final, planas y atenuadas.
 */

const SECTION_TITLE: Record<VehicleStatus, string> = {
  available: "Disponibles",
  inPreparation: "En preparación",
  reserved: "Reservadas",
  sold: "Vendidas",
};

export function VariantB({ vehicles }: { vehicles: readonly StockVehicle[] }) {
  const counts = countsByStatus(vehicles);
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="flex min-h-page-header shrink-0 flex-wrap items-center gap-x-6 gap-y-1 border-b border-border-subtle bg-surface-1 px-gutter py-3">
        <h1 className="text-title text-text-primary">Stock</h1>
        {vehicles.length > 0 ? (
          <p className="text-body text-text-secondary tabular-nums">
            <span className="font-semibold text-success">
              {countLabel("available", counts.available)}
            </span>{" "}
            para vender de {unitsLabel(vehicles.length)}
          </p>
        ) : null}
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto p-gutter">
        {vehicles.length === 0 ? (
          <EmptyB />
        ) : (
          <div className="mx-auto flex max-w-[72rem] flex-col gap-6 pb-16">
            {STATUS_ORDER.filter((status) => counts[status] > 0).map(
              (status) => (
                <section key={status} aria-labelledby={`b-${status}`}>
                  <h2
                    id={`b-${status}`}
                    className="mb-2 flex items-baseline gap-2 px-1 text-overline text-text-muted uppercase"
                  >
                    {SECTION_TITLE[status]}
                    <span className="tabular-nums">{counts[status]}</span>
                  </h2>
                  <ul className="flex flex-col gap-1.5">
                    {vehicles
                      .filter((vehicle) => vehicle.status === status)
                      .map((vehicle) => (
                        <UnitRow key={vehicle.id} vehicle={vehicle} />
                      ))}
                  </ul>
                </section>
              ),
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function UnitRow({ vehicle }: { vehicle: StockVehicle }) {
  const sold = vehicle.status === "sold";
  const detail = [vehicle.version, vehicle.year].filter(Boolean).join(" · ");
  return (
    <li
      className={cn(
        "relative grid h-17 grid-cols-[minmax(0,1fr)_7.5rem_10.5rem_9rem] items-center gap-4 overflow-hidden rounded-md pr-4 pl-5",
        sold
          ? "border border-border-subtle bg-surface-2"
          : "bg-surface-1 shadow-card ring-1 ring-border-subtle",
      )}
    >
      <span
        aria-hidden="true"
        className={cn(
          "absolute inset-y-0 left-0 w-1",
          STATUS_EDGE[vehicle.status],
        )}
      />
      <div className="min-w-0">
        <p
          className={cn(
            "truncate text-heading",
            sold ? "text-text-muted" : "text-text-primary",
          )}
        >
          {vehicle.brand} {vehicle.model}
        </p>
        <p
          className={cn(
            "truncate text-label font-normal text-text-muted",
            LITERAL,
          )}
        >
          {detail}
        </p>
      </div>
      <div>
        <p className="text-caption text-text-muted">Kilometraje</p>
        <p
          className={cn(
            "text-body tabular-nums",
            vehicle.km === undefined || sold
              ? "text-text-muted"
              : "text-text-primary",
          )}
        >
          {vehicle.km === undefined ? "Sin dato" : formatKm(vehicle.km)}
        </p>
      </div>
      <div className="text-right">
        <p className="text-caption text-text-muted">Precio</p>
        <PriceParts
          label={vehicle.price ? formatPrice(vehicle.price) : undefined}
          sold={sold}
          size="lg"
        />
      </div>
      <div className="flex justify-end">
        <StatusChip status={vehicle.status} />
      </div>
    </li>
  );
}

function EmptyB() {
  return (
    <div className="mx-auto max-w-[72rem]">
      <div className="flex h-17 items-center rounded-md border border-dashed border-border-strong px-5">
        <div>
          <p className="text-heading text-text-primary">
            Todavía no hay unidades en stock
          </p>
          <p className="text-label font-normal text-text-muted">
            Cada vehículo de la organización va a aparecer acá como una fila,
            con su estado, kilometraje y precio.
          </p>
        </div>
      </div>
    </div>
  );
}
