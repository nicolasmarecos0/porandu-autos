import type { Metadata } from "next";

import { CatalogView } from "@/components/stock/catalog/catalog-view";
import { getStockCatalog } from "@/db/queries/stock-catalog";

const TITLE = "Catálogo";

export const metadata: Metadata = { title: "Catálogo de stock" };

/*
 * Catálogo visual del stock: la galería para mostrar en el salón, una vista
 * de Stock (DEC-001; propuesta DEC-049). Las unidades salen de PostgreSQL
 * por el loader tenant-scoped: requireTenant() → withTenant() → RLS. La
 * página no conoce Drizzle ni usa fixtures. Los filtros viajan en la URL y
 * los lee la vista (useSearchParams), así el primer render del servidor ya
 * llega filtrado. El catálogo no escribe nada: sus atajos llevan a la
 * agenda y a la oportunidad.
 */
export default async function StockCatalogPage() {
  const catalog = await getStockCatalog();
  return <CatalogView title={TITLE} catalog={catalog} />;
}
