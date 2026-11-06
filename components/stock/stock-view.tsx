"use client";

import {
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/components/ui/cn";
import { CloseIcon } from "@/components/ui/icons";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import {
  stockTransitionFor,
  VEHICLE_TRANSITION_COPY,
  VEHICLE_TRANSITION_PENDING,
  type StockTransitionId,
} from "@/domains/vehicles/lifecycle";
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

import { NewVehicleDrawer, type VehicleCreated } from "./new-vehicle-drawer";
import { LITERAL, PriceParts, STATUS_DOT, STATUS_EDGE } from "./stock-status";
import { StockSummary } from "./stock-summary";
import { TransitionIcon } from "./transition-icon";
import { EmptyUnitContext, UnitContext } from "./unit-context";
import { useVehicleLifecycle } from "./use-vehicle-lifecycle";
import {
  VehicleTransitionDialog,
  type TransitionRequest,
} from "./vehicle-transition-dialog";

/*
 * Stock Surface v0.1 (H1.3A) con el ciclo de vida de las unidades (Hito 19,
 * propuesta DEC-051): inventario vivo de la organización activa, tal como
 * lo trae el loader de la página (PostgreSQL, tenant-scoped).
 *
 *   ┌ resumen: total · medidor por estado · conteos ─────────────────┐
 *   │ lista agrupada por estado            │ contexto de la unidad   │
 *   │ ┌ Hilux · SRV · 2025  USD 49.900 [Reservar] │ elegida (md+)    │
 *   │ disponibles → preparación → reservadas       │                  │
 *   │ ┄┄ vendidas (cerradas, atenuadas) ┄┄         │                  │
 *   └──────────────────────────────────────┴─────────────────────────┘
 *
 * - Cada unidad tiene su acción rápida: "Poner en salón" en preparación,
 *   "Reservar" disponible y "Liberar" reservada; una vendida no ofrece
 *   ninguna. Pide confirmación (alertdialog) y guarda de forma optimista:
 *   la unidad cambia de grupo al instante con "Guardando…", y si el
 *   servidor no hace el pase vuelve sola, con el aviso de qué pasó.
 * - Master-detail desde md: la lista a la izquierda y el contexto de la
 *   unidad elegida a la derecha, con la misma acción. En el teléfono la
 *   lista ocupa todo el ancho y tocar una unidad abre su contexto en una
 *   hoja inferior.
 * - Selección por click o ↑/↓ en el orden visual, sin animación (se usa
 *   decenas de veces por sesión). Sin fotos inventadas, matches ni
 *   interesados.
 * - "Nueva unidad" (H1.3B) abre el alta rápida en un drawer. Al crear, la
 *   Server Action revalida la página, la lista trae la unidad nueva (en
 *   preparación) y la vista la selecciona y la muestra.
 */

/** Aviso de la última escritura (alta o ciclo de vida). */
type Notice = Readonly<{
  tone: "success" | "neutral" | "error";
  message: string;
}>;

/** Desde md (48rem) el contexto vive en el rail; antes, en una hoja. */
const RAIL_QUERY = "(min-width: 48rem)";

export function StockView({
  title,
  vehicles,
}: {
  title: string;
  vehicles: readonly StockVehicle[];
}) {
  const [notice, setNotice] = useState<Notice | null>(null);
  const lifecycle = useVehicleLifecycle(vehicles, setNotice);
  const groups = groupByStatus(lifecycle.vehicles);
  // El orden visual (agrupado) es el que recorre el teclado.
  const ordered = groups.flatMap((group) => group.vehicles);
  const [selectedId, setSelectedId] = useState(ordered[0]?.id);
  const [revealId, setRevealId] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<TransitionRequest | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  // Al confirmar, el foco va a la fila de la unidad en su grupo nuevo.
  const focusAfterConfirm = useRef<string | null>(null);
  const selected =
    ordered.find((vehicle) => vehicle.id === selectedId) ?? ordered[0];

  // La unidad se muestra en la lista apenas llega del loader (alta) o
  // apenas cambia de grupo (ciclo de vida, optimista).
  const revealed = revealId
    ? ordered.some((vehicle) => vehicle.id === revealId)
    : false;
  useEffect(() => {
    if (!revealId || !revealed) return;
    document
      .getElementById(optionId(revealId))
      ?.scrollIntoView({ block: "nearest" });
  }, [revealId, revealed, lifecycle.vehicles]);

  function onCreated(result: VehicleCreated) {
    setSelectedId(result.vehicleId);
    setNotice({ tone: "success", message: createdMessage(result) });
    setRevealId(result.vehicleId);
  }

  function requestTransition(
    vehicle: StockVehicle,
    transition: StockTransitionId,
  ) {
    if (lifecycle.saving.has(vehicle.id)) return;
    setSelectedId(vehicle.id);
    setConfirming({ vehicle, transition });
  }

  function confirmTransition(request: TransitionRequest) {
    setConfirming(null);
    setSheetOpen(false);
    const vehicle = lifecycle.vehicles.find(
      (unit) => unit.id === request.vehicle.id,
    );
    if (!vehicle) return;
    // El aviso anterior ya no aplica: el nuevo llega con la respuesta.
    setNotice(null);
    setRevealId(vehicle.id);
    focusAfterConfirm.current = vehicle.id;
    lifecycle.run(vehicle, request.transition);
  }

  function select(vehicle: StockVehicle) {
    setSelectedId(vehicle.id);
    // En el teléfono el contexto no tiene rail: se abre en una hoja.
    if (!window.matchMedia(RAIL_QUERY).matches) setSheetOpen(true);
  }

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    const index = ordered.findIndex((vehicle) => vehicle.id === selected?.id);
    if (index === -1) return;
    event.preventDefault();
    const next = event.key === "ArrowDown" ? index + 1 : index - 1;
    const target = ordered[Math.min(Math.max(next, 0), ordered.length - 1)];
    if (!target) return;
    setSelectedId(target.id);
    const element = document.getElementById(optionId(target.id));
    element?.focus();
    element?.scrollIntoView({ block: "nearest" });
  }

  const contextAction = (vehicle: StockVehicle) => (
    <TransitionButton
      vehicle={vehicle}
      saving={lifecycle.saving.has(vehicle.id)}
      onRequest={requestTransition}
      size="full"
    />
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <StockSummary
        title={title}
        vehicles={lifecycle.vehicles}
        action={<NewVehicleDrawer onCreated={onCreated} />}
      />

      <div className="grid min-h-0 flex-1 grid-cols-1 gap-3 p-3 md:grid-cols-[minmax(0,1fr)_17rem] lg:grid-cols-[minmax(0,1fr)_23rem]">
        <div className="flex min-h-0 flex-col gap-3">
          <StockNotice notice={notice} onDismiss={() => setNotice(null)} />
          {groups.length === 0 ? (
            <EmptyStock />
          ) : (
            <div
              aria-label="Unidades en stock, por estado"
              role="region"
              onKeyDown={onKeyDown}
              className="@container flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto rounded-lg px-1 pt-1 pb-6"
            >
              {groups.map((group) => (
                <GroupSection
                  key={group.status}
                  group={group}
                  selectedId={selected?.id}
                  saving={lifecycle.saving}
                  onSelect={select}
                  onRequest={requestTransition}
                />
              ))}
            </div>
          )}
        </div>

        <aside
          id="stock-unit-context"
          aria-label="Unidad seleccionada"
          className="flex min-h-0 flex-col gap-3 overflow-y-auto pb-6 max-md:hidden"
        >
          {selected ? (
            <UnitContext vehicle={selected} action={contextAction(selected)} />
          ) : (
            <EmptyUnitContext />
          )}
        </aside>
      </div>

      {/* Teléfono: el contexto de la unidad, en una hoja inferior. */}
      <Sheet
        open={sheetOpen && selected !== undefined}
        onOpenChange={setSheetOpen}
      >
        {selected ? (
          <SheetContent aria-label={vehicleName(selected)}>
            <SheetTitle className="sr-only">
              {vehicleName(selected)} · {vehicleStatusLabel(selected.status)}
            </SheetTitle>
            <div className="flex flex-col gap-3 p-4 pt-12">
              <UnitContext
                vehicle={selected}
                action={contextAction(selected)}
              />
            </div>
          </SheetContent>
        ) : null}
      </Sheet>

      <VehicleTransitionDialog
        request={confirming}
        onCancel={() => setConfirming(null)}
        onConfirm={confirmTransition}
        onCloseAutoFocus={(event) => {
          // Confirmada, la unidad cambió de grupo: el foco va a su fila, en su
          // lugar nuevo, y no a un botón que ya no está ahí. Cancelada, Radix
          // lo devuelve a donde estaba.
          const vehicleId = focusAfterConfirm.current;
          if (!vehicleId) return;
          focusAfterConfirm.current = null;
          event.preventDefault();
          document.getElementById(optionId(vehicleId))?.focus();
        }}
      />
    </div>
  );
}

function optionId(vehicleId: string): string {
  return `stock-unit-${vehicleId}`;
}

function GroupSection({
  group,
  selectedId,
  saving,
  onSelect,
  onRequest,
}: {
  group: StockGroup;
  selectedId: string | undefined;
  saving: ReadonlySet<string>;
  onSelect: (vehicle: StockVehicle) => void;
  onRequest: (vehicle: StockVehicle, transition: StockTransitionId) => void;
}) {
  const closed = group.status === "sold";
  const headingId = `stock-group-${group.status}`;
  return (
    <section
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
        <span className="truncate text-caption text-text-muted max-sm:hidden">
          · {group.hint}
        </span>
      </div>
      <ul className="mt-2 flex flex-col gap-1.5">
        {group.vehicles.map((vehicle) => (
          <UnitRow
            key={vehicle.id}
            vehicle={vehicle}
            selected={vehicle.id === selectedId}
            saving={saving.has(vehicle.id)}
            onSelect={() => onSelect(vehicle)}
            onRequest={onRequest}
          />
        ))}
      </ul>
    </section>
  );
}

function UnitRow({
  vehicle,
  selected,
  saving,
  onSelect,
  onRequest,
}: {
  vehicle: StockVehicle;
  selected: boolean;
  saving: boolean;
  onSelect: () => void;
  onRequest: (vehicle: StockVehicle, transition: StockTransitionId) => void;
}) {
  const sold = vehicle.status === "sold";
  const price = vehicle.price ? formatPrice(vehicle.price) : undefined;
  const km = vehicle.km === undefined ? undefined : formatKm(vehicle.km);
  return (
    <li
      aria-busy={saving || undefined}
      className={cn(
        "relative flex flex-col overflow-hidden rounded-md transition-[background-color,box-shadow,opacity] duration-150 ease-out @lg:flex-row",
        selected
          ? "bg-brand-soft shadow-card ring-2 ring-brand"
          : sold
            ? "bg-surface-2 ring-1 ring-border-subtle hover:ring-border-strong"
            : "bg-surface-1 shadow-card ring-1 ring-border-subtle hover:ring-border-strong",
        saving && "opacity-80",
      )}
    >
      <span
        aria-hidden="true"
        className={cn(
          "absolute inset-y-0 left-0 w-1",
          STATUS_EDGE[vehicle.status],
        )}
      />
      <button
        id={optionId(vehicle.id)}
        type="button"
        aria-current={selected ? "true" : undefined}
        aria-controls="stock-unit-context"
        onClick={onSelect}
        className="flex min-w-0 flex-1 cursor-default items-center gap-4 pt-2.5 pr-3 pb-1 pl-5 text-left focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-focus-ring @lg:min-h-16 @lg:pb-2.5"
      >
        <span className="min-w-0 flex-1">
          <span
            className={cn(
              "block truncate text-heading",
              sold ? "text-text-muted" : "text-text-primary",
            )}
          >
            {vehicleName(vehicle)}
          </span>
          <span
            className={cn(
              "block truncate text-label font-normal text-text-muted",
              LITERAL,
            )}
          >
            {vehicleDetail(vehicle)}
            {/* Lista angosta: el kilometraje va con la versión. */}
            <span className="@lg:hidden"> · {km ?? "Km sin dato"}</span>
          </span>
        </span>
        {/* Lista ancha: km en su bloque. Mediana: debajo del precio. */}
        <span className="hidden w-28 shrink-0 @3xl:block">
          <span className="block text-caption text-text-muted">
            Kilometraje
          </span>
          <span
            className={cn(
              "block text-body tabular-nums",
              km === undefined || sold
                ? "text-text-muted"
                : "text-text-primary",
            )}
          >
            {km ?? "Sin dato"}
          </span>
        </span>
        <span className="hidden w-36 shrink-0 flex-col items-end @lg:flex">
          <PriceParts label={price} muted={sold} size="lg" />
          <span className="text-caption text-text-muted tabular-nums @3xl:hidden">
            {km ?? "Km sin dato"}
          </span>
        </span>
      </button>
      {/* La acción: al pie, junto al precio, en una lista angosta; en su
          columna, de ancho fijo para alinear precios entre grupos, en una
          ancha. */}
      <div className="flex shrink-0 items-center justify-between gap-3 pt-1 pr-3 pb-2.5 pl-5 @lg:w-40 @lg:justify-end @lg:py-2 @lg:pl-1">
        <span className="@lg:hidden">
          <PriceParts label={price} muted={sold} />
        </span>
        <TransitionButton
          vehicle={vehicle}
          saving={saving}
          onRequest={onRequest}
          size="compact"
        />
      </div>
    </li>
  );
}

/**
 * La acción rápida de una unidad, según su estado (stockTransitionFor()):
 * compacta en la fila, de todo el ancho en el contexto. Una vendida no
 * ofrece ninguna: en la fila deja el lugar vacío y en el contexto lo dice.
 */
function TransitionButton({
  vehicle,
  saving,
  onRequest,
  size,
}: {
  vehicle: StockVehicle;
  saving: boolean;
  onRequest: (vehicle: StockVehicle, transition: StockTransitionId) => void;
  size: "compact" | "full";
}): ReactNode {
  const transition = stockTransitionFor(vehicle.status);
  if (!transition) {
    return size === "full" ? (
      <p className="mt-3 rounded-md border border-dashed border-border-strong px-3 py-2 text-caption text-text-muted">
        Vendida: la operación está cerrada y no cambia desde Stock.
      </p>
    ) : null;
  }
  const copy = VEHICLE_TRANSITION_COPY[transition];
  const primary = transition === "put_on_floor";
  return (
    <Button
      variant={primary ? "primary" : "secondary"}
      disabled={saving}
      aria-label={
        size === "compact"
          ? `${copy.label}: ${vehicleName(vehicle)} ${vehicle.year}`
          : undefined
      }
      onClick={() => onRequest(vehicle, transition)}
      className={cn(
        "disabled:cursor-wait disabled:opacity-70",
        size === "full"
          ? "mt-3 h-10 w-full"
          : "h-10 min-w-24 @lg:h-8 @lg:w-full",
      )}
    >
      {saving ? null : (
        <TransitionIcon transition={transition} className="size-4" />
      )}
      {saving
        ? VEHICLE_TRANSITION_PENDING
        : size === "full"
          ? copy.label
          : copy.short}
    </Button>
  );
}

/** Alta: qué unidad entró y en qué estado. */
function createdMessage(created: VehicleCreated): string {
  return `Unidad creada: ${vehicleName(created)} ${created.year}, ${vehicleStatusLabel("inPreparation").toLowerCase()}.`;
}

const NOTICE_TONE: Readonly<Record<Notice["tone"], string>> = {
  success: "border-success-border bg-success-soft text-success",
  neutral: "border-border-default bg-surface-2 text-text-secondary",
  error: "border-danger-border bg-danger-soft text-danger",
};

const NOTICE_DISMISS: Readonly<Record<Notice["tone"], string>> = {
  success: "hover:bg-success-border/40",
  neutral: "hover:bg-surface-3",
  error: "hover:bg-danger-border/40",
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
