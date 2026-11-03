import type { ReactNode } from "react";

import { CockpitViewSwitch, type CockpitViewId } from "./cockpit-view-switch";

/*
 * Encabezado de la sección Cockpit, el mismo en sus dos vistas (propuesta
 * DEC-050): el título, el selector Cockpit · Métricas y, a la derecha, lo
 * propio de cada vista (la hora de la lectura o el selector de período).
 * Debajo, una línea opcional de lectura rápida. En pantallas chicas los
 * bloques bajan de línea en vez de desbordar: el rail de 4rem deja poco
 * ancho en un teléfono.
 */

export function CockpitHeader({
  title,
  current,
  aside,
  children,
}: {
  title: string;
  current: CockpitViewId;
  /** A la derecha del título en escritorio; debajo en un teléfono. */
  aside?: ReactNode;
  /** Línea de lectura rápida bajo el título. */
  children?: ReactNode;
}) {
  return (
    <header className="shrink-0 border-b border-border-subtle bg-surface-1 px-gutter py-3">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2.5">
        <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-2">
          <h1 className="text-title text-text-primary">{title}</h1>
          <CockpitViewSwitch current={current} />
        </div>
        {aside}
      </div>
      {children}
    </header>
  );
}
