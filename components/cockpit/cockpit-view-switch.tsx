import Link from "next/link";
import type { ComponentType } from "react";

import { cn } from "@/components/ui/cn";
import { ChartIcon, CockpitIcon, type IconProps } from "@/components/ui/icons";
import { COCKPIT_METRICS_PATH, COCKPIT_PATH } from "@/lib/cockpit/paths";

/*
 * Selector de vista del Cockpit (propuesta DEC-050): el feed de actividad
 * del día (DEC-047), que sigue siendo el home, o las Métricas del salón
 * para la gerencia. Son enlaces de navegación, con la vista actual en
 * `aria-current="page"`, como Cola · Embudo (DEC-048 §1) e Inventario ·
 * Catálogo (DEC-049 §1): se comparte, se vuelve atrás y se recarga. Sin
 * prefetch: cada vista hace sus lecturas tenant-scoped al abrirse, no al
 * pasar el mouse (DEC-043 §6). La navegación global no cambia.
 */

export type CockpitViewId = "feed" | "metrics";

const VIEWS: readonly Readonly<{
  id: CockpitViewId;
  href: string;
  label: string;
  icon: ComponentType<IconProps>;
}>[] = [
  { id: "feed", href: COCKPIT_PATH, label: "Cockpit", icon: CockpitIcon },
  {
    id: "metrics",
    href: COCKPIT_METRICS_PATH,
    label: "Métricas",
    icon: ChartIcon,
  },
];

export function CockpitViewSwitch({
  current,
  className,
}: {
  current: CockpitViewId;
  className?: string;
}) {
  return (
    <nav
      aria-label="Vista del Cockpit"
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
