import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { OpportunityDetailView } from "@/components/opportunities/opportunity-detail";
import { getNavItem } from "@/components/shell/navigation";
import { getOpportunityDetail } from "@/db/queries/opportunity-detail";
import { NEW_QUOTE_VEHICLE_PARAM } from "@/lib/quotes/paths";

const { label } = getNavItem("opportunities");

export const metadata: Metadata = { title: label };

/*
 * Detalle de una oportunidad (H1.4, DEC-030 §10): lo que busca el cliente y
 * por qué Porandú lo cree, y sus matches en el stock disponible (H1.5,
 * DEC-031 §5). Loader tenant-scoped: requireTenant() → withTenant() → RLS.
 * Un id inválido, de otra organización o inexistente da notFound(), sin
 * distinguir cuál. `?quote=<unidad>` (atajo "Cotizar" del catálogo,
 * propuesta DEC-049) abre "Nueva cotización" con esa unidad, si se puede.
 */
export default async function OpportunityDetailPage({
  params,
  searchParams,
}: PageProps<"/opportunities/[id]">) {
  const [{ id }, query] = await Promise.all([params, searchParams]);
  const detail = await getOpportunityDetail(id);
  if (!detail) notFound();
  const quote = query[NEW_QUOTE_VEHICLE_PARAM];
  return (
    <OpportunityDetailView
      {...detail}
      quoteVehicleId={typeof quote === "string" ? quote : undefined}
    />
  );
}
