import type { Metadata } from "next";
import { getNavItem } from "@/components/shell/navigation";
import { StockView } from "@/components/stock/stock-view";
import { getStockList } from "@/db/queries/vehicles";

const { label } = getNavItem("stock");

export const metadata: Metadata = { title: label };

/*
 * La Stock List sale de PostgreSQL por el loader tenant-scoped (H1.3A):
 * requireTenant() → withTenant() → RLS. La página no conoce Drizzle ni usa
 * fixtures.
 */
export default async function StockPage() {
  const vehicles = await getStockList();
  return <StockView title={label} vehicles={vehicles} />;
}
