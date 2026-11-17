import { OpportunityTableSkeleton } from "@/components/shell/route-skeletons";

/** Estado de carga de /opportunities/table (DEC-058). */
export default function OpportunitiesTableLoading() {
  return <OpportunityTableSkeleton title="Tabla de oportunidades" />;
}
