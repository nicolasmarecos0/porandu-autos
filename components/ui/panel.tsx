import type { ReactNode } from "react";
import { cn } from "./cn";

type PanelProps = {
  /** Destaca el panel con el borde de marca (p. ej. la opción recomendada). */
  highlighted?: boolean;
  className?: string;
  children: ReactNode;
};

/** Contenedor base del workspace: superficie blanca, borde y sombra sutiles. */
export function Panel({
  highlighted = false,
  className,
  children,
}: PanelProps) {
  return (
    <div
      className={cn(
        "overflow-hidden rounded-lg bg-surface-1 shadow-card",
        highlighted ? "border-2 border-brand" : "border border-border-subtle",
        className,
      )}
    >
      {children}
    </div>
  );
}

/** Encabezado de panel con filete inferior de marca. */
export function PanelHeader({ children }: { children: ReactNode }) {
  return (
    <div className="flex h-11 items-center gap-3 border-b-2 border-brand px-4">
      {children}
    </div>
  );
}
