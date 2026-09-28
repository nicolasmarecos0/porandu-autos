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
      className="group relative flex w-full flex-col items-center gap-1 rounded-md px-0.5 py-2.5 text-caption text-text-secondary transition-[color,background-color] hover:bg-surface-3 hover:text-text-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring aria-[current=page]:bg-accent-soft aria-[current=page]:text-text-primary"
    >
      <span
        aria-hidden="true"
        className="absolute top-1/2 -left-1 h-6 w-0.5 -translate-y-1/2 rounded-full bg-accent opacity-0 shadow-glow-accent transition-opacity group-aria-[current=page]:opacity-100"
      />
      <span className="text-text-muted transition-colors group-hover:text-text-primary group-aria-[current=page]:text-accent-strong">
        {icon}
      </span>
      <span className="max-w-full truncate">{label}</span>
    </Link>
  );
}
