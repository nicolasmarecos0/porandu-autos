import type { Metadata } from "next";

import { OpportunitiesTableView } from "@/components/opportunities/opportunities-table-view";
import { getOpportunityQueue } from "@/db/queries/opportunities";

const TITLE = "Tabla de oportunidades";

export const metadata: Metadata = { title: TITLE };

/*
 * Tabla de oportunidades: el directorio de alta densidad con los scores por
 * columna, una vista de Opportunities (DEC-001, DEC-055). Lee la misma cola
 * que /opportunities con su loader tenant-scoped: requireTenant() →
 * withTenant() → RLS. La página no conoce Drizzle. Buscar, ordenar y
 * paginar no vuelven a leer: trabajan sobre esta lectura.
 */
export default async function OpportunitiesTablePage() {
  const { opportunities, referenceMinuteOfDay } = await getOpportunityQueue();
  return (
    <OpportunitiesTableView
      title={TITLE}
      opportunities={opportunities}
      referenceMinuteOfDay={referenceMinuteOfDay}
    />
  );
}
