import type { ReactNode } from "react";

type PageHeaderProps = {
  title: string;
  /** Estado junto al título (p. ej. un badge). */
  status?: ReactNode;
  /** Acciones alineadas a la derecha. */
  actions?: ReactNode;
};

/** Encabezado de página: banda blanca fija sobre el workspace. */
export function PageHeader({ title, status, actions }: PageHeaderProps) {
  return (
    <header className="flex h-page-header shrink-0 items-center gap-3 border-b border-border-subtle bg-surface-1 px-gutter">
      <h1 className="text-title text-text-primary">{title}</h1>
      {status}
      {actions ? (
        <div className="ml-auto flex items-center gap-2">{actions}</div>
      ) : null}
    </header>
  );
}
