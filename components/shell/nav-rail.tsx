import { TooltipProvider } from "@/components/ui/tooltip";
import { NavLink } from "./nav-link";
import { NAV_ITEMS, type NavItem } from "./navigation";

// Configuración queda anclada abajo; el orden de DEC-001 se mantiene.
const primaryItems = NAV_ITEMS.filter((item) => item.id !== "settings");
const footerItems = NAV_ITEMS.filter((item) => item.id === "settings");

function NavList({ items }: { items: readonly NavItem[] }) {
  return (
    <ul className="flex w-full flex-col items-center gap-1">
      {items.map(({ id, href, label, icon: Icon }) => (
        <li key={id}>
          <NavLink
            href={href}
            label={label}
            icon={<Icon width={22} height={22} />}
          />
        </li>
      ))}
    </ul>
  );
}

/** Rail compacto de íconos; la etiqueta se muestra como tooltip. */
export function NavRail() {
  return (
    <nav
      aria-label="Navegación principal"
      className="flex h-full w-nav-rail shrink-0 flex-col items-center bg-surface-inverse py-3"
    >
      <TooltipProvider>
        <NavList items={primaryItems} />
        <div className="mt-auto w-full border-t border-border-inverse pt-3">
          <NavList items={footerItems} />
        </div>
      </TooltipProvider>
    </nav>
  );
}
