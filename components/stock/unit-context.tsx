import { cn } from "@/components/ui/cn";
import { CheckIcon } from "@/components/ui/icons";
import {
  formatKm,
  formatPrice,
  vehicleDetail,
  type StockVehicle,
  type VehicleStatus,
} from "@/domains/vehicles/stock";

import { LITERAL, PriceParts, StatusChip } from "./stock-status";

/*
 * Rail de contexto de la unidad seleccionada (Stock Surface v0.1): solo lo
 * que existe hoy (identidad, estado, precio, km, año). Fotos reales,
 * compradores potenciales y próxima acción se muestran como ausencia
 * explícita, sin botones, hasta que existan vehicle_media y sus motores.
 */

const AVAILABILITY: Readonly<Record<VehicleStatus, string>> = {
  available: "Disponible para vender",
  inPreparation: "Todavía no se entrega",
  reserved: "Comprometida con un comprador",
  sold: "Vendida · operación cerrada",
};

export function UnitContext({ vehicle }: { vehicle: StockVehicle }) {
  const sold = vehicle.status === "sold";
  return (
    <>
      <section
        aria-label="Unidad"
        className="rounded-lg border border-border-subtle bg-surface-1 p-4 shadow-card"
      >
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
              {vehicleDetail(vehicle)}
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
                muted={sold}
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

      <section
        aria-label="Fotos reales"
        className="rounded-lg border border-border-subtle bg-surface-1 p-4 shadow-card"
      >
        <h3 className="text-label text-text-muted">Fotos reales</h3>
        <div className="mt-2 flex aspect-[16/9] items-center justify-center rounded-md border border-dashed border-border-strong bg-surface-2 px-6 text-center">
          <p className="text-caption text-text-muted">
            Esta unidad todavía no tiene fotos cargadas
          </p>
        </div>
      </section>

      <section
        aria-label="Recorrido de la unidad"
        className="rounded-lg border border-border-subtle bg-surface-1 p-4 shadow-card"
      >
        <h3 className="text-label text-text-muted">Recorrido de la unidad</h3>
        <ol className="mt-3 flex flex-col">
          <Step
            state="done"
            title="Unidad en stock"
            detail="Identidad, año y kilometraje"
          />
          <Step
            state={sold ? "closed" : "done"}
            title="Disponibilidad"
            detail={AVAILABILITY[vehicle.status]}
          />
          <Step
            state="absent"
            title="Compradores potenciales"
            detail="Sin dato"
          />
          <Step state="absent" title="Próxima acción" detail="Sin dato" />
        </ol>
      </section>
    </>
  );
}

function Step({
  state,
  title,
  detail,
}: {
  state: "done" | "closed" | "absent";
  title: string;
  detail: string;
}) {
  return (
    <li className="group relative flex gap-3 pb-3 last:pb-0">
      <span
        aria-hidden="true"
        className="absolute top-5 bottom-0 left-[9px] w-px bg-border-default group-last:hidden"
      />
      <span
        aria-hidden="true"
        className={cn(
          "relative flex size-5 shrink-0 items-center justify-center rounded-full border",
          state === "done" && "border-brand bg-brand text-brand-contrast",
          state === "closed" &&
            "border-border-strong bg-surface-3 text-text-muted",
          state === "absent" &&
            "border-dashed border-border-strong bg-surface-1",
        )}
      >
        {state === "absent" ? null : (
          <CheckIcon className="size-3" strokeWidth={2.5} />
        )}
      </span>
      <span className="min-w-0">
        <span
          className={cn(
            "block text-label",
            state === "absent" ? "text-text-muted" : "text-text-primary",
          )}
        >
          {title}
        </span>
        <span className="block text-caption text-text-muted">{detail}</span>
      </span>
    </li>
  );
}

/** Sin unidad elegida (0 vehículos): rail neutral, sin datos de ejemplo. */
export function EmptyUnitContext() {
  return (
    <div className="rounded-lg border border-dashed border-border-strong px-5 py-8 text-center">
      <p className="text-label font-normal text-text-muted">
        Al elegir una unidad de la lista, acá vas a ver su precio, kilometraje y
        recorrido.
      </p>
    </div>
  );
}
