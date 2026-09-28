import type { ReactNode } from "react";
import { NavRail } from "./nav-rail";

/**
 * Shell desktop-first: `Global Navigation Rail | Main Workspace`.
 *
 * El shell ocupa exactamente el viewport. El workspace es un contenedor flex
 * de altura completa (`min-w-0`, `min-h-0`) para que las páginas compongan
 * sus propias columnas con scroll independiente; p. ej. el Opportunity
 * Workspace agregará Customer/Memory Panel · Intelligence · Vehicle Rail
 * dentro de este slot, sin cambiar el shell.
 */
export function AppShell({ children }: { children: ReactNode }) {
  return (
    <div className="flex h-dvh overflow-hidden">
      <a
        href="#workspace"
        className="sr-only focus-visible:not-sr-only focus-visible:fixed focus-visible:top-3 focus-visible:left-3 focus-visible:z-50 focus-visible:rounded-md focus-visible:bg-surface-2 focus-visible:px-3 focus-visible:py-2 focus-visible:text-label focus-visible:text-text-primary focus-visible:outline-2 focus-visible:outline-focus-ring"
      >
        Saltar al contenido
      </a>
      <NavRail />
      <main
        id="workspace"
        tabIndex={-1}
        className="relative flex min-h-0 min-w-0 flex-1 flex-col overflow-y-auto focus:outline-none"
      >
        {children}
      </main>
    </div>
  );
}
