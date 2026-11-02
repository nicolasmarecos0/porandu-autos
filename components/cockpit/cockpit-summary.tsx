import { cn } from "@/components/ui/cn";
import { AlertIcon } from "@/components/ui/icons";
import type { CockpitSummaryTile } from "@/domains/cockpit/feed";

/*
 * Franja superior del Cockpit (Hito 15, DEC-047 §4): cuatro totales de las
 * mismas lecturas del feed, sobre la superficie inverse de las franjas de
 * métricas (DEC-013). Una `dl`: cada número con su rótulo y su alcance en
 * texto. Lo que pide acción se destaca con un ícono y el tinte de marca,
 * siempre junto a su texto: el color nunca es la única señal.
 *
 * Dos columnas en teléfono y cuatro desde `sm`. Los filetes entre tiles son
 * el fondo de la grilla asomando por el `gap-px`.
 */

export function CockpitSummary({
  tiles,
}: {
  tiles: readonly CockpitSummaryTile[];
}) {
  return (
    <dl
      aria-label="Resumen del día"
      className="grid shrink-0 grid-cols-2 gap-px overflow-hidden rounded-lg bg-surface-inverse-hover shadow-card sm:grid-cols-4"
    >
      {tiles.map((tile) => (
        <div
          key={tile.key}
          className="flex min-h-20 min-w-0 flex-col justify-center gap-0.5 bg-surface-inverse px-4 py-3"
        >
          <dt className="truncate text-overline text-text-inverse-muted uppercase">
            {tile.label}
          </dt>
          <dd className="text-metric text-text-inverse tabular-nums">
            {tile.value.toLocaleString("es-PY")}
          </dd>
          <dd
            className={cn(
              "flex min-w-0 items-center gap-1 text-caption",
              tile.attention ? "text-brand-inverse" : "text-text-inverse-muted",
            )}
          >
            {tile.attention ? (
              <AlertIcon className="size-3.5 shrink-0" strokeWidth={2} />
            ) : null}
            <span className="truncate">{tile.hint}</span>
          </dd>
        </div>
      ))}
    </dl>
  );
}
