import { Badge } from "@/components/ui/badge";

/** Empty state de B1: solo nombre del módulo y estado de construcción. */
export function ModulePlaceholder({ title }: { title: string }) {
  return (
    <div className="p-gutter">
      <header className="flex flex-wrap items-center gap-3 rounded-lg border border-l-4 border-border-subtle border-l-brand bg-surface-1 px-6 py-5 shadow-card">
        <h1 className="text-title text-text-primary">{title}</h1>
        <Badge tone="brand">
          <span aria-hidden="true" className="size-1.5 rounded-full bg-brand" />
          B1 · En construcción
        </Badge>
      </header>
    </div>
  );
}
