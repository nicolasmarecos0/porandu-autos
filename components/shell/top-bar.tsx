import type { ReactNode } from "react";
import { BrandGlyphIcon } from "@/components/ui/icons";

/**
 * Banda superior de marca en azul marino ejecutivo (DEC-055), con un
 * gradiente sutil hacia la derecha. Ancla la identidad de Porandú en todo el
 * shell y en el login. `children` se alinea a la derecha (p. ej. la cuenta).
 */
export function TopBar({ children }: { children?: ReactNode }) {
  return (
    <header className="flex h-top-bar shrink-0 items-center bg-linear-to-r from-navy to-navy-hover text-text-inverse">
      <div className="flex w-nav-rail shrink-0 justify-center">
        <BrandMark />
      </div>
      <p className="text-heading tracking-tight">
        Porandú <span className="font-normal text-navy-muted">Autos</span>
      </p>
      {children ? (
        <div className="ml-auto flex items-center gap-2 pr-gutter">
          {children}
        </div>
      ) : null}
    </header>
  );
}

function BrandMark() {
  return (
    <span className="flex size-8 items-center justify-center rounded-md bg-surface-1 text-navy shadow-sm">
      <BrandGlyphIcon />
    </span>
  );
}
