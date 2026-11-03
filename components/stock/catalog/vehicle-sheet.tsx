"use client";

import Link from "next/link";
import { useRef, useState } from "react";

import { scheduleTestDriveHref } from "@/components/calendar/links";
import { Button, buttonClassName } from "@/components/ui/button";
import { cn } from "@/components/ui/cn";
import { DocumentIcon, SteeringIcon } from "@/components/ui/icons";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  catalogActions,
  type CatalogVehicle,
  type QuoteCustomerOption,
} from "@/domains/vehicles/catalog";
import { formatKm, formatPrice, vehicleDetail } from "@/domains/vehicles/stock";

import { LITERAL, PriceParts, StatusChip } from "../stock-status";
import { CatalogPhoto } from "./catalog-photo";
import { PRICE_PENDING } from "./catalog-card";
import { QuoteLauncher } from "./quote-launcher";

/*
 * Vista de detalle de una unidad del catálogo (propuesta DEC-049): una hoja
 * que sube desde abajo en el teléfono y un panel lateral desde md (Sheet,
 * Radix Dialog). Muestra la ficha completa con lo que la base tiene (marca,
 * modelo, versión, año, kilometraje, precio publicado y estado) y, al pie,
 * las acciones rápidas que aplican:
 *
 * - "Agendar prueba" (disponible o reservada, DEC-041 §3) lleva a la agenda
 *   con el alta abierta y la unidad elegida;
 * - "Cotizar" (disponible o reservada con precio publicado, DEC-042 §1 y §3)
 *   pide el cliente y lleva a su oportunidad con "Nueva cotización" abierta.
 *
 * Son enlaces: el catálogo no agenda, no cotiza ni cambia nada. Cada
 * escritura pasa por la puerta de su módulo, con su validación, su
 * confirmación y la aprobación humana de la cotización (CLAUDE.md §2).
 */

export function VehicleSheet({
  vehicle,
  quoteCustomers,
  onClose,
}: {
  vehicle: CatalogVehicle | null;
  quoteCustomers: readonly QuoteCustomerOption[];
  onClose: () => void;
}) {
  return (
    <Sheet
      open={vehicle !== null}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      {vehicle ? (
        <SheetContent
          key={vehicle.id}
          footer={
            <VehicleActions vehicle={vehicle} quoteCustomers={quoteCustomers} />
          }
        >
          <VehicleDetail vehicle={vehicle} />
        </SheetContent>
      ) : null}
    </Sheet>
  );
}

/** Ficha de la unidad: el cuerpo de la hoja. */
export function VehicleDetail({ vehicle }: { vehicle: CatalogVehicle }) {
  const sold = vehicle.status === "sold";
  return (
    <article className="pb-6">
      <div className="relative px-4 pt-4 md:px-5 md:pt-5">
        <CatalogPhoto
          brand={vehicle.brand}
          muted={sold}
          size="hero"
          className="rounded-lg"
        />
        <span className="absolute top-6 left-6 rounded-sm bg-surface-1 shadow-sm md:top-7 md:left-7">
          <StatusChip status={vehicle.status} />
        </span>
      </div>

      <div className="px-5 pt-4">
        <p className="text-overline text-text-muted uppercase">
          {vehicle.brand}
        </p>
        <SheetTitle
          className={cn(
            "text-display break-words",
            sold ? "text-text-muted" : "text-text-primary",
          )}
        >
          <span className="sr-only">{vehicle.brand} </span>
          {vehicle.model}
        </SheetTitle>
        <SheetDescription
          className={cn("mt-0.5 text-body text-text-secondary", LITERAL)}
        >
          {vehicleDetail(vehicle)}
        </SheetDescription>

        <div className="mt-4 rounded-lg border border-border-subtle bg-surface-2 px-4 py-3">
          <p className="text-caption text-text-muted">Precio publicado</p>
          {vehicle.price ? (
            <p className="mt-0.5">
              <PriceParts
                label={formatPrice(vehicle.price)}
                muted={sold}
                size="xl"
              />
            </p>
          ) : (
            <p className="mt-0.5 text-heading text-text-muted">
              {PRICE_PENDING}
            </p>
          )}
        </div>

        <h3 className="mt-6 text-overline text-text-muted uppercase">
          Especificaciones
        </h3>
        <dl className="mt-2 divide-y divide-border-subtle rounded-lg border border-border-subtle">
          <Spec label="Marca" value={vehicle.brand} />
          <Spec label="Modelo" value={vehicle.model} />
          <Spec label="Versión" value={vehicle.version} literal />
          <Spec label="Año" value={String(vehicle.year)} />
          <Spec
            label="Kilometraje"
            value={vehicle.km === undefined ? undefined : formatKm(vehicle.km)}
          />
          <div className="flex items-center justify-between gap-4 px-4 py-2.5">
            <dt className="text-label text-text-muted">Estado</dt>
            <dd>
              <StatusChip status={vehicle.status} />
            </dd>
          </div>
        </dl>
        <p className="mt-3 text-caption text-text-muted">
          Esta unidad todavía no tiene fotos reales cargadas.
        </p>
      </div>
    </article>
  );
}

function Spec({
  label,
  value,
  literal = false,
}: {
  label: string;
  value: string | undefined;
  literal?: boolean;
}) {
  return (
    <div className="flex items-baseline justify-between gap-4 px-4 py-2.5">
      <dt className="shrink-0 text-label text-text-muted">{label}</dt>
      <dd
        className={cn(
          "min-w-0 text-right text-body break-words tabular-nums",
          value === undefined ? "text-text-muted" : "text-text-primary",
          literal && LITERAL,
        )}
      >
        {value ?? "Sin dato"}
      </dd>
    </div>
  );
}

/** Acciones rápidas al pie de la hoja: solo las que aplican a la unidad. */
export function VehicleActions({
  vehicle,
  quoteCustomers,
}: {
  vehicle: CatalogVehicle;
  quoteCustomers: readonly QuoteCustomerOption[];
}) {
  const actions = catalogActions(vehicle);
  const [quoting, setQuoting] = useState(false);
  const quoteRef = useRef<HTMLButtonElement>(null);

  if (quoting) {
    return (
      <QuoteLauncher
        vehicleId={vehicle.id}
        customers={quoteCustomers}
        onCancel={() => {
          setQuoting(false);
          // El foco vuelve al botón que abrió el paso.
          requestAnimationFrame(() => quoteRef.current?.focus());
        }}
      />
    );
  }

  return (
    <div className="flex flex-col gap-2">
      {actions.hint ? (
        <p className="text-label text-text-secondary">{actions.hint}</p>
      ) : null}
      {actions.schedule || actions.quote ? (
        <div className="flex gap-2">
          {actions.schedule ? (
            <Link
              href={scheduleTestDriveHref(vehicle.id)}
              prefetch={false}
              className={buttonClassName("primary", "h-10 flex-1")}
            >
              <SteeringIcon aria-hidden="true" className="size-4" />
              Agendar prueba
            </Link>
          ) : null}
          {actions.quote ? (
            <Button
              ref={quoteRef}
              onClick={() => setQuoting(true)}
              className="h-10 flex-1"
            >
              <DocumentIcon aria-hidden="true" className="size-4" />
              Cotizar
            </Button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
