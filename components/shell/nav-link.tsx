"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
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
    <Link
      href={href}
      aria-current={isActive ? "page" : undefined}
      className="group flex w-full flex-col items-center gap-1 rounded-md px-0.5 py-2.5 text-caption text-text-inverse-muted transition-[color,background-color] hover:bg-surface-inverse-hover hover:text-text-inverse focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring-inverse aria-[current=page]:bg-brand aria-[current=page]:text-text-inverse aria-[current=page]:shadow-sm"
    >
      {icon}
      <span className="max-w-full truncate">{label}</span>
    </Link>
  );
}
