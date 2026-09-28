import type { ReactNode } from "react";
import { cn } from "./cn";

/**
 * Franja de métricas compactas sobre superficie inverse (score strip).
 * Los tiles se reparten el ancho en partes iguales.
 */
export function SummaryBand({ children }: { children: ReactNode }) {
  return (
    <div className="grid shrink-0 auto-cols-fr grid-flow-col overflow-hidden rounded-lg bg-surface-inverse text-text-inverse shadow-card">
      {children}
    </div>
  );
}

type SummaryTileProps = {
  /** Tile principal de la franja: se destaca con el color de marca. */
  highlighted?: boolean;
  children: ReactNode;
};

export function SummaryTile({
  highlighted = false,
  children,
}: SummaryTileProps) {
  return (
    <div
      className={cn(
        "flex min-h-20 flex-col items-center justify-center gap-2 px-4 py-3",
        highlighted
          ? "bg-brand"
          : "border-l border-border-inverse first:border-l-0",
      )}
    >
      {children}
    </div>
  );
}
