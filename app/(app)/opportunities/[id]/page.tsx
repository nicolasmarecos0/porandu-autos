import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { OpportunityDetailView } from "@/components/opportunities/opportunity-detail";
import { getNavItem } from "@/components/shell/navigation";
import { getOpportunityDetail } from "@/db/queries/opportunity-detail";

const { label } = getNavItem("opportunities");

export const metadata: Metadata = { title: label };

/*
 * Detalle de una oportunidad (H1.4, DEC-030 §10): lo que busca el cliente y
 * por qué Porandú lo cree. Loader tenant-scoped: requireTenant() →
 * withTenant() → RLS. Un id inválido, de otra organización o inexistente da
 * notFound(), sin distinguir cuál.
 */
export default async function OpportunityDetailPage({
  params,
}: PageProps<"/opportunities/[id]">) {
  const { id } = await params;
  const detail = await getOpportunityDetail(id);
  if (!detail) notFound();
  return <OpportunityDetailView {...detail} />;
}
