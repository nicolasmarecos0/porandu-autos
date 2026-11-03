import Link from "next/link";
import type { ComponentType } from "react";

import { cn } from "@/components/ui/cn";
import { GridIcon, QueueIcon, type IconProps } from "@/components/ui/icons";
import { STOCK_CATALOG_PATH, STOCK_PATH } from "@/lib/vehicles/paths";

/*
 * Selector de vista de Stock (propuesta DEC-049): el inventario operativo
 * agrupado por estado (DEC-026) o el catálogo visual para mostrar en el
 * salón. Son enlaces de navegación, con la vista actual en
 * `aria-current="page"`, como el selector Cola · Embudo de Opportunities
 * (DEC-048 §1): se comparte, se vuelve atrás y se recarga. Sin prefetch:
 * cada vista hace sus lecturas tenant-scoped al abrirse.
 */

export type StockViewId = "inventory" | "catalog";

const VIEWS: readonly Readonly<{
  id: StockViewId;
  href: string;
  label: string;
  icon: ComponentType<IconProps>;
}>[] = [
  { id: "inventory", href: STOCK_PATH, label: "Inventario", icon: QueueIcon },
  {
    id: "catalog",
    href: STOCK_CATALOG_PATH,
    label: "Catálogo",
    icon: GridIcon,
  },
];

export function StockViewSwitch({
  current,
  className,
}: {
  current: StockViewId;
  className?: string;
}) {
  return (
    <nav
      aria-label="Vista de stock"
      className={cn(
        "grid grid-cols-2 gap-0.5 rounded-md bg-surface-3 p-0.5",
        className,
      )}
    >
      {VIEWS.map(({ id, href, label, icon: Icon }) => {
        const active = id === current;
        return (
          <Link
            key={id}
            href={href}
            prefetch={false}
            aria-current={active ? "page" : undefined}
            className={cn(
              "flex h-7 items-center justify-center gap-1.5 rounded-sm px-3 text-label transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring",
              active
                ? "bg-surface-1 font-semibold text-text-primary shadow-sm"
                : "text-text-muted hover:text-text-primary",
            )}
          >
            <Icon aria-hidden="true" className="size-4" />
            {label}
          </Link>
        );
      })}
    </nav>
  );
}
