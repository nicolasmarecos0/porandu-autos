import "server-only";

import { and, eq, isNull } from "drizzle-orm";

import {
  planOpportunityClosure,
  type Closure,
  type ClosureOutcome,
} from "@/domains/opportunities/closure";
import type { Stage } from "@/domains/opportunities/stages";

import { opportunities } from "../schema";
import { withTenant, type TenantContext } from "../tenant";
import { stageFromDb } from "./opportunities";

/*
 * Cierre comercial de una oportunidad (DEC-034): ganada o perdida, con sus
 * metadatos. La única puerta es la Server Action closeOpportunity()
 * (lib/opportunities/actions.ts), que obtiene el contexto con
 * requireTenant() y valida el pedido antes de llegar acá; ESLint impide
 * importar este módulo desde cualquier otro lado.
 *
 *   TenantContext → withTenant() → SELECT … FOR UPDATE (etapa y unidad) →
 *   planOpportunityClosure() (dominio) → UPDATE … AND stage = <la leída>
 *   AND vehicle_id = <la leída> → RLS + CHECKs de cierre + trigger → COMMIT
 *
 * - El cliente solo identifica la oportunidad y manda el cierre ya
 *   validado. La etapa de origen y la unidad las lee este módulo de la fila
 *   bloqueada, y `organization_id` sale del contexto (defensa en
 *   profundidad: la policy de UPDATE exige además una organización con
 *   membership activa).
 * - La regla la decide el dominio sobre la fila bloqueada (el pase existe;
 *   ganar exige la unidad vinculada) y la base la vuelve a exigir: los
 *   CHECKs no dejan una fila cerrada sin sus metadatos completos y el
 *   trigger no deja escribirlos fuera del pase que cierra ni cambiarlos
 *   después. Si este módulo tuviera un bug, la base igual lo rechaza (23514).
 * - Escribe la etapa y los metadatos en una sola UPDATE: los del otro
 *   resultado quedan NULL. `updated_at` lo fija el trigger con el reloj de la
 *   base; `last_activity_at` no cambia (DEC-034 §9), ni la unidad, ni su
 *   stock (la unidad vendida sigue `available`, DEC-034 §12).
 * - Concurrencia: el FOR UPDATE serializa los pedidos sobre una misma
 *   oportunidad. El segundo lee la etapa ya confirmada y el dominio decide
 *   sobre ella: el mismo cierre es `unchanged` (sin reescribir los
 *   metadatos) y el otro resultado, `invalid_transition`. Nunca ganada y
 *   perdida, nunca dos cierres.
 * - Una oportunidad inexistente o de otra organización es `not_found`, sin
 *   revelar cuál de las dos.
 */

export type ClosureRequest = Readonly<{
  opportunityId: string;
  closure: Closure;
}>;

export type CloseOpportunityOutcome =
  /** Este pedido cerró la oportunidad. */
  | Readonly<{
      outcome: "closed";
      opportunityId: string;
      from: Stage;
      to: ClosureOutcome;
    }>
  /** Ya estaba cerrada así: no se escribió nada. */
  | Readonly<{
      outcome: "unchanged";
      opportunityId: string;
      stage: ClosureOutcome;
    }>
  /** El pase no existe. `current` es la etapa real. Nada cambió. */
  | Readonly<{
      outcome: "invalid_transition";
      opportunityId: string;
      current: Stage;
    }>
  /** Ganar sin una unidad vinculada. Nada cambió. */
  | Readonly<{ outcome: "vehicle_required"; opportunityId: string }>
  /** No existe, o no es de la organización activa. Nada cambió. */
  | Readonly<{ outcome: "not_found" }>;

/** Las columnas de un cierre: las del otro resultado, en NULL. */
function closureColumns(closure: Closure) {
  if (closure.outcome === "lost") {
    return {
      stage: "lost",
      lossReason: closure.lossReason,
      lossNotes: closure.lossNotes,
      salePrice: null,
      saleCurrency: null,
      paymentMethod: null,
      deliveryStatus: null,
      deliveryDate: null,
    } as const;
  }
  return {
    stage: "won",
    lossReason: null,
    lossNotes: null,
    salePrice: closure.salePrice.amount,
    saleCurrency: closure.salePrice.currency,
    paymentMethod: closure.paymentMethod,
    deliveryStatus: closure.deliveryStatus,
    deliveryDate: closure.deliveryDate,
  } as const;
}

export async function closeOpportunityWithMetadata(
  ctx: TenantContext,
  request: ClosureRequest,
): Promise<CloseOpportunityOutcome> {
  return withTenant(ctx, async (tx) => {
    // Ya validado por withTenant(): un contexto emitido por Tenant Resolution.
    const { organizationId } = ctx;
    const { opportunityId, closure } = request;
    const opportunity = and(
      eq(opportunities.id, opportunityId),
      eq(opportunities.organizationId, organizationId),
    );

    const [current] = await tx
      .select({
        stage: opportunities.stage,
        vehicleId: opportunities.vehicleId,
      })
      .from(opportunities)
      .where(opportunity)
      .for("update");
    if (!current) return { outcome: "not_found" };
    const from = stageFromDb[current.stage];

    const plan = planOpportunityClosure(
      { stage: from, vehicleId: current.vehicleId },
      closure,
    );
    switch (plan.kind) {
      case "unchanged":
        return { outcome: "unchanged", opportunityId, stage: plan.stage };
      case "invalid_transition":
        return { outcome: "invalid_transition", opportunityId, current: from };
      case "vehicle_required":
        return { outcome: "vehicle_required", opportunityId };
      case "close":
        break;
    }

    // La fila está bloqueada, así que etapa y unidad no pueden haber
    // cambiado; la condición es una barrera más contra un bug de este módulo.
    const updated = await tx
      .update(opportunities)
      .set(closureColumns(plan.closure))
      .where(
        and(
          opportunity,
          eq(opportunities.stage, current.stage),
          current.vehicleId === null
            ? isNull(opportunities.vehicleId)
            : eq(opportunities.vehicleId, current.vehicleId),
        ),
      )
      .returning({ id: opportunities.id });
    if (updated.length !== 1) {
      throw new Error("opportunity closure affected an unexpected row count");
    }
    return {
      outcome: "closed",
      opportunityId,
      from: plan.from,
      to: plan.closure.outcome,
    };
  });
}
