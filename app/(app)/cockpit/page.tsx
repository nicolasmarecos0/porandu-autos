import type { Metadata } from "next";
import { BuildStatusBadge } from "@/components/shell/module-placeholder";
import { getNavItem } from "@/components/shell/navigation";
import { PageHeader } from "@/components/shell/page-header";
import { WorkspaceLayout } from "@/components/shell/workspace-layout";
import {
  ContextRailSkeleton,
  FeedPanelSkeleton,
  SummaryBandSkeleton,
} from "@/components/shell/workspace-skeletons";

const { label } = getNavItem("cockpit");

export const metadata: Metadata = { title: label };

export default function CockpitPage() {
  return (
    <WorkspaceLayout
      header={<PageHeader title={label} status={<BuildStatusBadge />} />}
      summary={<SummaryBandSkeleton />}
      aside={<ContextRailSkeleton />}
    >
      <FeedPanelSkeleton rows={4} />
      <FeedPanelSkeleton rows={3} />
    </WorkspaceLayout>
  );
}
