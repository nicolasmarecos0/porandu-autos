"use client";

import { useState, type KeyboardEvent } from "react";
import { cn } from "@/components/ui/cn";
import {
  formatKm,
  formatPrice,
  groupByStatus,
  vehicleDetail,
  vehicleName,
  type StockGroup,
  type StockVehicle,
} from "@/domains/vehicles/stock";

import { LITERAL, PriceParts, STATUS_DOT, STATUS_EDGE } from "./stock-status";
import { StockSummary } from "./stock-summary";
import { EmptyUnitContext, UnitContext } from "./unit-context";

/*
 * Stock Surface v0.1 (H1.3A): inventario vivo de la organización activa, tal
 * como lo trae el loader de la página (PostgreSQL, tenant-scoped).
 *
 *   ┌ resumen: total · medidor por estado · conteos ─────────────┐
 *   │ lista agrupada por estado (filas-unidad) │ contexto de la   │
 *   │ disponibles → preparación → reservadas   │ unidad elegida   │
 *   │ ┄┄ vendidas (cerradas, atenuadas) ┄┄     │                  │
 *   └──────────────────────────────────────────┴──────────────────┘
 *
 * Master-detail: la lista es la fuente principal; el rail no abre otro
 * módulo. Selección por click o ↑/↓ en el orden visual, sin animación (se
 * usa decenas de veces por sesión). Solo lectura: sin fotos inventadas,
 * matches, interesados ni acciones.
 */

export function StockView({
  title,
  vehicles,
}: {
  title: string;
  vehicles: readonly StockVehicle[];
}) {
  const groups = groupByStatus(vehicles);
  // El orden visual (agrupado) es el que recorre el teclado.
  const ordered = groups.flatMap((group) => group.vehicles);
  const [selectedId, setSelectedId] = useState(ordered[0]?.id);
  const selected =
    ordered.find((vehicle) => vehicle.id === selectedId) ?? ordered[0];

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    event.preventDefault();
    const index = ordered.findIndex((vehicle) => vehicle.id === selected?.id);
    const next = event.key === "ArrowDown" ? index + 1 : index - 1;
    const target = ordered[Math.min(Math.max(next, 0), ordered.length - 1)];
    if (!target) return;
    setSelectedId(target.id);
    document
      .getElementById(optionId(target.id))
      ?.scrollIntoView({ block: "nearest" });
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <StockSummary title={title} vehicles={vehicles} />

      <div className="grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)_17rem] gap-3 p-3 lg:grid-cols-[minmax(0,1fr)_23rem]">
        {groups.length === 0 ? (
          <EmptyStock />
        ) : (
          <div
            role="listbox"
            aria-label="Unidades en stock, por estado"
            tabIndex={0}
            onKeyDown={onKeyDown}
            aria-activedescendant={selected ? optionId(selected.id) : undefined}
            className="flex min-h-0 flex-col gap-5 overflow-y-auto rounded-lg px-1 pt-1 pb-6 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring"
          >
            {groups.map((group) => (
              <GroupSection
                key={group.status}
                group={group}
                selectedId={selected?.id}
                onSelect={setSelectedId}
              />
            ))}
          </div>
        )}

        <aside
          aria-label="Unidad seleccionada"
          className="flex min-h-0 flex-col gap-3 overflow-y-auto pb-6"
        >
          {selected ? <UnitContext vehicle={selected} /> : <EmptyUnitContext />}
        </aside>
      </div>
    </div>
  );
}

function optionId(vehicleId: string): string {
  return `stock-unit-${vehicleId}`;
}

function GroupSection({
  group,
  selectedId,
  onSelect,
}: {
  group: StockGroup;
  selectedId: string | undefined;
  onSelect: (id: string) => void;
}) {
  const closed = group.status === "sold";
  const headingId = `stock-group-${group.status}`;
  return (
    <section
      role="group"
      aria-labelledby={headingId}
      className={cn(
        closed && "mt-2 border-t border-dashed border-border-strong pt-5",
      )}
    >
      <div className="flex items-center gap-2 px-1">
        <span
          aria-hidden="true"
          className={cn("size-2 rounded-full", STATUS_DOT[group.status])}
        />
        <h2
          id={headingId}
          className={cn(
            "text-overline uppercase",
            closed ? "text-text-muted" : "text-text-primary",
          )}
        >
          {group.title}
        </h2>
        <span className="text-overline text-text-muted tabular-nums">
          {group.vehicles.length}
        </span>
        <span className="truncate text-caption text-text-muted">
          · {group.hint}
        </span>
      </div>
      <div className="mt-2 flex flex-col gap-1.5">
        {group.vehicles.map((vehicle) => (
          <UnitRow
            key={vehicle.id}
            vehicle={vehicle}
            selected={vehicle.id === selectedId}
            onSelect={() => onSelect(vehicle.id)}
          />
        ))}
      </div>
    </section>
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
  const price = vehicle.price ? formatPrice(vehicle.price) : undefined;
  return (
    <div
      id={optionId(vehicle.id)}
      role="option"
      aria-selected={selected}
      onClick={onSelect}
      className={cn(
        "relative flex h-16 cursor-default items-center gap-4 overflow-hidden rounded-md pr-4 pl-5 transition-[background-color,box-shadow] duration-150 ease-out",
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
          {vehicleName(vehicle)}
        </p>
        <p
          className={cn(
            "truncate text-label font-normal text-text-muted",
            LITERAL,
          )}
        >
          {vehicleDetail(vehicle)}
        </p>
      </div>
      {/* Desktop: km en su bloque. Tablet: debajo del precio. */}
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
        <PriceParts label={price} muted={sold} size="lg" />
        <span className="text-caption text-text-muted tabular-nums lg:hidden">
          {vehicle.km === undefined ? "Km sin dato" : formatKm(vehicle.km)}
        </span>
      </div>
    </div>
  );
}

/** Organización sin vehículos: estado vacío, sin datos de ejemplo ni alta. */
function EmptyStock() {
  return (
    <div className="flex flex-col items-center self-start rounded-lg border border-border-subtle bg-surface-1 px-6 py-12 text-center shadow-card">
      <p className="text-heading text-text-primary">
        Todavía no hay unidades en stock
      </p>
      <p className="mt-1 max-w-md text-label font-normal text-text-muted">
        Cada vehículo de la organización va a aparecer acá, agrupado por estado:
        disponibles, en preparación, reservadas y vendidas.
      </p>
    </div>
  );
}
