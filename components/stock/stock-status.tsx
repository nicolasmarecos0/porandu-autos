import { cn } from "@/components/ui/cn";
import { CheckIcon } from "@/components/ui/icons";
import {
  vehicleStatusLabel,
  type VehicleStatus,
} from "@/domains/vehicles/stock";

/*
 * Lenguaje de estado de Stock (Stock Surface v0.1):
 * - Disponible: verde, lo vendible ahora.
 * - En preparación: ámbar, unidad física que todavía no se entrega.
 * - Reservada: marca, comprometida con un comprador.
 * - Vendida: cerrada. Gris, contorno punteado y check, sin relleno: nunca se
 *   lee como stock vendible.
 */

export const STATUS_DOT: Readonly<Record<VehicleStatus, string>> = {
  available: "bg-success",
  inPreparation: "bg-warning",
  reserved: "bg-brand",
  sold: "bg-border-strong",
};

/** Canto de la fila y segmento del medidor. */
export const STATUS_EDGE: Readonly<Record<VehicleStatus, string>> = {
  available: "bg-success",
  inPreparation: "bg-warning",
  reserved: "bg-brand",
  sold: "bg-border-default",
};

export const STATUS_TEXT: Readonly<Record<VehicleStatus, string>> = {
  available: "text-success",
  inPreparation: "text-warning",
  reserved: "text-brand-strong",
  sold: "text-text-muted",
};

const CHIP: Readonly<Record<VehicleStatus, string>> = {
  available: "border-success-border bg-success-soft text-success",
  inPreparation: "border-warning-border bg-warning-soft text-warning",
  reserved: "border-brand-border bg-brand-soft text-brand-strong",
  sold: "border-dashed border-border-strong bg-transparent text-text-muted",
};

/**
 * Texto de datos literal: sin las alternativas contextuales de Inter, que
 * dibujan "4x4" como "4×4" y alteran el dato cargado.
 */
export const LITERAL = "[font-feature-settings:'calt'_0]";

export function StatusChip({ status }: { status: VehicleStatus }) {
  return (
    <span
      className={cn(
        "inline-flex h-6 shrink-0 items-center gap-1.5 rounded-sm border px-2 text-caption font-semibold whitespace-nowrap",
        CHIP[status],
      )}
    >
      {status === "sold" ? (
        <CheckIcon className="size-3" strokeWidth={2.25} />
      ) : (
        <span
          aria-hidden="true"
          className={cn("size-1.5 rounded-full", STATUS_DOT[status])}
        />
      )}
      {vehicleStatusLabel(status)}
    </span>
  );
}

/**
 * Precio partido: la moneda chica, el monto protagonista. `label` es el
 * precio ya formateado ("USD 49.900"); sin precio, "Sin dato".
 */
export function PriceParts({
  label,
  muted = false,
  size = "md",
}: {
  label: string | undefined;
  muted?: boolean;
  size?: "md" | "lg";
}) {
  if (!label) {
    return <span className="text-label text-text-muted">Sin dato</span>;
  }
  const [currency, ...amount] = label.split(" ");
  return (
    <span
      className={cn(
        "inline-flex items-baseline gap-1 tabular-nums",
        muted ? "text-text-muted" : "text-text-primary",
      )}
    >
      <span className="text-caption font-semibold text-text-muted">
        {currency}
      </span>
      <span
        className={cn(
          "font-semibold tracking-tight",
          size === "lg" ? "text-heading" : "text-body",
        )}
      >
        {amount.join(" ")}
      </span>
    </span>
  );
}
