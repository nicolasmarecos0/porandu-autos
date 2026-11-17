import type { Metadata } from "next";
import { OpportunitiesView } from "@/components/opportunities/opportunities-view";
import { getNavItem } from "@/components/shell/navigation";
import { getOpportunityQueue } from "@/db/queries/opportunities";
import { SELECTED_OPPORTUNITY_PARAM } from "@/lib/opportunities/paths";

const { label } = getNavItem("opportunities");

export const metadata: Metadata = { title: label };

/*
 * La cola sale de PostgreSQL por el loader tenant-scoped (H1.1):
 * requireTenant() → withTenant() → RLS. La página no conoce Drizzle.
 * `?op=<id>` (DEC-055, desde la tabla) abre la cola con esa oportunidad
 * seleccionada, si está en la cola.
 */
export default async function OpportunitiesPage({
  searchParams,
}: PageProps<"/opportunities">) {
  const [{ opportunities, referenceMinuteOfDay, scoreComposition }, query] =
    await Promise.all([getOpportunityQueue(), searchParams]);
  // `?op=` (DEC-055) solo elige entre lo que la cola ya leyó.
  const selected = query[SELECTED_OPPORTUNITY_PARAM];
  const initialSelectedId =
    typeof selected === "string" &&
    opportunities.some((opportunity) => opportunity.id === selected)
      ? selected
      : null;
  return (
    <OpportunitiesView
      title={label}
      opportunities={opportunities}
      referenceMinuteOfDay={referenceMinuteOfDay}
      scoreComposition={scoreComposition}
      initialSelectedId={initialSelectedId}
    />
  );
}
