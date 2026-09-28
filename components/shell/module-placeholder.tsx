import { Badge } from "@/components/ui/badge";
import { PageHeader } from "./page-header";
import { WorkspaceLayout } from "./workspace-layout";

/** Estado de construcción de un módulo en B1. */
export function BuildStatusBadge() {
  return (
    <Badge tone="brand">
      <span aria-hidden="true" className="size-1.5 rounded-full bg-brand" />
      B1 · En construcción
    </Badge>
  );
}

/** Empty state de B1: solo nombre del módulo y estado de construcción. */
export function ModulePlaceholder({ title }: { title: string }) {
  return (
    <WorkspaceLayout
      header={<PageHeader title={title} status={<BuildStatusBadge />} />}
    />
  );
}
