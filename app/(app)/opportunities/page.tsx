import type { Metadata } from "next";
import { OpportunitiesView } from "@/components/opportunities/opportunities-view";
import { getNavItem } from "@/components/shell/navigation";
import { getOpportunityQueue } from "@/mocks/opportunities";

const { label } = getNavItem("opportunities");

export const metadata: Metadata = { title: label };

export default function OpportunitiesPage() {
  const { opportunities, referenceMinuteOfDay, scoreComposition } =
    getOpportunityQueue();
  return (
    <OpportunitiesView
      title={label}
      opportunities={opportunities}
      referenceMinuteOfDay={referenceMinuteOfDay}
      scoreComposition={scoreComposition}
    />
  );
}
