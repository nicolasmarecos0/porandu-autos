"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { Tooltip } from "@/components/ui/tooltip";
import { isNavItemActive } from "./navigation";

type NavLinkProps = {
  href: string;
  label: string;
  icon: ReactNode;
};

export function NavLink({ href, label, icon }: NavLinkProps) {
  const pathname = usePathname();
  const isActive = isNavItemActive(href, pathname);

  return (
    <Tooltip content={label} side="right">
      <Link
        href={href}
        aria-current={isActive ? "page" : undefined}
        className="flex size-11 items-center justify-center rounded-md text-text-inverse-muted transition-[color,background-color] hover:bg-surface-inverse-hover hover:text-text-inverse focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring-inverse aria-[current=page]:bg-brand aria-[current=page]:text-text-inverse"
      >
        {icon}
        <span className="sr-only">{label}</span>
      </Link>
    </Tooltip>
  );
}
