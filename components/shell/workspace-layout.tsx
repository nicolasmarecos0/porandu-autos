import type { ReactNode } from "react";

type WorkspaceLayoutProps = {
  /** Encabezado de página (`PageHeader`). */
  header: ReactNode;
  /** Franja de métricas sobre la columna central (`SummaryBand`). */
  summary?: ReactNode;
  /** Rail contextual derecho. */
  aside?: ReactNode;
  /** Columna central. */
  children?: ReactNode;
};

/**
 * Regiones del workspace:
 *
 *   ┌──────────────── header ────────────────┐
 *   │ summary              │                 │
 *   │ columna central      │  rail contextual│
 *   └──────────────────────┴─────────────────┘
 *
 * En desktop cada columna tiene scroll propio; debajo de `lg` se apilan y
 * scrollea el conjunto.
 */
export function WorkspaceLayout({
  header,
  summary,
  aside,
  children,
}: WorkspaceLayoutProps) {
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {header}
      <div className="flex min-h-0 flex-1 flex-col gap-section overflow-y-auto p-gutter lg:flex-row lg:overflow-hidden">
        <div className="flex min-w-0 flex-1 flex-col gap-section lg:overflow-y-auto">
          {summary}
          {children}
        </div>
        {aside ? (
          <aside
            aria-label="Panel contextual"
            className="flex shrink-0 flex-col gap-section lg:w-context-rail lg:overflow-y-auto"
          >
            {aside}
          </aside>
        ) : null}
      </div>
    </div>
  );
}
