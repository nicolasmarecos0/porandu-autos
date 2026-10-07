import "server-only";

import { and, eq } from "drizzle-orm";

import { DEMAND_FACTS, type DemandFact } from "@/domains/demand/facts";
import {
  planDemandCapture,
  type DemandCapture,
  type DemandItemError,
  type NewDemandRow,
} from "@/domains/demand/planner";

import { opportunities, opportunityDemandFacts } from "../schema";
import {
  withTenant,
  type ScopedTransaction,
  type TenantContext,
} from "../tenant";
import { selectDemandRows } from "./demand-rows";

/*
 * Único módulo de escritura de la demanda (H1.4, DEC-030 §8, C-8). Lo usan
 * dos puertas, y ESLint impide importarlo desde cualquier otro lado:
 * - el alta de una oportunidad (db/queries/create-opportunity.ts), en la
 *   misma transacción que crea la oportunidad;
 * - la Server Action recordDemand() (lib/opportunities/actions.ts), que
 *   edita la demanda desde /opportunities.
 *
 *   transacción withTenant() → la oportunidad es de la organización →
 *   ledger actual → planDemandCapture() (dominio puro: validación, estado,
 *   target, previous, stale, pendientes) → un único INSERT multi-fila →
 *   COMMIT
 *
 * - Todo o nada: el planner aborta la captura entera ante cualquier ítem
 *   inválido, stale, con un pendiente sin resolver o inconsistente; si el
 *   INSERT falla, la transacción entera se revierte.
 * - `organization_id` sale del contexto; `status`, `source_kind`,
 *   `recorded_by`, `target` y `previous` los deriva el planner; `id` y
 *   `recorded_at` los pone la base. El cliente no elige ninguno.
 * - Compare-and-set: cada acto humano apunta al head que vio el usuario
 *   (`previous_member_fact_id`). Dos escrituras sobre el mismo head chocan
 *   en un índice único (23505); con varios facts cruzados puede haber un
 *   deadlock (40P01). En los dos casos: rollback, una sola re-planificación
 *   en una transacción nueva, sin escribir, y el resultado es `unchanged`
 *   si lo pedido ya está vigente o `stale` si no. Ningún acto humano se
 *   pierde en silencio: por eso esta tabla nunca usa ON CONFLICT (ESLint lo
 *   impide en este módulo).
 * - Nunca toca `opportunities.last_activity_at` (DEC-030 §10).
 */

export type DemandWriteOutcome =
  /** Se agregaron estas filas al ledger, una por fact. */
  | Readonly<{ kind: "written"; facts: readonly DemandFact[] }>
  | Readonly<{ kind: "unchanged" }>
  | Readonly<{ kind: "stale"; facts: readonly DemandFact[] }>
  | Readonly<{ kind: "pending_unresolved"; facts: readonly DemandFact[] }>
  | Readonly<{ kind: "invalid"; errors: readonly DemandItemError[] }>
  | Readonly<{ kind: "not_found" }>
  | Readonly<{ kind: "inconsistent"; facts: readonly DemandFact[] }>
  | Readonly<{ kind: "forbidden" }>;

type DemandInsert = typeof opportunityDemandFacts.$inferInsert;

/** Fila planificada → columnas. Las de valor que no son del fact, NULL. */
function toInsert(
  organizationId: string,
  opportunityId: string,
  row: NewDemandRow,
): DemandInsert {
  const value = {
    brand: null,
    model: null,
    yearMin: null,
    yearMax: null,
    amount: null,
    currency: null,
    purchaseType: null,
    tradeIn: null,
  } satisfies Partial<DemandInsert>;
  const columns: Partial<DemandInsert> = { ...value };
  if (row.value !== null) {
    switch (row.fact) {
      case "desired_vehicle":
        columns.brand = row.value.brand ?? null;
        columns.model = row.value.model ?? null;
        break;
      case "year_range":
        columns.yearMin = row.value.min ?? null;
        columns.yearMax = row.value.max ?? null;
        break;
      case "budget_max":
      case "down_payment":
        columns.amount = row.value.amount;
        columns.currency = row.value.currency;
        break;
      case "purchase_type":
        columns.purchaseType = row.value;
        break;
      case "trade_in_intent":
        columns.tradeIn = row.value;
        break;
    }
  }
  return {
    ...columns,
    organizationId,
    opportunityId,
    fact: row.fact,
    status: row.status,
    sourceKind: row.sourceKind,
    recordedBy: row.recordedBy,
    targetFactId: row.targetFactId,
    previousMemberFactId: row.previousMemberFactId,
    evidenceText: row.evidenceText,
  };
}

/** Ledger de la oportunidad, o null si no es de la organización activa. */
async function ledgerOf(
  tx: ScopedTransaction,
  organizationId: string,
  opportunityId: string,
) {
  const [opportunity] = await tx
    .select({ id: opportunities.id })
    .from(opportunities)
    .where(
      and(
        eq(opportunities.organizationId, organizationId),
        eq(opportunities.id, opportunityId),
      ),
    );
  if (!opportunity) return null;
  const rows = await selectDemandRows(tx, organizationId, [opportunityId]);
  return rows.get(opportunityId) ?? [];
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Agrega al ledger lo que pide la captura, dentro de una transacción
 * withTenant() ya abierta (el alta la comparte con la oportunidad nueva).
 * `organizationId` es el del TenantContext de esa transacción.
 */
export async function appendDemand(
  tx: ScopedTransaction,
  organizationId: string,
  capture: DemandCapture,
): Promise<DemandWriteOutcome> {
  // Un id malformado no llega a la base: no existe.
  const rows = UUID.test(capture.opportunityId)
    ? await ledgerOf(tx, organizationId, capture.opportunityId)
    : null;
  const plan = planDemandCapture(rows, capture);
  if (plan.kind !== "write") return plan;

  await tx
    .insert(opportunityDemandFacts)
    .values(
      plan.rows.map((row) =>
        toInsert(organizationId, capture.opportunityId, row),
      ),
    );
  return { kind: "written", facts: plan.rows.map((row) => row.fact) };
}

/** Choque de dos actos humanos sobre el mismo head, o deadlock entre facts. */
export function isChainConflict(error: unknown): boolean {
  const cause =
    error instanceof Error && typeof error.cause === "object"
      ? (error.cause as { code?: unknown; constraint_name?: unknown } | null)
      : null;
  if (!cause) return false;
  if (cause.code === "40P01") return true;
  return (
    cause.code === "23505" &&
    (cause.constraint_name === "opportunity_demand_facts_member_root_key" ||
      cause.constraint_name === "opportunity_demand_facts_member_next_key")
  );
}

/**
 * Escribe una captura en su propia transacción withTenant(). Ante un choque
 * de la cadena humana, una sola re-planificación (sin escribir) decide entre
 * `unchanged` y `stale`.
 */
export async function recordDemandCapture(
  ctx: TenantContext,
  capture: DemandCapture,
): Promise<DemandWriteOutcome> {
  try {
    return await withTenant(ctx, (tx) =>
      // Ya validado por withTenant(): un contexto emitido por Tenant Resolution.
      appendDemand(tx, ctx.organizationId, capture),
    );
  } catch (error) {
    if (!isChainConflict(error)) throw error;
  }
  const replanned = await withTenant(ctx, async (tx) =>
    planDemandCapture(
      await ledgerOf(tx, ctx.organizationId, capture.opportunityId),
      capture,
    ),
  );
  if (replanned.kind === "unchanged") return replanned;
  if (replanned.kind === "stale") return replanned;
  // Otro acto humano escribió entre medio: lo pedido se decidió sobre otro
  // estado, aunque ese otro acto todavía no se vea o se haya revertido.
  return {
    kind: "stale",
    facts: DEMAND_FACTS.filter((fact) =>
      capture.items.some((item) => item.fact === fact),
    ),
  };
}
