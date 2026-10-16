"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

/*
 * Navegación interna de Configuración (Hito 6, DEC-038 §8): General y
 * Equipo. Son enlaces (cada pestaña es una ruta), no un tablist: la URL es
 * la fuente de la pestaña activa, que se marca con aria-current="page".
 */

export const SETTINGS_TABS = [
  { href: "/settings", label: "General" },
  { href: "/settings/team", label: "Equipo" },
] as const;

export function SettingsTabs() {
  const pathname = usePathname();
  return (
    <nav
      aria-label="Secciones de configuración"
      className="flex shrink-0 gap-1 border-b border-border-subtle bg-surface-1 px-gutter"
    >
      {SETTINGS_TABS.map(({ href, label }) => {
        const active = pathname === href;
        return (
          <Link
            key={href}
            href={href}
            aria-current={active ? "page" : undefined}
            className="-mb-px flex h-10 items-center border-b-2 border-transparent px-3 text-label font-semibold text-text-muted transition-[color,border-color] hover:text-text-primary focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-focus-ring aria-[current=page]:border-brand aria-[current=page]:text-brand-strong"
          >
            {label}
          </Link>
        );
      })}
    </nav>
  );
}
