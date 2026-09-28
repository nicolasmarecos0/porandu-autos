import type { ReactNode } from "react";

/** Atajo de teclado visible. */
export function Kbd({ children }: { children: ReactNode }) {
  return (
    <kbd className="inline-flex h-4.5 min-w-4.5 items-center justify-center rounded-xs border border-border-default bg-surface-1 px-1 font-sans text-[0.625rem] leading-none font-semibold text-text-muted">
      {children}
    </kbd>
  );
}
