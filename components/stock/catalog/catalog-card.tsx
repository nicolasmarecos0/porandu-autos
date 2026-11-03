import { cn } from "@/components/ui/cn";
import { ChevronRightIcon } from "@/components/ui/icons";
import type { CatalogVehicle } from "@/domains/vehicles/catalog";
import { formatKm, formatPrice } from "@/domains/vehicles/stock";

import { LITERAL, PriceParts, StatusChip } from "../stock-status";
import { CatalogPhoto } from "./catalog-photo";

/*
 * Tarjeta del catálogo (propuesta DEC-049): lo que el cliente mira de un
 * vistazo. Arriba, el lugar de la foto con el estado; abajo, marca, modelo,
 * versión, año y kilometraje, y el precio publicado como protagonista.
 *
 * Toda la tarjeta abre la vista de detalle: el botón del nombre se estira
 * sobre la tarjeta (`after:inset-0`), así el lector de pantalla anuncia un
 * nombre corto ("Toyota Hilux") y el resto se lee en orden. Las vendidas
 * siguen consultables, pero subordinadas (DEC-026 §5): fondo apagado y
 * texto tenue. Un dato que falta se dice; nunca se completa.
 */

export const PRICE_PENDING = "Precio a confirmar";

export function kmText(km: number | undefined): string {
  return km === undefined ? "Km sin dato" : formatKm(km);
}

export function CatalogCard({
  vehicle,
  onOpen,
}: {
  vehicle: CatalogVehicle;
  onOpen: (vehicleId: string) => void;
}) {
  const sold = vehicle.status === "sold";
  return (
    <article
      className={cn(
        "group relative flex h-full flex-col overflow-hidden rounded-lg border border-border-subtle shadow-card transition-[transform,box-shadow,border-color] duration-200 ease-out-strong",
        "hover:-translate-y-0.5 hover:border-border-default hover:shadow-md has-[button:active]:scale-[0.99] motion-reduce:hover:translate-y-0 motion-reduce:has-[button:active]:scale-100",
        "has-[button:focus-visible]:outline-2 has-[button:focus-visible]:outline-offset-2 has-[button:focus-visible]:outline-focus-ring",
        sold ? "bg-surface-2" : "bg-surface-1",
      )}
    >
      <div className="relative">
        <CatalogPhoto brand={vehicle.brand} muted={sold} />
        <span className="absolute top-2 left-2 rounded-sm bg-surface-1 shadow-sm">
          <StatusChip status={vehicle.status} />
        </span>
      </div>
      <div className="flex flex-1 flex-col gap-3 p-4">
        <div className="min-w-0">
          <p className="truncate text-overline text-text-muted uppercase">
            {vehicle.brand}
          </p>
          <h3
            className={cn(
              "truncate text-heading",
              sold ? "text-text-muted" : "text-text-primary",
            )}
          >
            <button
              type="button"
              aria-haspopup="dialog"
              onClick={() => onOpen(vehicle.id)}
              className="cursor-pointer text-left after:absolute after:inset-0 after:content-[''] focus-visible:outline-none"
            >
              <span className="sr-only">{vehicle.brand} </span>
              {vehicle.model}
            </button>
          </h3>
          {vehicle.version ? (
            <p
              className={cn(
                "truncate text-label font-normal text-text-secondary",
                LITERAL,
              )}
            >
              {vehicle.version}
            </p>
          ) : null}
        </div>
        <p className="flex flex-wrap items-center gap-x-2 text-label text-text-secondary tabular-nums">
          <span>
            <span className="sr-only">Año </span>
            {vehicle.year}
          </span>
          <span aria-hidden="true" className="text-border-strong">
            ·
          </span>
          <span>
            <span className="sr-only">Kilometraje </span>
            {kmText(vehicle.km)}
          </span>
        </p>
        <div className="mt-auto flex items-end justify-between gap-3 border-t border-border-subtle pt-3">
          <div className="min-w-0">
            <p className="text-caption text-text-muted">Precio</p>
            {vehicle.price ? (
              <PriceParts
                label={formatPrice(vehicle.price)}
                muted={sold}
                size="lg"
              />
            ) : (
              // Misma altura de línea que el precio: el filete no se mueve.
              <p className="text-label leading-6 text-text-muted">
                {PRICE_PENDING}
              </p>
            )}
          </div>
          <ChevronRightIcon
            aria-hidden="true"
            className="mb-1 size-4 shrink-0 text-text-muted transition-transform duration-200 ease-out-strong group-hover:translate-x-0.5 motion-reduce:group-hover:translate-x-0"
          />
        </div>
      </div>
    </article>
  );
}
