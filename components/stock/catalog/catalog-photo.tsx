import { cn } from "@/components/ui/cn";
import { CameraIcon } from "@/components/ui/icons";

/*
 * Lugar de las fotos reales de una unidad (propuesta DEC-049). Hoy ninguna
 * tiene fotos: vehicle_media no existe (DEC-025 §9). Se muestra el marco
 * vacío, con la marca cargada como tipografía y "Sin fotos cargadas".
 *
 * Nunca una representación genérica que pase por foto real (DEC-026 §6,
 * CLAUDE.md §2): no hay silueta ni imagen de un vehículo, así que no hace
 * falta la etiqueta "Representación". Cuando exista vehicle_media, la foto
 * real ocupa este mismo marco.
 */

export function CatalogPhoto({
  brand,
  muted = false,
  size = "card",
  className,
}: {
  brand: string;
  /** Unidad cerrada (vendida): la marca se ve más tenue. */
  muted?: boolean;
  /** `card`: tarjeta de la grilla (4:3). `hero`: vista de detalle (16:10). */
  size?: "card" | "hero";
  className?: string;
}) {
  return (
    <div
      className={cn(
        "relative flex items-center justify-center overflow-hidden bg-linear-to-br from-surface-2 via-surface-3 to-bg-subtle",
        size === "card" ? "aspect-[4/3]" : "aspect-[16/10]",
        className,
      )}
    >
      <span
        aria-hidden="true"
        className={cn(
          "max-w-[85%] truncate font-semibold tracking-[0.18em] uppercase select-none",
          size === "card" ? "text-title" : "text-display",
          muted ? "text-border-default" : "text-border-strong",
        )}
      >
        {brand}
      </span>
      <span className="absolute bottom-2 left-2 inline-flex items-center gap-1 rounded-sm bg-surface-1/90 px-1.5 py-0.5 text-caption text-text-muted">
        <CameraIcon aria-hidden="true" className="size-3.5" />
        Sin fotos cargadas
      </span>
    </div>
  );
}
