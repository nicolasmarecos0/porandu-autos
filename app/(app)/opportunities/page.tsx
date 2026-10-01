import type { Metadata } from "next";
import { OpportunitiesView } from "@/components/opportunities/opportunities-view";
import { getNavItem } from "@/components/shell/navigation";
import { getOpportunityQueue } from "@/db/queries/opportunities";

const { label } = getNavItem("opportunities");

export const metadata: Metadata = { title: label };

/*
 * La cola sale de PostgreSQL por el loader tenant-scoped (H1.1):
 * requireTenant() → withTenant() → RLS. La página no conoce Drizzle.
 */
export default async function OpportunitiesPage() {
  const { opportunities, referenceMinuteOfDay, scoreComposition } =
    await getOpportunityQueue();
  return (
    <OpportunitiesView
      title={label}
      opportunities={opportunities}
      referenceMinuteOfDay={referenceMinuteOfDay}
      scoreComposition={scoreComposition}
    />
  );
}
