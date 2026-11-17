import { CatalogSkeleton } from "@/components/shell/route-skeletons";

/** Estado de carga de /stock/catalog (DEC-058). */
export default function CatalogLoading() {
  return <CatalogSkeleton title="Catálogo" />;
}
