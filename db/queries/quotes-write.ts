import "server-only";

import { and, eq, inArray } from "drizzle-orm";

import type { Money } from "@/domains/money";
import type { Stage } from "@/domains/opportunities/stages";
import {
  quoteTotal,
  requiresAdminApproval,
  type Discount,
} from "@/domains/quotes/pricing";
import type { ParsedQuoteTerms } from "@/domains/quotes/request";
import {
  QUOTABLE_STAGES,
  QUOTABLE_VEHICLE_STATUSES,
  type QuoteStatus,
  type QuoteTransitionError,
  type QuoteTransitionTarget,
} from "@/domains/quotes/statuses";

import { opportunities, quotes, vehicles } from "../schema";
import { withTenant, type TenantContext } from "../tenant";
import { stageFromDb } from "./opportunities";

/*
 * Escrituras de las cotizaciones (Hito 10, DEC-042 §5 y §8). La única
 * puerta son las Server Actions de lib/quotes/actions.ts (createQuote() y
 * changeQuoteStatus()), que obtienen el contexto con requireTenant() y leen
 * el pedido antes de llegar acá; ESLint impide importar este módulo desde
 * cualquier otro lado.
 *
 * Alta:
 *
 *   TenantContext → withTenant() → la oportunidad cotizable y la unidad en
 *   stock con precio publicado, en la organización activa → validar las
 *   condiciones contra esa lista (domains/quotes/request.ts) → total
 *   (domains/quotes/pricing.ts) → INSERT → número (trigger) + RLS
 *   (WITH CHECK: misma lista que la unidad) + CHECKs → COMMIT
 *
 * - El cliente elige la oportunidad, la unidad, el descuento, la validez y
 *   las condiciones. La lista y su moneda salen de la unidad; organización,
 *   autor, estado inicial, número y reloj, del contexto y de la base.
 * - Una oportunidad nueva, cerrada, inexistente o de otra organización es
 *   `opportunity_unavailable`; una unidad fuera de stock, inexistente o de
 *   otra organización es `vehicle_unavailable`, sin revelar cuál. Una unidad
 *   en stock sin precio publicado es `vehicle_without_price`.
 *
 * Cambio de estado:
 *
 *   TenantContext → withTenant() → la cotización en la organización activa,
 *   bloqueada (FOR UPDATE) → estado esperado → su oportunidad y su unidad →
 *   plan del dominio → UPDATE status → trigger (matriz, validez,
 *   oportunidad, unidad, admin, inmutabilidad, sellos) → COMMIT
 *
 * - Compare-and-set: el pedido dice de qué estado parte. Si la cotización ya
 *   cambió (otra persona la movió), es `unchanged` con su estado real y no
 *   se escribe nada.
 * - El trigger vuelve a exigir las reglas con el reloj y el rol de la base:
 *   un rechazo suyo se informa igual que el del dominio. Dos aceptadas a la
 *   vez en la misma oportunidad las frena el índice único parcial.
 */

export type NewQuote = Readonly<{
  opportunityId: string;
  vehicleId: string;
}>;

export type CreateQuoteOutcome =
  | Readonly<{ outcome: "created"; quoteId: string; number: number }>
  | Readonly<{ outcome: "opportunity_unavailable" }>
  | Readonly<{ outcome: "vehicle_unavailable" }>
  | Readonly<{ outcome: "vehicle_without_price" }>
  /** Las condiciones no valen contra la lista real de la unidad. */
  | Readonly<{ outcome: "invalid"; parsed: ParsedQuoteTerms & { ok: false } }>;

/**
 * `terms` valida las condiciones contra la lista de la unidad, leída en la
 * misma transacción: así lo que se guarda es exactamente lo que se validó.
 */
export async function insertQuote(
  ctx: TenantContext,
  request: NewQuote,
  terms: (listPrice: Money) => ParsedQuoteTerms,
): Promise<CreateQuoteOutcome> {
  return withTenant(ctx, async (tx) => {
    // Ya validado por withTenant(): un contexto emitido por Tenant Resolution.
    const { organizationId, userId } = ctx;

    const [opportunity] = await tx
      .select({ id: opportunities.id })
      .from(opportunities)
      .where(
        and(
          eq(opportunities.organizationId, organizationId),
          eq(opportunities.id, request.opportunityId),
          inArray(opportunities.stage, [...QUOTABLE_STAGES]),
        ),
      )
      .limit(1);
    if (!opportunity) return { outcome: "opportunity_unavailable" };

    const [vehicle] = await tx
      .select({
        id: vehicles.id,
        price: vehicles.price,
        currency: vehicles.currency,
      })
      .from(vehicles)
      .where(
        and(
          eq(vehicles.organizationId, organizationId),
          eq(vehicles.id, request.vehicleId),
          inArray(vehicles.status, [...QUOTABLE_VEHICLE_STATUSES]),
        ),
      )
      .limit(1);
    if (!vehicle) return { outcome: "vehicle_unavailable" };
    if (vehicle.price === null || vehicle.currency === null) {
      return { outcome: "vehicle_without_price" };
    }

    const listPrice: Money = {
      amount: vehicle.price,
      currency: vehicle.currency,
    };
    const parsed = terms(listPrice);
    if (!parsed.ok) return { outcome: "invalid", parsed };
    const { discount, validUntil, notes } = parsed.terms;
    const total = quoteTotal(listPrice, discount);

    const [created] = await tx
      .insert(quotes)
      .values({
        organizationId,
        opportunityId: opportunity.id,
        vehicleId: vehicle.id,
        currency: listPrice.currency,
        listPrice: listPrice.amount,
        discountKind: discount.kind,
        discountValue: discount.kind === "none" ? null : discount.value,
        totalPrice: total.amount,
        validUntil,
        notes,
        createdBy: userId,
      })
      .returning({ id: quotes.id, number: quotes.number });
    if (!created) throw new Error("quote insert returned no row");
    return { outcome: "created", quoteId: created.id, number: created.number };
  });
}

export type QuoteStatusRequest = Readonly<{
  quoteId: string;
  from: QuoteStatus;
  to: QuoteStatus;
}>;

/** Lo que el plan del dominio necesita, leído con la cotización bloqueada. */
export type LockedQuote = QuoteTransitionTarget;

export type QuoteStatusOutcome =
  | Readonly<{ outcome: "changed"; status: QuoteStatus; opportunityId: string }>
  /** La cotización ya no estaba en `from`: no cambió nada. */
  | Readonly<{
      outcome: "unchanged";
      current: QuoteStatus;
      opportunityId: string;
    }>
  /** No existe o no es de la organización activa. */
  | Readonly<{ outcome: "not_found" }>
  /** La oportunidad ya tiene otra cotización aceptada. */
  | Readonly<{ outcome: "already_accepted"; opportunityId: string }>
  | Readonly<{
      outcome: QuoteTransitionError;
      opportunityId: string;
    }>;

/** Constraint del trigger o de un índice → resultado para el usuario. */
const CONSTRAINT_OUTCOMES: Readonly<
  Record<string, QuoteTransitionError | "already_accepted">
> = {
  quotes_status_transition: "invalid_transition",
  quotes_expired: "expired",
  quotes_opportunity_closed: "opportunity_closed",
  quotes_vehicle_unavailable: "vehicle_unavailable",
  quotes_discount_requires_admin: "requires_admin",
  quotes_accepted_opportunity_key: "already_accepted",
};

/**
 * `plan` decide con la fila bloqueada (domains/quotes/statuses.ts): así la
 * regla del dominio y la del trigger miran el mismo estado.
 */
export async function updateQuoteStatus(
  ctx: TenantContext,
  request: QuoteStatusRequest,
  plan: (locked: LockedQuote) => "ok" | QuoteTransitionError,
): Promise<QuoteStatusOutcome> {
  let opportunityId: string | null = null;
  try {
    return await withTenant(ctx, async (tx) => {
      const { organizationId } = ctx;
      const [row] = await tx
        .select({
          status: quotes.status,
          opportunityId: quotes.opportunityId,
          vehicleId: quotes.vehicleId,
          validUntil: quotes.validUntil,
          currency: quotes.currency,
          listPrice: quotes.listPrice,
          discountKind: quotes.discountKind,
          discountValue: quotes.discountValue,
        })
        .from(quotes)
        .where(
          and(
            eq(quotes.organizationId, organizationId),
            eq(quotes.id, request.quoteId),
          ),
        )
        .limit(1)
        .for("update");
      if (!row) return { outcome: "not_found" };
      opportunityId = row.opportunityId;
      if (row.status !== request.from) {
        return {
          outcome: "unchanged",
          current: row.status,
          opportunityId: row.opportunityId,
        };
      }

      const [opportunity] = await tx
        .select({ stage: opportunities.stage })
        .from(opportunities)
        .where(
          and(
            eq(opportunities.organizationId, organizationId),
            eq(opportunities.id, row.opportunityId),
          ),
        )
        .limit(1);
      const [vehicle] = await tx
        .select({ status: vehicles.status })
        .from(vehicles)
        .where(
          and(
            eq(vehicles.organizationId, organizationId),
            eq(vehicles.id, row.vehicleId),
          ),
        )
        .limit(1);
      // Las FKs compuestas garantizan las dos filas; sin ellas no hay plan.
      if (!opportunity || !vehicle) return { outcome: "not_found" };

      const stage: Stage = stageFromDb[opportunity.stage];
      const discount: Discount =
        row.discountKind === "none" || row.discountValue === null
          ? { kind: "none" }
          : { kind: row.discountKind, value: row.discountValue };
      const decision = plan({
        status: row.status,
        validUntil: row.validUntil,
        opportunityStage: stage,
        vehicleStatus: vehicle.status,
        requiresAdmin: requiresAdminApproval(
          { amount: row.listPrice, currency: row.currency },
          discount,
        ),
      });
      if (decision !== "ok") {
        return { outcome: decision, opportunityId: row.opportunityId };
      }

      if (request.to === "accepted") {
        const [accepted] = await tx
          .select({ id: quotes.id })
          .from(quotes)
          .where(
            and(
              eq(quotes.organizationId, organizationId),
              eq(quotes.opportunityId, row.opportunityId),
              eq(quotes.status, "accepted"),
            ),
          )
          .limit(1);
        if (accepted) {
          return {
            outcome: "already_accepted",
            opportunityId: row.opportunityId,
          };
        }
      }

      const [updated] = await tx
        .update(quotes)
        .set({ status: request.to })
        .where(
          and(
            eq(quotes.organizationId, organizationId),
            eq(quotes.id, request.quoteId),
            eq(quotes.status, request.from),
          ),
        )
        .returning({ status: quotes.status });
      if (!updated) throw new Error("quote update returned no row");
      return {
        outcome: "changed",
        status: updated.status,
        opportunityId: row.opportunityId,
      };
    });
  } catch (error) {
    // El reloj, el rol y los índices de la base mandan: un rechazo suyo se
    // informa igual que el del dominio.
    const constraint = constraintOf(error);
    const outcome =
      constraint === undefined ? undefined : CONSTRAINT_OUTCOMES[constraint];
    if (outcome !== undefined && opportunityId !== null) {
      return { outcome, opportunityId };
    }
    throw error;
  }
}

/** `constraint_name` de un error de PostgreSQL envuelto por Drizzle. */
function constraintOf(error: unknown): string | undefined {
  const cause =
    error instanceof Error && typeof error.cause === "object"
      ? error.cause
      : error;
  if (typeof cause !== "object" || cause === null) return undefined;
  const value = (cause as { constraint_name?: unknown }).constraint_name;
  return typeof value === "string" ? value : undefined;
}
