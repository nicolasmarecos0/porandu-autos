import type { ReactNode } from "react";
import { AccountMenu } from "./account-menu";
import { NavRail } from "./nav-rail";
import { TopBar } from "./top-bar";

/**
 * Shell desktop-first:
 *
 *   Top Bar (marca, azul marino; menú de la cuenta a la derecha)
 *   Global Navigation Rail (carbón) | Main Workspace
 *
 * El shell ocupa exactamente el viewport. El workspace es un contenedor flex
 * de altura completa (`min-w-0`, `min-h-0`); cada página compone ahí sus
 * regiones con `WorkspaceLayout` (encabezado, franja de métricas, columna
 * central y rail contextual), cada una con scroll propio.
 */
export function AppShell({
  account,
  children,
}: {
  /** Cuenta de la sesión, de los claims verificados (DEC-055). */
  account: { email: string | null };
  children: ReactNode;
}) {
  return (
    <div className="flex h-dvh flex-col overflow-hidden">
      <a
        href="#workspace"
        className="sr-only focus-visible:not-sr-only focus-visible:fixed focus-visible:top-3 focus-visible:left-3 focus-visible:z-50 focus-visible:rounded-md focus-visible:bg-surface-1 focus-visible:px-3 focus-visible:py-2 focus-visible:text-label focus-visible:text-text-primary focus-visible:shadow-md focus-visible:outline-2 focus-visible:outline-focus-ring"
      >
        Saltar al contenido
      </a>
      {/* Sesión (H0.6). La organización se elige en /select-organization (H0.7). */}
      <TopBar>
        <AccountMenu email={account.email} />
      </TopBar>
      <div className="flex min-h-0 flex-1">
        <NavRail />
        <main
          id="workspace"
          tabIndex={-1}
          className="relative flex min-h-0 min-w-0 flex-1 flex-col overflow-y-auto focus:outline-none"
        >
          {children}
        </main>
      </div>
    </div>
  );
}
