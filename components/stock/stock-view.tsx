"use client";

import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { cn } from "@/components/ui/cn";
import { CloseIcon } from "@/components/ui/icons";
import { canMarkAvailable } from "@/domains/vehicles/availability";
import {
  formatKm,
  formatPrice,
  groupByStatus,
  vehicleDetail,
  vehicleName,
  vehicleStatusLabel,
  type StockGroup,
  type StockVehicle,
} from "@/domains/vehicles/stock";

import {
  MarkAvailableDialog,
  type AvailabilitySettled,
} from "./mark-available-dialog";
import { NewVehicleDrawer, type VehicleCreated } from "./new-vehicle-drawer";
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
 * usa decenas de veces por sesión). Sin fotos inventadas, matches ni
 * interesados.
 *
 * "Nueva unidad" (H1.3B) abre el alta rápida en un drawer. Al crear, la
 * Server Action revalida la página, la lista trae la unidad nueva (en
 * preparación) y la vista la selecciona y la muestra.
 *
 * "Marcar disponible" (H1.3C), en el rail de una unidad en preparación, pide
 * confirmación y la pasa a disponible. La Server Action revalida la página:
 * la unidad cambia de grupo (sigue seleccionada), los conteos y el medidor
 * se recalculan, y la vista la muestra en la lista y devuelve el foco a la
 * lista, porque el botón que la movió ya no existe.
 */

/** Aviso de la última escritura (alta o disponibilidad). */
type Notice = Readonly<{ tone: "success" | "neutral"; message: string }>;

/**
 * Unidad a mostrar cuando la lista nueva llegue del loader: la recién creada,
 * al aparecer; la que se marcó disponible, al dejar "En preparación".
 */
type Reveal = Readonly<{
  vehicleId: string;
  until: "listed" | "leftPreparation";
}>;

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
  const [notice, setNotice] = useState<Notice | null>(null);
  const [reveal, setReveal] = useState<Reveal | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const selected =
    ordered.find((vehicle) => vehicle.id === selectedId) ?? ordered[0];

  // La unidad se muestra en la lista apenas llega del loader en su lugar
  // nuevo. Tras marcarla disponible, el foco vuelve a la lista.
  const revealedStatus = reveal
    ? ordered.find((vehicle) => vehicle.id === reveal.vehicleId)?.status
    : undefined;
  const revealReady =
    reveal !== null &&
    (reveal.until === "listed"
      ? revealedStatus !== undefined
      : revealedStatus !== "inPreparation");
  useEffect(() => {
    if (!reveal || !revealReady) return;
    document
      .getElementById(optionId(reveal.vehicleId))
      ?.scrollIntoView({ block: "nearest" });
    if (reveal.until === "leftPreparation") {
      listRef.current?.focus({ preventScroll: true });
    }
  }, [reveal, revealReady]);

  function onCreated(result: VehicleCreated) {
    setSelectedId(result.vehicleId);
    setNotice({ tone: "success", message: createdMessage(result) });
    setReveal({ vehicleId: result.vehicleId, until: "listed" });
  }

  function onAvailabilitySettled(
    vehicleId: string,
    result: AvailabilitySettled,
  ) {
    setNotice(availabilityNotice(result));
    setReveal({ vehicleId, until: "leftPreparation" });
  }

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
      <StockSummary
        title={title}
        vehicles={vehicles}
        action={<NewVehicleDrawer onCreated={onCreated} />}
      />

      <div className="grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)_17rem] gap-3 p-3 lg:grid-cols-[minmax(0,1fr)_23rem]">
        <div className="flex min-h-0 flex-col gap-3">
          <StockNotice notice={notice} onDismiss={() => setNotice(null)} />
          {groups.length === 0 ? (
            <EmptyStock />
          ) : (
            <div
              ref={listRef}
              role="listbox"
              aria-label="Unidades en stock, por estado"
              tabIndex={0}
              onKeyDown={onKeyDown}
              aria-activedescendant={
                selected ? optionId(selected.id) : undefined
              }
              className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto rounded-lg px-1 pt-1 pb-6 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring"
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
        </div>

        <aside
          aria-label="Unidad seleccionada"
          className="flex min-h-0 flex-col gap-3 overflow-y-auto pb-6"
        >
          {selected ? (
            <UnitContext
              vehicle={selected}
              action={
                canMarkAvailable(selected.status) ? (
                  <MarkAvailableDialog
                    key={selected.id}
                    vehicle={selected}
                    onSettled={onAvailabilitySettled}
                  />
                ) : null
              }
            />
          ) : (
            <EmptyUnitContext />
          )}
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

/** Alta: qué unidad entró y en qué estado. */
function createdMessage(created: VehicleCreated): string {
  return `Unidad creada: ${vehicleName(created)} ${created.year}, ${vehicleStatusLabel("inPreparation").toLowerCase()}.`;
}

/**
 * Disponibilidad: qué pasó con la unidad. Si ya no estaba en preparación
 * (otra persona la cambió antes) o no existe, se dice que no se cambió nada.
 */
function availabilityNotice(result: AvailabilitySettled): Notice {
  switch (result.status) {
    case "available":
      return {
        tone: "success",
        message: `Unidad disponible: ${vehicleName(result)} ${result.year}, lista para vender.`,
      };
    case "unchanged":
      return {
        tone: "neutral",
        message:
          result.current === "available"
            ? `${vehicleName(result)} ${result.year} ya estaba disponible. No se hizo ningún cambio.`
            : `${vehicleName(result)} ${result.year} ya no está en preparación: está ${vehicleStatusLabel(result.current).toLowerCase()}. No se hizo ningún cambio.`,
      };
    case "not_found":
      return {
        tone: "neutral",
        message:
          "No encontramos esa unidad en el stock. No se hizo ningún cambio.",
      };
  }
}

const NOTICE_TONE: Readonly<Record<Notice["tone"], string>> = {
  success: "border-success-border bg-success-soft text-success",
  neutral: "border-border-default bg-surface-2 text-text-secondary",
};

const NOTICE_DISMISS: Readonly<Record<Notice["tone"], string>> = {
  success: "hover:bg-success-border/40",
  neutral: "hover:bg-surface-3",
};

/**
 * Aviso de la última escritura. El texto también se anuncia por la región
 * `status`, que existe siempre.
 */
function StockNotice({
  notice,
  onDismiss,
}: {
  notice: Notice | null;
  onDismiss: () => void;
}) {
  return (
    <div role="status" className={notice ? undefined : "sr-only"}>
      {notice ? (
        <p
          className={cn(
            "flex items-start gap-2 rounded-md border py-2 pr-1.5 pl-3 text-label",
            NOTICE_TONE[notice.tone],
          )}
        >
          <span className={cn("min-w-0 flex-1 pt-0.5", LITERAL)}>
            {notice.message}
          </span>
          <button
            type="button"
            aria-label="Cerrar aviso"
            onClick={onDismiss}
            className={cn(
              "flex size-6 shrink-0 items-center justify-center rounded-sm focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-focus-ring",
              NOTICE_DISMISS[notice.tone],
            )}
          >
            <CloseIcon className="size-3.5" />
          </button>
        </p>
      ) : null}
    </div>
  );
}

/** Organización sin vehículos: estado vacío, sin datos de ejemplo. */
function EmptyStock() {
  return (
    <div className="flex flex-col items-center rounded-lg border border-border-subtle bg-surface-1 px-6 py-12 text-center shadow-card">
      <p className="text-heading text-text-primary">
        Todavía no hay unidades en stock
      </p>
      <p className="mt-1 max-w-md text-label font-normal text-text-muted">
        Cargá la primera con «Nueva unidad». Cada vehículo de la organización va
        a aparecer acá, agrupado por estado: disponibles, en preparación,
        reservadas y vendidas.
      </p>
    </div>
  );
}
