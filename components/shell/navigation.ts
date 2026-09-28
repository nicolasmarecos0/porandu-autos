import type { ComponentType } from "react";
import {
  CalendarIcon,
  CockpitIcon,
  ConversationsIcon,
  IntelligenceIcon,
  OpportunitiesIcon,
  RecoveryIcon,
  SettingsIcon,
  StockIcon,
  type IconProps,
} from "@/components/ui/icons";

export type NavItemId =
  | "cockpit"
  | "opportunities"
  | "stock"
  | "conversations"
  | "calendar"
  | "recovery"
  | "intelligence"
  | "settings";

export type NavItem = {
  id: NavItemId;
  href: `/${NavItemId}`;
  /** Copy visible en es-PY (DEC-011). */
  label: string;
  icon: ComponentType<IconProps>;
};

/** Global Navigation oficial (DEC-001). El orden es parte de la decisión. */
export const NAV_ITEMS: readonly NavItem[] = [
  { id: "cockpit", href: "/cockpit", label: "Cockpit", icon: CockpitIcon },
  {
    id: "opportunities",
    href: "/opportunities",
    label: "Oportunidades",
    icon: OpportunitiesIcon,
  },
  { id: "stock", href: "/stock", label: "Stock", icon: StockIcon },
  {
    id: "conversations",
    href: "/conversations",
    label: "Conversaciones",
    icon: ConversationsIcon,
  },
  {
    id: "calendar",
    href: "/calendar",
    label: "Calendario",
    icon: CalendarIcon,
  },
  {
    id: "recovery",
    href: "/recovery",
    label: "Recuperación",
    icon: RecoveryIcon,
  },
  {
    id: "intelligence",
    href: "/intelligence",
    label: "Inteligencia",
    icon: IntelligenceIcon,
  },
  {
    id: "settings",
    href: "/settings",
    label: "Configuración",
    icon: SettingsIcon,
  },
];

export function getNavItem(id: NavItemId): NavItem {
  const item = NAV_ITEMS.find((navItem) => navItem.id === id);
  if (!item) throw new Error(`Unknown nav item: ${id}`);
  return item;
}

/** Una ruta está activa en su raíz y en sus subrutas (p. ej. `/opportunities/[id]`). */
export function isNavItemActive(href: string, pathname: string): boolean {
  return pathname === href || pathname.startsWith(`${href}/`);
}
