import Link from "next/link";
import type { ComponentType } from "react";

import { cn } from "@/components/ui/cn";
import { BoardIcon, QueueIcon, type IconProps } from "@/components/ui/icons";
import { OPPORTUNITIES_PATH, PIPELINE_PATH } from "@/lib/opportunities/paths";

/*
 * Selector de vista de Opportunities (DEC-001: Pipeline es una vista de
 * Opportunities, no un ítem de la navegación global; propuesta DEC-048):
 * la cola operativa (DEC-015) o el embudo de ventas por etapa. Son enlaces
 * de navegación, con la vista actual en `aria-current="page"`: se comparte,
 * se vuelve atrás y se recarga. Sin prefetch: cada vista hace sus lecturas
 * tenant-scoped al abrirse, no al pasar el mouse (como DEC-043 §6).
 */

export type OpportunitiesViewId = "queue" | "pipeline";

const VIEWS: readonly Readonly<{
  id: OpportunitiesViewId;
  href: string;
  label: string;
  icon: ComponentType<IconProps>;
}>[] = [
  { id: "queue", href: OPPORTUNITIES_PATH, label: "Cola", icon: QueueIcon },
  { id: "pipeline", href: PIPELINE_PATH, label: "Embudo", icon: BoardIcon },
];

export function OpportunitiesViewSwitch({
  current,
  className,
}: {
  current: OpportunitiesViewId;
  className?: string;
}) {
  return (
    <nav
      aria-label="Vista de oportunidades"
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
