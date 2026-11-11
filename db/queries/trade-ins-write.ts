import "server-only";

import { and, eq, inArray } from "drizzle-orm";

import type { Money } from "@/domains/money";
import type { Stage } from "@/domains/opportunities/stages";
import {
  ACTIVE_TRADE_IN_STATUSES,
  planTradeInAppraisal,
  planTradeInDecision,
  planTradeInRegistration,
  type TradeInActor,
  type TradeInAppraisal,
  type TradeInDecisionId,
  type TradeInStatus,
  type TradeInTarget,
  type TradeInVehicle,
} from "@/domains/opportunities/trade-ins";

import { opportunities, tradeIns } from "../schema";
import {
  withTenant,
  type ScopedTransaction,
  type TenantContext,
} from "../tenant";
import { stageFromDb } from "./opportunities";

/*
 * Escrituras de la toma de usados (Hito 20, DEC-052 §3). La única puerta
 * son las Server Actions de lib/trade-ins/actions.ts (registerTradeIn(),
 * appraiseTradeIn() y changeTradeInStatus()), que obtienen el contexto con
 * requireTenant() y leen el pedido antes de llegar acá; ESLint impide
 * importar este módulo desde cualquier otro lado. El ingreso al stock no
 * pasa por acá: lo escribe el cierre Ganada (db/queries/close-opportunity.ts).
 *
 *   TenantContext → withTenant() → la oportunidad en la organización
 *   activa, bloqueada FOR SHARE → la toma, bloqueada FOR UPDATE → plan del
 *   dominio sobre las filas bloqueadas → INSERT / UPDATE … AND status = <el
 *   leído> → RLS + CHECKs + trigger trade_ins_change_guard → COMMIT
 *
 * - El cliente solo identifica la oportunidad o la toma y manda el usado,
 *   la tasación o la decisión. Organización, autor, estado de origen,
 *   sellos y reloj no salen del pedido: los fijan el contexto, la fila
 *   bloqueada y la base.
 * - Orden de los bloqueos, siempre: oportunidad → toma. El cierre Ganada
 *   bloquea la oportunidad FOR UPDATE (y después la unidad y la toma), así
 *   que una decisión y un cierre simultáneos se serializan: el segundo lee
 *   el estado ya confirmado. Nunca una toma aceptada después de un cierre
 *   que no la vio. El trigger toma el mismo bloqueo compartido (defensa en
 *   profundidad).
 * - El dominio decide sobre las filas bloqueadas y la base lo vuelve a
 *   exigir con su trigger (el rol de admin para tasar, con
 *   private.user_admin_org_ids()): un rechazo suyo se informa igual que el
 *   del dominio.
 * - Una oportunidad o una toma inexistente o de otra organización es
 *   `not_found`, sin revelar cuál de las dos.
 */

/** Rechazos del trigger y de los índices → resultado para el usuario. */
const CONSTRAINT_OUTCOMES = {
  trade_ins_opportunity_closed: "opportunity_closed",
  trade_ins_appraisal_requires_admin: "requires_admin",
  trade_ins_offer_required: "offer_price_required",
  trade_ins_active_opportunity_key: "already_registered",
} as const;

type ConstraintOutcome =
  (typeof CONSTRAINT_OUTCOMES)[keyof typeof CONSTRAINT_OUTCOMES];

/** `constraint_name` de un error de PostgreSQL envuelto por Drizzle. */
function constraintOutcomeOf(error: unknown): ConstraintOutcome | undefined {
  const cause =
    error instanceof Error && typeof error.cause === "object"
      ? error.cause
      : error;
  if (typeof cause !== "object" || cause === null) return undefined;
  const name = (cause as { constraint_name?: unknown }).constraint_name;
  return typeof name === "string" && name in CONSTRAINT_OUTCOMES
    ? CONSTRAINT_OUTCOMES[name as keyof typeof CONSTRAINT_OUTCOMES]
    : undefined;
}

/** La oportunidad en la organización activa, bloqueada en modo compartido. */
async function lockOpportunity(
  tx: ScopedTransaction,
  organizationId: string,
  opportunityId: string,
): Promise<Stage | null> {
  const [row] = await tx
    .select({ stage: opportunities.stage })
    .from(opportunities)
    .where(
      and(
        eq(opportunities.organizationId, organizationId),
        eq(opportunities.id, opportunityId),
      ),
    )
    .for("share");
  return row ? stageFromDb[row.stage] : null;
}

/* ── Registrar ──────────────────────────────────────────────────────────── */

export type NewTradeIn = Readonly<{
  opportunityId: string;
  vehicle: TradeInVehicle;
  /**
   * La tasación que cargó un admin en el mismo formulario: se registra y se
   * tasa en la misma transacción. Null para un seller (o si no la cargó).
   */
  appraisal: TradeInAppraisal | null;
}>;

export type RegisterTradeInOutcome =
  | Readonly<{
      outcome: "registered";
      tradeInId: string;
      opportunityId: string;
      status: TradeInStatus;
    }>
  | Readonly<{ outcome: "opportunity_closed"; opportunityId: string }>
  | Readonly<{ outcome: "already_registered"; opportunityId: string }>
  /** Tasar en el alta es de un admin. Nada cambió. */
  | Readonly<{ outcome: "requires_admin"; opportunityId: string }>
  | Readonly<{ outcome: "not_found" }>;

export async function insertTradeIn(
  ctx: TenantContext,
  request: NewTradeIn,
  actor: TradeInActor,
): Promise<RegisterTradeInOutcome> {
  const { opportunityId } = request;
  try {
    return await withTenant(ctx, async (tx) => {
      // Ya validado por withTenant(): un contexto emitido por Tenant Resolution.
      const { organizationId, userId } = ctx;
      const stage = await lockOpportunity(tx, organizationId, opportunityId);
      if (stage === null) return { outcome: "not_found" };

      const [active] = await tx
        .select({ status: tradeIns.status })
        .from(tradeIns)
        .where(
          and(
            eq(tradeIns.organizationId, organizationId),
            eq(tradeIns.opportunityId, opportunityId),
            inArray(tradeIns.status, [...ACTIVE_TRADE_IN_STATUSES]),
          ),
        )
        .limit(1);
      const plan = planTradeInRegistration(stage, active?.status ?? null);
      if (plan.kind === "opportunity_closed") {
        return { outcome: "opportunity_closed", opportunityId };
      }
      if (plan.kind === "already_registered") {
        return { outcome: "already_registered", opportunityId };
      }
      if (request.appraisal !== null && !actor.isAdmin) {
        return { outcome: "requires_admin", opportunityId };
      }

      const { vehicle } = request;
      const [created] = await tx
        .insert(tradeIns)
        .values({
          organizationId,
          opportunityId,
          brand: vehicle.brand,
          model: vehicle.model,
          version: vehicle.version,
          year: vehicle.year,
          km: vehicle.km,
          plate: vehicle.plate,
          createdBy: userId,
        })
        .returning({ id: tradeIns.id, status: tradeIns.status });
      if (!created) throw new Error("trade-in insert returned no row");
      if (request.appraisal === null) {
        return {
          outcome: "registered",
          tradeInId: created.id,
          opportunityId,
          status: created.status,
        };
      }

      // Registrar y tasar en un solo acto: la tasación pasa por el mismo
      // trigger que cualquier otra (admin, sello y reloj de la base).
      const appraised = await writeAppraisal(
        tx,
        organizationId,
        created.id,
        created.status,
        request.appraisal,
      );
      return {
        outcome: "registered",
        tradeInId: created.id,
        opportunityId,
        status: appraised,
      };
    });
  } catch (error) {
    // Dos altas simultáneas: el índice único parcial deja una sola vigente.
    const outcome = constraintOutcomeOf(error);
    if (outcome === "already_registered" || outcome === "opportunity_closed") {
      return { outcome, opportunityId };
    }
    if (outcome === "requires_admin") {
      return { outcome, opportunityId };
    }
    throw error;
  }
}

/** UPDATE de la tasación, compare-and-set sobre el estado leído. */
async function writeAppraisal(
  tx: ScopedTransaction,
  organizationId: string,
  tradeInId: string,
  from: TradeInStatus,
  appraisal: TradeInAppraisal,
): Promise<TradeInStatus> {
  const [updated] = await tx
    .update(tradeIns)
    .set({
      status: "appraised",
      currency: appraisal.currency,
      estimatedRepairCost: appraisal.estimatedRepairCost,
      offerPrice: appraisal.offerPrice,
    })
    .where(
      and(
        eq(tradeIns.organizationId, organizationId),
        eq(tradeIns.id, tradeInId),
        eq(tradeIns.status, from),
      ),
    )
    .returning({ status: tradeIns.status });
  if (!updated) throw new Error("trade-in appraisal affected no row");
  return updated.status;
}

/* ── La toma bloqueada ──────────────────────────────────────────────────── */

/** El usado, para nombrarlo en la respuesta: "Toyota Vitz 2015". */
export type TradeInIdentity = Readonly<{
  brand: string;
  model: string;
  year: number;
}>;

type LockedTradeIn = Readonly<{
  opportunityId: string;
  target: TradeInTarget;
  identity: TradeInIdentity;
}>;

/**
 * La toma y su oportunidad, bloqueadas en el orden de siempre: primero se
 * lee a qué oportunidad pertenece (es inmutable), se bloquea la
 * oportunidad y después la toma.
 */
async function lockTradeIn(
  tx: ScopedTransaction,
  organizationId: string,
  tradeInId: string,
): Promise<LockedTradeIn | null> {
  const owned = and(
    eq(tradeIns.organizationId, organizationId),
    eq(tradeIns.id, tradeInId),
  );
  const [owner] = await tx
    .select({ opportunityId: tradeIns.opportunityId })
    .from(tradeIns)
    .where(owned)
    .limit(1);
  if (!owner) return null;
  const stage = await lockOpportunity(tx, organizationId, owner.opportunityId);
  // La FK compuesta garantiza la oportunidad de la misma organización.
  if (stage === null) return null;

  const [row] = await tx
    .select({
      status: tradeIns.status,
      currency: tradeIns.currency,
      estimatedRepairCost: tradeIns.estimatedRepairCost,
      offerPrice: tradeIns.offerPrice,
      brand: tradeIns.brand,
      model: tradeIns.model,
      year: tradeIns.year,
    })
    .from(tradeIns)
    .where(owned)
    .for("update");
  if (!row) return null;
  const appraisal =
    row.currency !== null &&
    row.estimatedRepairCost !== null &&
    row.offerPrice !== null
      ? {
          currency: row.currency,
          estimatedRepairCost: row.estimatedRepairCost,
          offerPrice: row.offerPrice,
        }
      : null;
  return {
    opportunityId: owner.opportunityId,
    target: { status: row.status, opportunityStage: stage, appraisal },
    identity: { brand: row.brand, model: row.model, year: row.year },
  };
}

/* ── Tasar ──────────────────────────────────────────────────────────────── */

export type TradeInAppraisalRequest = Readonly<{
  tradeInId: string;
  /** El estado que vio quien tasa: pendiente (tasar) o tasado (retasar). */
  seen: TradeInStatus;
  appraisal: TradeInAppraisal;
}>;

export type AppraiseTradeInOutcome =
  | Readonly<{
      outcome: "appraised";
      opportunityId: string;
      identity: TradeInIdentity;
      from: TradeInStatus;
      offerPrice: Money;
    }>
  | Readonly<{
      outcome: "unchanged";
      opportunityId: string;
      identity: TradeInIdentity;
    }>
  | Readonly<{
      outcome: "conflict";
      opportunityId: string;
      identity: TradeInIdentity;
      current: TradeInStatus;
    }>
  | Readonly<{ outcome: "opportunity_closed"; opportunityId: string }>
  | Readonly<{ outcome: "requires_admin"; opportunityId: string }>
  | Readonly<{ outcome: "not_found" }>;

export async function writeTradeInAppraisal(
  ctx: TenantContext,
  request: TradeInAppraisalRequest,
  actor: TradeInActor,
): Promise<AppraiseTradeInOutcome> {
  let opportunityId: string | null = null;
  try {
    return await withTenant(ctx, async (tx) => {
      const { organizationId } = ctx;
      const locked = await lockTradeIn(tx, organizationId, request.tradeInId);
      if (!locked) return { outcome: "not_found" };
      opportunityId = locked.opportunityId;
      const { identity } = locked;

      const plan = planTradeInAppraisal(
        locked.target,
        request.seen,
        request.appraisal,
        actor,
      );
      switch (plan.kind) {
        case "unchanged":
          return { outcome: "unchanged", opportunityId, identity };
        case "conflict":
          return {
            outcome: "conflict",
            opportunityId,
            identity,
            current: plan.current,
          };
        case "opportunity_closed":
          return { outcome: "opportunity_closed", opportunityId };
        case "requires_admin":
          return { outcome: "requires_admin", opportunityId };
        case "appraise":
          break;
      }
      await writeAppraisal(
        tx,
        organizationId,
        request.tradeInId,
        plan.from,
        plan.appraisal,
      );
      return {
        outcome: "appraised",
        opportunityId,
        identity,
        from: plan.from,
        offerPrice: {
          amount: plan.appraisal.offerPrice,
          currency: plan.appraisal.currency,
        },
      };
    });
  } catch (error) {
    const outcome = constraintOutcomeOf(error);
    if (
      opportunityId !== null &&
      (outcome === "opportunity_closed" || outcome === "requires_admin")
    ) {
      return { outcome, opportunityId };
    }
    throw error;
  }
}

/* ── Decidir ────────────────────────────────────────────────────────────── */

export type TradeInDecisionRequest = Readonly<{
  tradeInId: string;
  decision: TradeInDecisionId;
}>;

export type DecideTradeInOutcome =
  | Readonly<{
      outcome: "changed";
      opportunityId: string;
      identity: TradeInIdentity;
      decision: TradeInDecisionId;
      from: TradeInStatus;
      to: TradeInStatus;
    }>
  | Readonly<{
      outcome: "unchanged";
      opportunityId: string;
      identity: TradeInIdentity;
      status: TradeInStatus;
    }>
  | Readonly<{
      outcome: "conflict";
      opportunityId: string;
      identity: TradeInIdentity;
      current: TradeInStatus;
    }>
  | Readonly<{ outcome: "offer_price_required"; opportunityId: string }>
  | Readonly<{ outcome: "opportunity_closed"; opportunityId: string }>
  | Readonly<{ outcome: "not_found" }>;

export async function writeTradeInDecision(
  ctx: TenantContext,
  request: TradeInDecisionRequest,
): Promise<DecideTradeInOutcome> {
  let opportunityId: string | null = null;
  try {
    return await withTenant(ctx, async (tx) => {
      const { organizationId } = ctx;
      const locked = await lockTradeIn(tx, organizationId, request.tradeInId);
      if (!locked) return { outcome: "not_found" };
      opportunityId = locked.opportunityId;
      const { identity } = locked;

      const plan = planTradeInDecision(locked.target, request.decision);
      switch (plan.kind) {
        case "unchanged":
          return {
            outcome: "unchanged",
            opportunityId,
            identity,
            status: plan.status,
          };
        case "conflict":
          return {
            outcome: "conflict",
            opportunityId,
            identity,
            current: plan.current,
          };
        case "offer_price_required":
          return { outcome: "offer_price_required", opportunityId };
        case "opportunity_closed":
          return { outcome: "opportunity_closed", opportunityId };
        case "change":
          break;
      }
      const [updated] = await tx
        .update(tradeIns)
        .set({ status: plan.to })
        .where(
          and(
            eq(tradeIns.organizationId, organizationId),
            eq(tradeIns.id, request.tradeInId),
            eq(tradeIns.status, plan.from),
          ),
        )
        .returning({ id: tradeIns.id });
      if (!updated) throw new Error("trade-in decision affected no row");
      return {
        outcome: "changed",
        opportunityId,
        identity,
        decision: plan.decision,
        from: plan.from,
        to: plan.to,
      };
    });
  } catch (error) {
    const outcome = constraintOutcomeOf(error);
    if (
      opportunityId !== null &&
      (outcome === "opportunity_closed" || outcome === "offer_price_required")
    ) {
      return { outcome, opportunityId };
    }
    throw error;
  }
}
