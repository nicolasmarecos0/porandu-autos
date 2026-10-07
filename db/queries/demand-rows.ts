import "server-only";

import { and, eq, inArray } from "drizzle-orm";

import type { Currency } from "@/domains/money";
import type { DemandFact } from "@/domains/demand/facts";
import type { DemandRow } from "@/domains/demand/resolver";

import { opportunityDemandFacts } from "../schema";
import type { ScopedTransaction } from "../tenant";

/*
 * Lectura del ledger de demanda (H1.4, DEC-030): filas de
 * `opportunity_demand_facts` → filas del dominio (domains/demand), sobre las
 * que el resolver puro deriva Current Truth. Solo lee: corre dentro de una
 * transacción withTenant() que ya abrió quien llama (el loader de la cola,
 * el del detalle o el módulo de escritura) y filtra siempre por la
 * organización del contexto (defensa en profundidad sobre RLS).
 *
 * Lectura por lote: `organization_id = $1 AND opportunity_id = ANY($2)`,
 * servida por el índice `opportunity_demand_facts_scope_key`.
 */

type DemandRecord = typeof opportunityDemandFacts.$inferSelect;

/** Valor del fact según sus columnas (null en un rechazo). */
function valueOf(record: DemandRecord): DemandRow["value"] {
  if (record.status === "rejected") return null;
  const money = () =>
    record.amount !== null && record.currency !== null
      ? { amount: record.amount, currency: record.currency as Currency }
      : null;
  switch (record.fact as DemandFact) {
    case "desired_vehicle":
      return {
        ...(record.brand !== null ? { brand: record.brand } : {}),
        ...(record.model !== null ? { model: record.model } : {}),
      };
    case "year_range":
      return {
        ...(record.yearMin !== null ? { min: record.yearMin } : {}),
        ...(record.yearMax !== null ? { max: record.yearMax } : {}),
      };
    case "budget_max":
    case "down_payment":
      return money();
    case "purchase_type":
      return record.purchaseType;
    case "trade_in_intent":
      return record.tradeIn;
  }
}

/** Fila persistida → fila del dominio. `observedAt` no existe en H1.4. */
export function toDemandRow(record: DemandRecord): DemandRow {
  return {
    id: record.id,
    fact: record.fact,
    status: record.status,
    sourceKind: record.sourceKind,
    recordedBy: record.recordedBy,
    recordedAt: record.recordedAt,
    observedAt: null,
    targetFactId: record.targetFactId,
    previousMemberFactId: record.previousMemberFactId,
    value: valueOf(record),
    evidenceText: record.evidenceText,
  } as DemandRow;
}

/**
 * Ledger de demanda de varias oportunidades de la organización, agrupado por
 * oportunidad. Una oportunidad sin filas no aparece en el mapa.
 */
export async function selectDemandRows(
  tx: ScopedTransaction,
  organizationId: string,
  opportunityIds: readonly string[],
): Promise<Map<string, DemandRow[]>> {
  const byOpportunity = new Map<string, DemandRow[]>();
  if (opportunityIds.length === 0) return byOpportunity;
  const records = await tx
    .select()
    .from(opportunityDemandFacts)
    .where(
      and(
        eq(opportunityDemandFacts.organizationId, organizationId),
        inArray(opportunityDemandFacts.opportunityId, [...opportunityIds]),
      ),
    );
  for (const record of records) {
    const rows = byOpportunity.get(record.opportunityId) ?? [];
    rows.push(toDemandRow(record));
    byOpportunity.set(record.opportunityId, rows);
  }
  return byOpportunity;
}
