import type { Metadata } from "next";

import { PipelineView } from "@/components/pipeline/pipeline-view";
import { getOpportunityPipeline } from "@/db/queries/pipeline";

const TITLE = "Embudo de ventas";

export const metadata: Metadata = { title: TITLE };

/*
 * Embudo de ventas: el tablero de oportunidades por etapa, una vista de
 * Opportunities (DEC-001, B1 §4; propuesta DEC-048). El tablero sale de
 * PostgreSQL por el loader tenant-scoped: requireTenant() → withTenant() →
 * RLS. La página no conoce Drizzle. Mover una tarjeta usa las Server
 * Actions de DEC-032 (avances) y DEC-034 (cierres).
 */
export default async function OpportunityPipelinePage() {
  const board = await getOpportunityPipeline();
  return <PipelineView title={TITLE} board={board} />;
}
