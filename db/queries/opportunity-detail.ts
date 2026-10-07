import "server-only";

import { and, eq } from "drizzle-orm";

import {
  demandDetail,
  demandSummary,
  type DemandDetail,
  type DemandSummary,
  type LegacyInterest,
} from "@/domains/demand/presentation";
import { resolveDemand, type DemandRow } from "@/domains/demand/resolver";
import type { Stage } from "@/domains/opportunities/types";
import { requireTenant } from "@/lib/tenant/session";

import { contacts, opportunities } from "../schema";
import { withTenant } from "../tenant";
import { selectDemandRows } from "./demand-rows";
import { stageFromDb } from "./opportunities";

/*
 * Detalle de una oportunidad en /opportunities/[id] (H1.4, DEC-030 §10):
 * por qué Porandú cree que el cliente busca lo que busca.
 *
 *   request → requireTenant() → TenantContext → withTenant() → oportunidad
 *   y ledger filtrados por la organización activa → RLS → resolver →
 *   ViewModel
 *
 * - Un id que no es UUID no llega a la base. Uno de otra organización (aun
 *   con membership activa en ella) o inexistente da null: la página
 *   responde notFound() sin revelar cuál de los dos fue.
 * - La oportunidad y su ledger se leen en la misma transacción.
 * - El autor se presenta como "Vos" u "Otro miembro" contra el usuario de la
 *   request: ningún id de usuario llega a la página.
 * - Solo lee: no toca `last_activity_at` ni nada del ledger.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Lo que la página recibe: encabezado, detalle y el resumen para editar. */
export type OpportunityDetail = Readonly<{
  id: string;
  contactName: string;
  stage: Stage;
  demand: DemandDetail;
  /** Lo mismo que recibe la card "Busca": lo que necesita el drawer. */
  summary: DemandSummary;
}>;

/** Texto opcional del legado: vacío o en blanco no cuenta. */
function present(value: string | null): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

/** Loader de /opportunities/[id]: null si no es de la organización activa. */
export async function getOpportunityDetail(
  id: string,
): Promise<OpportunityDetail | null> {
  const ctx = await requireTenant();
  if (!UUID.test(id)) return null;
  const opportunityId = id.toLowerCase();

  const found = await withTenant(ctx, async (tx) => {
    const [opportunity] = await tx
      .select({
        id: opportunities.id,
        stage: opportunities.stage,
        createdAt: opportunities.createdAt,
        interestModel: opportunities.interestModel,
        interestVersion: opportunities.interestVersion,
        contactName: contacts.name,
      })
      .from(opportunities)
      .innerJoin(
        contacts,
        and(
          eq(contacts.organizationId, opportunities.organizationId),
          eq(contacts.id, opportunities.contactId),
        ),
      )
      .where(
        and(
          eq(opportunities.organizationId, ctx.organizationId),
          eq(opportunities.id, opportunityId),
        ),
      )
      .limit(1);
    if (!opportunity) return null;
    const ledger = await selectDemandRows(tx, ctx.organizationId, [
      opportunity.id,
    ]);
    const rows: readonly DemandRow[] = ledger.get(opportunity.id) ?? [];
    return { opportunity, rows };
  });
  if (!found) return null;

  const { opportunity, rows } = found;
  const truth = resolveDemand(rows);
  const model = present(opportunity.interestModel);
  const version = present(opportunity.interestVersion);
  const legacy: LegacyInterest = {
    ...(model ? { model } : {}),
    ...(version ? { version } : {}),
  };
  return {
    id: opportunity.id,
    contactName: opportunity.contactName,
    stage: stageFromDb[opportunity.stage],
    demand: demandDetail(truth, {
      viewerUserId: ctx.userId,
      createdAt: opportunity.createdAt,
      legacy,
    }),
    summary: demandSummary(truth, legacy),
  };
}
