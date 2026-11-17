import { cn } from "@/components/ui/cn";
import { BODY_TYPE_LABELS } from "@/domains/vehicles/body-type";
import type { BodyType } from "@/domains/vehicles/types";

/*
 * Render lateral genérico por carrocería (DEC-058): ilustración de estudio
 * local y estática (public/vehicles/*.svg), sin URLs externas. Va en la
 * esquina inferior derecha de las tarjetas "Busca", Top Match y
 * Alternativa, como la foto recortada de la referencia.
 *
 * - Siempre lleva la etiqueta "Representación": no es una foto de la
 *   unidad. Las fotos reales se usan solo en Stock (CLAUDE.md §2).
 * - Sin carrocería conocida (un modelo fuera de la tabla), no se muestra
 *   nada: no se inventa una.
 */
export function VehicleRender({
  body,
  className,
}: {
  body: BodyType | null;
  className?: string;
}) {
  if (body === null) return null;
  return (
    <figure
      className={cn("flex shrink-0 flex-col items-end gap-0.5", className)}
    >
      {/* SVG local de pocos KB: next/image no aporta nada. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={`/vehicles/${body}.svg`}
        alt={`Representación genérica de un ${BODY_TYPE_LABELS[body]}`}
        width={156}
        height={56}
        loading="lazy"
        decoding="async"
        draggable={false}
        className="h-auto w-full select-none"
      />
      <figcaption className="text-[0.625rem] leading-none text-text-muted">
        Representación
      </figcaption>
    </figure>
  );
}
