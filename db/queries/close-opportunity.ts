import "server-only";

import { and, eq, isNull } from "drizzle-orm";

import {
  planOpportunityClosure,
  type Closure,
  type ClosureOutcome,
} from "@/domains/opportunities/closure";
import type { Stage } from "@/domains/opportunities/stages";
import {
  planVehicleSale,
  type SaleConflictReason,
} from "@/domains/vehicles/lifecycle";
import type { VehicleStatus } from "@/domains/vehicles/stock";

import { opportunities, vehicles } from "../schema";
import { withTenant, type TenantContext } from "../tenant";
import { stageFromDb } from "./opportunities";
import { statusFromDb, statusToDb } from "./vehicles";

/*
 * Cierre comercial de una oportunidad (DEC-034): ganada o perdida, con sus
 * metadatos. La única puerta es la Server Action closeOpportunity()
 * (lib/opportunities/actions.ts), que obtiene el contexto con
 * requireTenant() y valida el pedido antes de llegar acá; ESLint impide
 * importar este módulo desde cualquier otro lado.
 *
 *   TenantContext → withTenant() → SELECT … FOR UPDATE (etapa y unidad) →
 *   planOpportunityClosure() (dominio) → [Ganada: SELECT … FOR UPDATE de
 *   la unidad → planVehicleSale() (dominio)] → UPDATE … AND stage = <la
 *   leída> AND vehicle_id = <la leída> → RLS + CHECKs de cierre + trigger
 *   → [Ganada: UPDATE de la unidad a `sold` → trigger de vehicles] →
 *   constraint trigger diferido → COMMIT
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
 *   base; `last_activity_at` no cambia (DEC-034 §9), ni la unidad vinculada.
 * - Ganada vende la unidad (Hito 19, propuesta DEC-051 §4): en la misma
 *   transacción, la unidad vinculada (la vendida, DEC-034 §3) se bloquea,
 *   el dominio confirma que está disponible o reservada y pasa a `sold`
 *   después de la oportunidad (el trigger de vehicles exige la oportunidad
 *   ganada para vender). Una unidad ya vendida o en preparación es
 *   `vehicle_conflict`: no se escribe nada, ni la oportunidad. El
 *   constraint trigger diferido de 0020 lo vuelve a exigir al COMMIT: una
 *   ganada sin su unidad vendida revierte la transacción entera.
 * - Perdida no toca el stock: una unidad reservada sigue reservada (la
 *   reserva se libera desde Stock).
 * - Concurrencia: el FOR UPDATE serializa los pedidos sobre una misma
 *   oportunidad. El segundo lee la etapa ya confirmada y el dominio decide
 *   sobre ella: el mismo cierre es `unchanged` (sin reescribir los
 *   metadatos) y el otro resultado, `invalid_transition`. Nunca ganada y
 *   perdida, nunca dos cierres. El bloqueo de la unidad (siempre después
 *   del de la oportunidad) serializa también dos ganadas que comparten la
 *   unidad y un cambio de estado desde Stock: nunca se vende dos veces.
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
  /**
   * Ganar con una unidad que no se puede vender (ya vendida o en
   * preparación). `current` es su estado real. Nada cambió.
   */
  | Readonly<{
      outcome: "vehicle_conflict";
      opportunityId: string;
      current: VehicleStatus;
      reason: SaleConflictReason;
    }>
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

    // Ganada: la unidad vinculada se vende en esta misma transacción. Se
    // bloquea después de la oportunidad, siempre en ese orden.
    let sale: { vehicleId: string; from: VehicleStatus } | null = null;
    if (plan.closure.outcome === "won" && current.vehicleId !== null) {
      const [unit] = await tx
        .select({ status: vehicles.status })
        .from(vehicles)
        .where(
          and(
            eq(vehicles.organizationId, organizationId),
            eq(vehicles.id, current.vehicleId),
          ),
        )
        .for("update");
      // La FK compuesta garantiza la unidad de la misma organización.
      if (!unit) throw new Error("the linked vehicle is missing");
      const salePlan = planVehicleSale(statusFromDb[unit.status]);
      if (salePlan.kind === "conflict") {
        return {
          outcome: "vehicle_conflict",
          opportunityId,
          current: salePlan.current,
          reason: salePlan.reason,
        };
      }
      sale = { vehicleId: current.vehicleId, from: salePlan.from };
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

    if (sale) {
      // La unidad está bloqueada desde arriba: su estado no cambió. El
      // trigger de vehicles exige el pase y la oportunidad ya ganada.
      const sold = await tx
        .update(vehicles)
        .set({ status: "sold" })
        .where(
          and(
            eq(vehicles.organizationId, organizationId),
            eq(vehicles.id, sale.vehicleId),
            eq(vehicles.status, statusToDb[sale.from]),
          ),
        )
        .returning({ id: vehicles.id });
      if (sold.length !== 1) {
        throw new Error("vehicle sale affected an unexpected row count");
      }
    }
    return {
      outcome: "closed",
      opportunityId,
      from: plan.from,
      to: plan.closure.outcome,
    };
  });
}
