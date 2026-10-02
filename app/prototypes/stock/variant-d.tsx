"use client";

import { useState, type KeyboardEvent } from "react";
import { cn } from "@/components/ui/cn";
import {
  formatKm,
  formatPrice,
  type StockVehicle,
  type VehicleStatus,
} from "@/domains/vehicles/stock";

import { countsByStatus, STATUS_ORDER, unitsLabel } from "./_data";
import { LITERAL, PriceParts, STATUS_DOT, STATUS_EDGE } from "./_status";
import { UnitContext } from "./variant-c";

/*
 * VARIANTE D — Híbrida (riff sobre B + C).
 * - Arriba (de C): resumen ejecutivo con el medidor de distribución por
 *   estado y la leyenda de conteos, ahora como cuatro conteos legibles.
 * - Izquierda (de B): la lista agrupada por etapa de stock, filas-unidad con
 *   canto de estado. La sección ya dice el estado: la fila no repite el chip.
 *   Lo vendible primero; las vendidas al final, separadas como historial.
 * - Derecha (de C): el contexto de la unidad seleccionada (identidad,
 *   precio, km, fotos reales pendientes, recorrido).
 * Selección por click o ↑/↓ en el orden visual, sin animación.
 */

const GROUP: Record<VehicleStatus, { title: string; hint: string }> = {
  available: { title: "Disponibles", hint: "Listas para vender" },
  inPreparation: { title: "En preparación", hint: "Todavía no se entregan" },
  reserved: { title: "Reservadas", hint: "Comprometidas con un comprador" },
  sold: { title: "Vendidas", hint: "Operaciones cerradas" },
};

const COUNT_TEXT: Record<VehicleStatus, string> = {
  available: "text-success",
  inPreparation: "text-warning",
  reserved: "text-brand-strong",
  sold: "text-text-muted",
};

export function VariantD({ vehicles }: { vehicles: readonly StockVehicle[] }) {
  const counts = countsByStatus(vehicles);
  const groups = STATUS_ORDER.filter((status) => counts[status] > 0).map(
    (status) => ({
      status,
      units: vehicles.filter((vehicle) => vehicle.status === status),
    }),
  );
  // Orden visual (agrupado): es el que recorre el teclado.
  const ordered = groups.flatMap((group) => group.units);
  const [selectedId, setSelectedId] = useState(ordered[0]?.id);
  const selected = ordered.find((vehicle) => vehicle.id === selectedId);

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    event.preventDefault();
    const index = ordered.findIndex((vehicle) => vehicle.id === selectedId);
    const next = event.key === "ArrowDown" ? index + 1 : index - 1;
    const target = ordered[Math.min(Math.max(next, 0), ordered.length - 1)];
    if (target) {
      setSelectedId(target.id);
      document
        .getElementById(`d-${target.id}`)
        ?.scrollIntoView({ block: "nearest" });
    }
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <StockSummary vehicles={vehicles} counts={counts} />

      <div className="grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)_17rem] gap-3 p-3 lg:grid-cols-[minmax(0,1fr)_23rem]">
        {vehicles.length === 0 ? (
          <EmptyList />
        ) : (
          <div
            role="listbox"
            aria-label="Unidades en stock, por etapa"
            tabIndex={0}
            onKeyDown={onKeyDown}
            aria-activedescendant={selected ? `d-${selected.id}` : undefined}
            className="flex min-h-0 flex-col gap-5 overflow-y-auto rounded-lg px-1 pt-1 pb-6 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring"
          >
            {groups.map(({ status, units }) => (
              <section
                key={status}
                role="group"
                aria-labelledby={`d-group-${status}`}
                className={cn(
                  status === "sold" &&
                    "mt-2 border-t border-dashed border-border-strong pt-5",
                )}
              >
                <GroupHeader status={status} count={units.length} />
                <div className="mt-2 flex flex-col gap-1.5">
                  {units.map((vehicle) => (
                    <UnitRow
                      key={vehicle.id}
                      vehicle={vehicle}
                      selected={vehicle.id === selectedId}
                      onSelect={() => setSelectedId(vehicle.id)}
                    />
                  ))}
                </div>
              </section>
            ))}
          </div>
        )}

        <aside
          aria-label="Unidad seleccionada"
          className="flex min-h-0 flex-col gap-3 overflow-y-auto pb-6"
        >
          {selected ? <UnitContext vehicle={selected} /> : <EmptyRail />}
        </aside>
      </div>
    </div>
  );
}

function StockSummary({
  vehicles,
  counts,
}: {
  vehicles: readonly StockVehicle[];
  counts: Record<VehicleStatus, number>;
}) {
  return (
    <header className="shrink-0 border-b border-border-subtle bg-surface-1 px-gutter pt-3 pb-4">
      <div className="flex items-baseline gap-2">
        <h1 className="text-title text-text-primary">Stock</h1>
        <span className="text-label text-text-muted tabular-nums">
          {unitsLabel(vehicles.length)}
        </span>
      </div>
      {vehicles.length > 0 ? (
        <div className="mt-3 flex flex-col gap-2.5">
          <div
            role="img"
            aria-label={STATUS_ORDER.map(
              (s) => `${counts[s]} ${GROUP[s].title.toLowerCase()}`,
            ).join(", ")}
            className="flex h-2 w-full gap-0.5 overflow-hidden rounded-full bg-surface-3"
          >
            {STATUS_ORDER.filter((s) => counts[s] > 0).map((status) => (
              <span
                key={status}
                className={cn(
                  "h-full first:rounded-l-full last:rounded-r-full",
                  STATUS_EDGE[status],
                )}
                style={{ flexGrow: counts[status] }}
              />
            ))}
          </div>
          <dl className="flex flex-wrap gap-x-10 gap-y-1">
            {STATUS_ORDER.map((status) => (
              <div key={status} className="flex items-baseline gap-2">
                <dd
                  className={cn("text-metric tabular-nums", COUNT_TEXT[status])}
                >
                  {counts[status]}
                </dd>
                <dt className="flex items-center gap-1.5 text-label text-text-secondary">
                  <span
                    aria-hidden="true"
                    className={cn("size-2 rounded-full", STATUS_DOT[status])}
                  />
                  {GROUP[status].title}
                </dt>
              </div>
            ))}
          </dl>
        </div>
      ) : null}
    </header>
  );
}

function GroupHeader({
  status,
  count,
}: {
  status: VehicleStatus;
  count: number;
}) {
  return (
    <div className="flex items-center gap-2 px-1">
      <span
        aria-hidden="true"
        className={cn("size-2 rounded-full", STATUS_DOT[status])}
      />
      <h2
        id={`d-group-${status}`}
        className={cn(
          "text-overline uppercase",
          status === "sold" ? "text-text-muted" : "text-text-primary",
        )}
      >
        {GROUP[status].title}
      </h2>
      <span className="text-overline text-text-muted tabular-nums">
        {count}
      </span>
      <span className="text-caption text-text-muted">
        · {GROUP[status].hint}
      </span>
    </div>
  );
}

function UnitRow({
  vehicle,
  selected,
  onSelect,
}: {
  vehicle: StockVehicle;
  selected: boolean;
  onSelect: () => void;
}) {
  const sold = vehicle.status === "sold";
  const detail = [vehicle.version, vehicle.year].filter(Boolean).join(" · ");
  const km = vehicle.km === undefined ? "Km sin dato" : formatKm(vehicle.km);
  return (
    <div
      id={`d-${vehicle.id}`}
      role="option"
      aria-selected={selected}
      onClick={onSelect}
      className={cn(
        "relative flex h-16 cursor-default items-center gap-4 overflow-hidden rounded-md pr-4 pl-5 transition-[background-color,box-shadow] duration-150",
        selected
          ? "bg-brand-soft shadow-card ring-2 ring-brand"
          : sold
            ? "bg-surface-2 ring-1 ring-border-subtle hover:ring-border-strong"
            : "bg-surface-1 shadow-card ring-1 ring-border-subtle hover:ring-border-strong",
      )}
    >
      <span
        aria-hidden="true"
        className={cn(
          "absolute inset-y-0 left-0 w-1",
          STATUS_EDGE[vehicle.status],
        )}
      />
      <div className="min-w-0 flex-1">
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
      <div className="hidden w-28 shrink-0 lg:block">
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
      <div className="flex w-40 shrink-0 flex-col items-end">
        <PriceParts
          label={vehicle.price ? formatPrice(vehicle.price) : undefined}
          sold={sold}
          size="lg"
        />
        <span className="text-caption text-text-muted tabular-nums lg:hidden">
          {km}
        </span>
      </div>
    </div>
  );
}

function EmptyList() {
  return (
    <div className="flex flex-col items-center self-start rounded-lg border border-border-subtle bg-surface-1 px-6 py-12 text-center shadow-card">
      <p className="text-heading text-text-primary">
        Todavía no hay unidades en stock
      </p>
      <p className="mt-1 max-w-md text-label font-normal text-text-muted">
        Cada vehículo de la organización va a aparecer acá, agrupado por etapa:
        disponibles, en preparación, reservadas y vendidas.
      </p>
    </div>
  );
}

function EmptyRail() {
  return (
    <div className="rounded-lg border border-dashed border-border-strong px-5 py-8 text-center">
      <p className="text-label font-normal text-text-muted">
        Al elegir una unidad de la lista, acá vas a ver su precio, kilometraje y
        recorrido.
      </p>
    </div>
  );
}
