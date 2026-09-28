import { Badge } from "@/components/ui/badge";

/** Empty state de B1: solo nombre del módulo y estado de construcción. */
export function ModulePlaceholder({ title }: { title: string }) {
  return (
    <header className="flex flex-wrap items-center gap-3 px-gutter py-section">
      <h1 className="text-title text-text-primary">{title}</h1>
      <Badge>
        <span aria-hidden="true" className="size-1.5 rounded-full bg-accent" />
        B1 · En construcción
      </Badge>
    </header>
  );
}
