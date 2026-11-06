import "server-only";

import { and, eq } from "drizzle-orm";

import {
  planVehicleStatusChange,
  type StockTransitionId,
} from "@/domains/vehicles/lifecycle";
import type { VehicleStatus } from "@/domains/vehicles/stock";

import { vehicles } from "../schema";
import { withTenant, type TenantContext } from "../tenant";
import { statusFromDb, statusToDb } from "./vehicles";

/*
 * Ciclo de vida de una unidad desde Stock (Hito 19, propuesta DEC-051):
 * poner en el salón, reservar y liberar la reserva. La única puerta es la
 * Server Action changeVehicleStatus() (lib/vehicles/actions.ts), que obtiene
 * el contexto con requireTenant() y valida el pedido antes de llegar acá;
 * ESLint impide importar este módulo desde cualquier otro lado. Vender no
 * pasa por acá: la unidad se vende al cerrar Ganada su oportunidad
 * (db/queries/close-opportunity.ts).
 *
 *   TenantContext → withTenant() → SELECT … FOR UPDATE (la unidad) →
 *   planVehicleStatusChange() (dominio) → UPDATE … AND status = <el leído>
 *   → RLS (policy de UPDATE) + trigger de transiciones → COMMIT
 *
 * - El cliente solo identifica la unidad y la transición. El estado actual
 *   lo lee este módulo de la fila bloqueada, el destino lo fija la
 *   transición y `organization_id` sale del contexto (defensa en
 *   profundidad: la policy de UPDATE exige además una organización con
 *   membership activa).
 * - La regla la decide el dominio sobre la fila bloqueada y la base la
 *   vuelve a exigir: el trigger rechaza un pase que no está en la máquina,
 *   cualquier cambio de otra columna y una venta sin oportunidad ganada
 *   (23514). Si este módulo tuviera un bug, la base igual lo rechaza.
 * - Solo cambian `status` y `updated_at` (lo fija el trigger con el reloj
 *   de la base): son las únicas columnas con UPDATE para authenticated.
 * - Concurrencia: el FOR UPDATE serializa los pedidos sobre una misma
 *   unidad, también contra un cierre Ganada que la vende (que la bloquea
 *   igual). El segundo lee el estado ya confirmado: la misma transición es
 *   `unchanged` y una que ya no aplica (p. ej. reservar una vendida, o
 *   poner en el salón una que otro ya reservó) es `conflict`, sin escribir.
 * - Una unidad inexistente o de otra organización es `not_found`, sin
 *   revelar cuál de las dos.
 *
 * `changed` con destino `available` (poner en el salón o liberar una
 * reserva) es el punto de integración futuro con Matching: una unidad que
 * vuelve a estar a la venta (DEC-028 §7). Si necesita registrarse de forma
 * atómica, va en esta misma transacción.
 */

/** La unidad, para nombrarla en la respuesta. */
export type StatusChangeVehicle = Readonly<{
  id: string;
  brand: string;
  model: string;
  year: number;
}>;

export type VehicleStatusChangeRequest = Readonly<{
  vehicleId: string;
  transition: StockTransitionId;
}>;

export type VehicleStatusChangeOutcome =
  /** Este pedido hizo el pase. */
  | Readonly<{
      outcome: "changed";
      vehicle: StatusChangeVehicle;
      transition: StockTransitionId;
      from: VehicleStatus;
      to: VehicleStatus;
    }>
  /** Ya estaba en el destino: no se escribió nada. */
  | Readonly<{
      outcome: "unchanged";
      vehicle: StatusChangeVehicle;
      transition: StockTransitionId;
      status: VehicleStatus;
    }>
  /** Ya no está en el origen de la transición. Nada cambió. */
  | Readonly<{
      outcome: "conflict";
      vehicle: StatusChangeVehicle;
      transition: StockTransitionId;
      current: VehicleStatus;
    }>
  /** No existe, o no es de la organización activa. Nada cambió. */
  | Readonly<{ outcome: "not_found" }>;

const identity = {
  id: vehicles.id,
  brand: vehicles.brand,
  model: vehicles.model,
  year: vehicles.year,
};

export async function transitionVehicleStatus(
  ctx: TenantContext,
  request: VehicleStatusChangeRequest,
): Promise<VehicleStatusChangeOutcome> {
  return withTenant(ctx, async (tx) => {
    // Ya validado por withTenant(): un contexto emitido por Tenant Resolution.
    const { organizationId } = ctx;
    const { vehicleId, transition } = request;
    const unit = and(
      eq(vehicles.id, vehicleId),
      eq(vehicles.organizationId, organizationId),
    );

    const [current] = await tx
      .select({ ...identity, status: vehicles.status })
      .from(vehicles)
      .where(unit)
      .for("update");
    if (!current) return { outcome: "not_found" };
    const { status, ...vehicle } = current;

    const plan = planVehicleStatusChange(statusFromDb[status], transition);
    switch (plan.kind) {
      case "unchanged":
        return {
          outcome: "unchanged",
          vehicle,
          transition: plan.transition,
          status: plan.status,
        };
      case "conflict":
        return {
          outcome: "conflict",
          vehicle,
          transition: plan.transition,
          current: plan.current,
        };
      case "sale_requires_closure":
        // Una transición de Stock nunca es vender: el tipo lo impide y el
        // dominio lo vuelve a decir. Si llegara, no se escribe nada.
        throw new Error("a sale is not a Stock transition");
      case "change":
        break;
    }

    // La fila está bloqueada, así que el estado no puede haber cambiado; la
    // condición es una barrera más contra un bug de este módulo.
    const updated = await tx
      .update(vehicles)
      .set({ status: statusToDb[plan.to] })
      .where(and(unit, eq(vehicles.status, status)))
      .returning({ id: vehicles.id });
    if (updated.length !== 1) {
      throw new Error("vehicle status change affected an unexpected row count");
    }
    return {
      outcome: "changed",
      vehicle,
      transition: plan.transition,
      from: plan.from,
      to: plan.to,
    };
  });
}
