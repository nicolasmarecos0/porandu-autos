import type { ReactNode } from "react";

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
      <svg
        viewBox="0 0 24 24"
        width={20}
        height={20}
        fill="none"
        stroke="currentColor"
        strokeWidth={2.5}
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
        focusable="false"
      >
        <path d="M8.5 18V6h5a3.5 3.5 0 0 1 0 7h-5" />
      </svg>
    </span>
  );
}
