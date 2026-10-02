import { CheckIcon } from "@/components/ui/icons";
import { cn } from "@/components/ui/cn";
import {
  vehicleStatusLabel,
  type VehicleStatus,
} from "@/domains/vehicles/stock";

/*
 * PROTOTIPO: lenguaje de estado compartido por las variantes.
 * - Disponible: verde, el único estado vendible ahora.
 * - En preparación: ámbar, unidad física que todavía no se entrega.
 * - Reservada: marca, comprometida con un comprador.
 * - Vendida: cerrada/histórica. Contorno punteado y check, sin relleno:
 *   nunca se lee como stock vendible.
 */
export const STATUS_DOT: Record<VehicleStatus, string> = {
  available: "bg-success",
  inPreparation: "bg-warning",
  reserved: "bg-brand",
  sold: "bg-border-strong",
};

export const STATUS_EDGE: Record<VehicleStatus, string> = {
  available: "bg-success",
  inPreparation: "bg-warning",
  reserved: "bg-brand",
  sold: "bg-border-default",
};

const CHIP: Record<VehicleStatus, string> = {
  available: "border-success-border bg-success-soft text-success",
  inPreparation: "border-warning-border bg-warning-soft text-warning",
  reserved: "border-brand-border bg-brand-soft text-brand-strong",
  sold: "border-dashed border-border-strong bg-transparent text-text-muted",
};

export function StatusChip({
  status,
  className,
}: {
  status: VehicleStatus;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex h-6 items-center gap-1.5 rounded-sm border px-2 text-caption font-semibold whitespace-nowrap",
        CHIP[status],
        className,
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

/** Precio partido: moneda chica, monto protagonista. */
export function PriceParts({
  label,
  sold,
  size = "md",
}: {
  label: string | undefined;
  sold?: boolean;
  size?: "md" | "lg";
}) {
  if (!label) {
    return <span className="text-label text-text-muted">Sin dato</span>;
  }
  const [currency, ...rest] = label.split(" ");
  return (
    <span
      className={cn(
        "inline-flex items-baseline gap-1 tabular-nums",
        sold ? "text-text-muted" : "text-text-primary",
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
        {rest.join(" ")}
      </span>
    </span>
  );
}
