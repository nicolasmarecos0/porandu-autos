import type { Metadata } from "next";
import { BuildStatusBadge } from "@/components/shell/module-placeholder";
import { getNavItem } from "@/components/shell/navigation";
import { PageHeader } from "@/components/shell/page-header";
import { WorkspaceLayout } from "@/components/shell/workspace-layout";
import {
  ContextRailSkeleton,
  SummaryBandSkeleton,
  TablePanelSkeleton,
} from "@/components/shell/workspace-skeletons";

const { label } = getNavItem("opportunities");

export const metadata: Metadata = { title: label };

export default function OpportunitiesPage() {
  return (
    <WorkspaceLayout
      header={<PageHeader title={label} status={<BuildStatusBadge />} />}
      summary={<SummaryBandSkeleton />}
      aside={<ContextRailSkeleton />}
    >
      <TablePanelSkeleton rows={8} />
    </WorkspaceLayout>
  );
}
