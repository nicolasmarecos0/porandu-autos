import { NavLink } from "./nav-link";
import { NAV_ITEMS, type NavItem } from "./navigation";

// Configuración queda anclada abajo; el orden de DEC-001 se mantiene.
const primaryItems = NAV_ITEMS.filter((item) => item.id !== "settings");
const footerItems = NAV_ITEMS.filter((item) => item.id === "settings");

function NavList({ items }: { items: readonly NavItem[] }) {
  return (
    <ul className="flex w-full flex-col gap-1">
      {items.map(({ id, href, label, icon: Icon }) => (
        <li key={id}>
          <NavLink href={href} label={label} icon={<Icon />} />
        </li>
      ))}
    </ul>
  );
}

function BrandMark() {
  return (
    <div className="flex size-10 items-center justify-center rounded-lg bg-brand text-brand-contrast shadow-sm">
      <svg
        viewBox="0 0 24 24"
        width={22}
        height={22}
        fill="none"
        stroke="currentColor"
        strokeWidth={2.25}
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
        focusable="false"
      >
        <path d="M8.5 18V6h5a3.5 3.5 0 0 1 0 7h-5" />
      </svg>
      <span className="sr-only">Porandú Autos</span>
    </div>
  );
}

export function NavRail() {
  return (
    <nav
      aria-label="Navegación principal"
      className="flex h-full w-nav-rail shrink-0 flex-col items-center gap-6 overflow-y-auto bg-surface-inverse px-1.5 py-4"
    >
      <BrandMark />
      <NavList items={primaryItems} />
      <div className="mt-auto w-full border-t border-border-inverse pt-3">
        <NavList items={footerItems} />
      </div>
    </nav>
  );
}
