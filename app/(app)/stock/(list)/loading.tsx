import { getNavItem } from "@/components/shell/navigation";
import { StockSkeleton } from "@/components/shell/route-skeletons";

const { label } = getNavItem("stock");

/*
 * Estado de carga de /stock (DEC-058). Está en el grupo `(list)` para que su
 * boundary no envuelva al Catálogo, que tiene el suyo.
 */
export default function StockLoading() {
  return <StockSkeleton title={label} />;
}
