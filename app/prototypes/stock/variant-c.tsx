"use client";

import { useState, type KeyboardEvent } from "react";
import { cn } from "@/components/ui/cn";
import { CheckIcon } from "@/components/ui/icons";
import {
  formatKm,
  formatPrice,
  type StockVehicle,
  type VehicleStatus,
} from "@/domains/vehicles/stock";

import { countLabel, countsByStatus, STATUS_ORDER, unitsLabel } from "./_data";
import {
  LITERAL,
  PriceParts,
  STATUS_DOT,
  STATUS_EDGE,
  StatusChip,
} from "./_status";

/*
 * VARIANTE C — Stock Workspace (eje: composición lista + contexto). La lista
 * compacta es la fuente principal; el rail derecho muestra la unidad
 * seleccionada con lo único que existe hoy (identidad, estado, precio, km) y
 * deja visibles, vacíos y sin botones, los lugares que van a ocupar fotos
 * reales y compradores. Selección por click o ↑/↓, sin animación (se usa
 * decenas de veces por sesión).
 */

export function VariantC({ vehicles }: { vehicles: readonly StockVehicle[] }) {
  const [selectedId, setSelectedId] = useState(vehicles[0]?.id);
  const selected = vehicles.find((vehicle) => vehicle.id === selectedId);
  const counts = countsByStatus(vehicles);

  function onKeyDown(event: KeyboardEvent<HTMLUListElement>) {
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    event.preventDefault();
    event.stopPropagation();
    const index = vehicles.findIndex((vehicle) => vehicle.id === selectedId);
    const next = event.key === "ArrowDown" ? index + 1 : index - 1;
    const target = vehicles[Math.min(Math.max(next, 0), vehicles.length - 1)];
    if (target) {
      setSelectedId(target.id);
      document
        .getElementById(`c-${target.id}`)
        ?.scrollIntoView({ block: "nearest" });
    }
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="shrink-0 border-b border-border-subtle bg-surface-1 px-gutter pt-3 pb-3">
        <div className="flex items-baseline gap-2">
          <h1 className="text-title text-text-primary">Stock</h1>
          <span className="text-label text-text-muted tabular-nums">
            {unitsLabel(vehicles.length)}
          </span>
        </div>
        {vehicles.length > 0 ? (
          <div className="mt-2 flex flex-col gap-1.5">
            <div
              aria-hidden="true"
              className="flex h-1.5 w-full max-w-xl gap-0.5 overflow-hidden rounded-full"
            >
              {STATUS_ORDER.filter((s) => counts[s] > 0).map((status) => (
                <span
                  key={status}
                  className={cn("h-full", STATUS_EDGE[status])}
                  style={{ flexGrow: counts[status] }}
                />
              ))}
            </div>
            <ul className="flex flex-wrap gap-x-4 text-caption text-text-secondary tabular-nums">
              {STATUS_ORDER.map((status) => (
                <li key={status} className="flex items-center gap-1.5">
                  <span
                    aria-hidden="true"
                    className={cn("size-1.5 rounded-full", STATUS_DOT[status])}
                  />
                  {countLabel(status, counts[status])}
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </header>

      <div className="grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)_17rem] gap-3 p-3 lg:grid-cols-[minmax(0,1fr)_23rem]">
        <section
          aria-label="Unidades"
          className="flex min-h-0 flex-col overflow-hidden rounded-lg border border-border-subtle bg-surface-1 shadow-card"
        >
          <div className="flex h-9 shrink-0 items-center justify-between border-b-2 border-brand px-4 text-overline text-text-muted uppercase">
            <span>Unidad</span>
            <span>Precio · Km</span>
          </div>
          {vehicles.length === 0 ? (
            <EmptyList />
          ) : (
            <ul
              role="listbox"
              aria-label="Unidades en stock"
              tabIndex={0}
              onKeyDown={onKeyDown}
              aria-activedescendant={selected ? `c-${selected.id}` : undefined}
              className="min-h-0 flex-1 overflow-y-auto p-1.5 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-focus-ring"
            >
              {vehicles.map((vehicle) => (
                <UnitOption
                  key={vehicle.id}
                  vehicle={vehicle}
                  selected={vehicle.id === selectedId}
                  onSelect={() => setSelectedId(vehicle.id)}
                />
              ))}
            </ul>
          )}
        </section>

        <aside
          aria-label="Unidad seleccionada"
          className="flex min-h-0 flex-col gap-3 overflow-y-auto"
        >
          {selected ? <UnitContext vehicle={selected} /> : <EmptyContext />}
        </aside>
      </div>
    </div>
  );
}

function UnitOption({
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
  return (
    <li
      id={`c-${vehicle.id}`}
      role="option"
      aria-selected={selected}
      onClick={onSelect}
      className={cn(
        "flex h-14 cursor-default items-center gap-3 rounded-md px-3 transition-colors duration-150",
        selected ? "bg-brand-soft ring-1 ring-brand" : "hover:bg-surface-2",
      )}
    >
      <span
        aria-hidden="true"
        className={cn(
          "size-2 shrink-0 rounded-full",
          STATUS_DOT[vehicle.status],
        )}
      />
      <span className="min-w-0 flex-1">
        <span
          className={cn(
            "block truncate text-body font-semibold",
            sold ? "text-text-muted" : "text-text-primary",
          )}
        >
          {vehicle.brand} {vehicle.model}
        </span>
        <span
          className={cn("block truncate text-caption text-text-muted", LITERAL)}
        >
          {detail}
        </span>
      </span>
      <span className="flex shrink-0 flex-col items-end">
        <PriceParts
          label={vehicle.price ? formatPrice(vehicle.price) : undefined}
          sold={sold}
        />
        <span className="text-caption text-text-muted tabular-nums">
          {vehicle.km === undefined ? "Km sin dato" : formatKm(vehicle.km)}
        </span>
      </span>
    </li>
  );
}

const STEP_STATE: Record<VehicleStatus, string> = {
  available: "Disponible para vender",
  inPreparation: "Todavía no se entrega",
  reserved: "Comprometida con un comprador",
  sold: "Vendida · operación cerrada",
};

export function UnitContext({ vehicle }: { vehicle: StockVehicle }) {
  const sold = vehicle.status === "sold";
  return (
    <>
      <section className="rounded-lg border border-border-subtle bg-surface-1 p-4 shadow-card">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-overline text-text-muted uppercase">
              {vehicle.brand}
            </p>
            <h2
              className={cn(
                "truncate text-title",
                sold ? "text-text-muted" : "text-text-primary",
              )}
            >
              {vehicle.model}
            </h2>
            <p
              className={cn(
                "truncate text-label font-normal text-text-secondary",
                LITERAL,
              )}
            >
              {[vehicle.version, vehicle.year].filter(Boolean).join(" · ")}
            </p>
          </div>
          <StatusChip status={vehicle.status} />
        </div>
        <dl className="mt-4 grid grid-cols-2 gap-px overflow-hidden rounded-md bg-border-subtle">
          <div className="col-span-2 bg-surface-2 px-3 py-2.5">
            <dt className="text-caption text-text-muted">Precio publicado</dt>
            <dd className="mt-0.5">
              <PriceParts
                label={vehicle.price ? formatPrice(vehicle.price) : undefined}
                sold={sold}
                size="lg"
              />
            </dd>
          </div>
          <div className="bg-surface-2 px-3 py-2.5">
            <dt className="text-caption text-text-muted">Kilometraje</dt>
            <dd className="text-body text-text-primary tabular-nums">
              {vehicle.km === undefined ? (
                <span className="text-text-muted">Sin dato</span>
              ) : (
                formatKm(vehicle.km)
              )}
            </dd>
          </div>
          <div className="bg-surface-2 px-3 py-2.5">
            <dt className="text-caption text-text-muted">Año</dt>
            <dd className="text-body text-text-primary tabular-nums">
              {vehicle.year}
            </dd>
          </div>
        </dl>
      </section>

      <section className="rounded-lg border border-border-subtle bg-surface-1 p-4 shadow-card">
        <h3 className="text-label text-text-muted">Fotos reales</h3>
        <div className="mt-2 flex aspect-[16/9] items-center justify-center rounded-md border border-dashed border-border-strong bg-surface-2 px-6 text-center">
          <p className="text-caption text-text-muted">
            Esta unidad todavía no tiene fotos cargadas
          </p>
        </div>
      </section>

      <section className="rounded-lg border border-border-subtle bg-surface-1 p-4 shadow-card">
        <h3 className="text-label text-text-muted">Recorrido de la unidad</h3>
        <ol className="mt-3 flex flex-col">
          <Step
            done
            title="Unidad en stock"
            detail="Identidad, año y kilometraje"
          />
          <Step
            done={!sold}
            closed={sold}
            title="Disponibilidad"
            detail={STEP_STATE[vehicle.status]}
          />
          <Step pending title="Compradores potenciales" detail="Sin dato" />
          <Step pending last title="Próxima acción" detail="Sin dato" />
        </ol>
      </section>
    </>
  );
}

function Step({
  title,
  detail,
  done,
  closed,
  pending,
  last,
}: {
  title: string;
  detail: string;
  done?: boolean;
  closed?: boolean;
  pending?: boolean;
  last?: boolean;
}) {
  return (
    <li className="relative flex gap-3 pb-3 last:pb-0">
      {!last ? (
        <span
          aria-hidden="true"
          className="absolute top-5 bottom-0 left-[9px] w-px bg-border-default"
        />
      ) : null}
      <span
        aria-hidden="true"
        className={cn(
          "relative flex size-5 shrink-0 items-center justify-center rounded-full border",
          done && "border-brand bg-brand text-brand-contrast",
          closed && "border-border-strong bg-surface-3 text-text-muted",
          pending && "border-dashed border-border-strong bg-surface-1",
        )}
      >
        {done || closed ? (
          <CheckIcon className="size-3" strokeWidth={2.5} />
        ) : null}
      </span>
      <span className="min-w-0">
        <span
          className={cn(
            "block text-label",
            pending ? "text-text-muted" : "text-text-primary",
          )}
        >
          {title}
        </span>
        <span className="block text-caption text-text-muted">{detail}</span>
      </span>
    </li>
  );
}

function EmptyList() {
  return (
    <div className="flex flex-1 flex-col items-center justify-center px-6 py-12 text-center">
      <p className="text-heading text-text-primary">
        Todavía no hay unidades en stock
      </p>
      <p className="mt-1 max-w-sm text-label font-normal text-text-muted">
        Cada vehículo de la organización va a aparecer en esta lista con su
        estado, precio y kilometraje.
      </p>
    </div>
  );
}

export function EmptyContext() {
  return (
    <div className="flex flex-1 items-center justify-center rounded-lg border border-dashed border-border-strong px-6 text-center">
      <p className="text-label font-normal text-text-muted">
        Acá vas a ver el contexto de la unidad que elijas en la lista.
      </p>
    </div>
  );
}
