import { getNavItem } from "@/components/shell/navigation";
import { OpportunityQueueSkeleton } from "@/components/shell/route-skeletons";

const { label } = getNavItem("opportunities");

/*
 * Estado de carga de /opportunities (DEC-058). Está en el grupo `(queue)`
 * para que su boundary no envuelva a la Tabla, el Embudo ni el detalle, que
 * tienen el suyo: el prefetch de Next llega hasta el primer loading.js.
 */
export default function OpportunitiesLoading() {
  return <OpportunityQueueSkeleton title={label} />;
}
