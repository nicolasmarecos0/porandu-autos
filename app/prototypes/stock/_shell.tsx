import type { ReactNode } from "react";
import { NAV_ITEMS } from "@/components/shell/navigation";
import { TopBar } from "@/components/shell/top-bar";

/*
 * PROTOTIPO: réplica estática del shell productivo (top bar + rail) con Stock
 * activo, para juzgar cada variante en su contexto real. No es el AppShell:
 * esta ruta no pasa por el layout de (app).
 */
export function PrototypeShell({ children }: { children: ReactNode }) {
  const primary = NAV_ITEMS.filter((item) => item.id !== "settings");
  const footer = NAV_ITEMS.filter((item) => item.id === "settings");
  const rail = (items: typeof NAV_ITEMS) => (
    <ul className="flex w-full flex-col items-center gap-1">
      {items.map(({ id, label, icon: Icon }) => (
        <li key={id}>
          <span
            aria-current={id === "stock" ? "page" : undefined}
            className="flex size-11 items-center justify-center rounded-md text-text-inverse-muted aria-[current=page]:bg-brand aria-[current=page]:text-text-inverse"
          >
            <Icon width={22} height={22} />
            <span className="sr-only">{label}</span>
          </span>
        </li>
      ))}
    </ul>
  );
  return (
    <div className="flex h-dvh flex-col overflow-hidden">
      <TopBar>
        <span className="text-label font-semibold">Cerrar sesión</span>
      </TopBar>
      <div className="flex min-h-0 flex-1">
        <nav className="flex h-full w-nav-rail shrink-0 flex-col items-center bg-surface-inverse py-3">
          {rail(primary)}
          <div className="mt-auto w-full border-t border-border-inverse pt-3">
            {rail(footer)}
          </div>
        </nav>
        <main className="relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-bg-canvas">
          {children}
        </main>
      </div>
    </div>
  );
}
