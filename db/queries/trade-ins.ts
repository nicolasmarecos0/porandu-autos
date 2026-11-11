import "server-only";

import { and, desc, eq } from "drizzle-orm";

import type { TradeInRow } from "@/domains/opportunities/trade-in-presentation";

import { tradeIns } from "../schema";
import type { ScopedTransaction } from "../tenant";

/*
 * Lectura de las tomas de usados de una oportunidad (Hito 20, DEC-052 §4),
 * dentro de la transacción del loader de /opportunities/[id]
 * (requireTenant() → withTenant()). Filtro explícito por la organización
 * activa además de RLS (ADR-001 §2). Solo lee.
 */

/** Cota de lo que se lee: una vigente y su historial de rechazadas. */
export const OPPORTUNITY_TRADE_IN_LIMIT = 50;

export async function selectOpportunityTradeIns(
  tx: ScopedTransaction,
  organizationId: string,
  opportunityId: string,
): Promise<TradeInRow[]> {
  return tx
    .select({
      id: tradeIns.id,
      status: tradeIns.status,
      brand: tradeIns.brand,
      model: tradeIns.model,
      version: tradeIns.version,
      year: tradeIns.year,
      km: tradeIns.km,
      plate: tradeIns.plate,
      currency: tradeIns.currency,
      estimatedRepairCost: tradeIns.estimatedRepairCost,
      offerPrice: tradeIns.offerPrice,
      createdBy: tradeIns.createdBy,
      createdAt: tradeIns.createdAt,
      appraisedBy: tradeIns.appraisedBy,
      appraisedAt: tradeIns.appraisedAt,
      convertedVehicleId: tradeIns.convertedVehicleId,
      updatedAt: tradeIns.updatedAt,
    })
    .from(tradeIns)
    .where(
      and(
        eq(tradeIns.organizationId, organizationId),
        eq(tradeIns.opportunityId, opportunityId),
      ),
    )
    .orderBy(desc(tradeIns.createdAt), desc(tradeIns.id))
    .limit(OPPORTUNITY_TRADE_IN_LIMIT);
}
