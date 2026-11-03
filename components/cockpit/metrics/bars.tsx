import { cn } from "@/components/ui/cn";

/*
 * Barras de las Métricas del salón (propuesta DEC-050 §8), en Tailwind
 * puro, sin librerías de gráficos. Son figuras: el número que representan
 * ya está escrito al lado (rótulo, valor y proporción), así que cada barra
 * es decorativa para los lectores de pantalla (`aria-hidden`) y el `title`
 * de cada segmento solo suma un tooltip nativo al pasar el mouse.
 *
 * - ShareBar: una proporción (0 a 100) sobre una pista de la misma rampa,
 *   como el medidor del win rate (DEC-037 §12).
 * - SegmentedBar: un todo partido en partes, fina (8 px), con un hueco de
 *   2 px del color de la superficie entre segmentos y una leyenda con los
 *   nombres y los números al lado, como el medidor de Stock (DEC-026). Una
 *   parte en cero no dibuja nada.
 *
 * Los colores de estado (éxito, advertencia, peligro) solo aparecen cuando
 * significan eso, y siempre junto a su rótulo (DEC-013).
 */

export type ShareTone = "brand" | "soft";

const SHARE_FILL: Readonly<Record<ShareTone, string>> = {
  brand: "bg-brand",
  soft: "bg-brand-border",
};

export function ShareBar({
  percent,
  tone = "brand",
  className,
}: {
  /** 0 a 100; null (sin dato) no dibuja relleno. */
  percent: number | null;
  tone?: ShareTone;
  className?: string;
}) {
  const width = percent === null ? 0 : Math.min(100, Math.max(0, percent));
  return (
    <span
      aria-hidden="true"
      className={cn(
        "block h-2 w-full overflow-hidden rounded-full bg-brand-soft",
        className,
      )}
    >
      {width > 0 ? (
        <span
          className={cn("block h-full rounded-full", SHARE_FILL[tone])}
          style={{ width: `${width}%` }}
        />
      ) : null}
    </span>
  );
}

export type BarSegment = Readonly<{
  key: string;
  /** Rótulo del segmento para el tooltip ("Disponibles: 4"). */
  label: string;
  value: number;
  /** Clase del relleno: un token de color (`bg-success`, `bg-brand`…). */
  fill: string;
}>;

export function SegmentedBar({
  segments,
  className,
}: {
  segments: readonly BarSegment[];
  className?: string;
}) {
  const visible = segments.filter((segment) => segment.value > 0);
  return (
    <span
      aria-hidden="true"
      className={cn(
        "flex h-2 w-full gap-0.5 overflow-hidden rounded-full bg-surface-3",
        className,
      )}
    >
      {visible.map((segment) => (
        <span
          key={segment.key}
          title={segment.label}
          className={cn("h-full min-w-1", segment.fill)}
          style={{ flexGrow: segment.value }}
        />
      ))}
    </span>
  );
}

/** Muestra de color de una leyenda: acompaña al rótulo, nunca lo reemplaza. */
export function Swatch({ fill }: { fill: string }) {
  return (
    <span
      aria-hidden="true"
      className={cn("size-2 shrink-0 rounded-full", fill)}
    />
  );
}
