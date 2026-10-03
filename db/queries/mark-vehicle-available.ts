import "server-only";

import { and, eq } from "drizzle-orm";

import type { VehicleStatus } from "@/domains/vehicles/stock";

import { vehicles } from "../schema";
import { withTenant, type TenantContext } from "../tenant";
import { statusFromDb } from "./vehicles";

/*
 * Disponibilidad de una unidad (H1.3C): la transición in_preparation →
 * available. La única puerta es la Server Action markVehicleAvailable()
 * (lib/vehicles/actions.ts), que obtiene el contexto con requireTenant() y
 * valida el id antes de llegar acá; ESLint impide importar este módulo desde
 * cualquier otro lado.
 *
 *   TenantContext → withTenant() → UPDATE … WHERE id AND organization_id
 *   AND status = 'in_preparation' → RLS (USING / WITH CHECK) → COMMIT
 *
 * - El destino (`available`) y el origen exigido (`in_preparation`) los fija
 *   este módulo; el cliente solo identifica la unidad. `organization_id` sale
 *   del contexto (defensa en profundidad: la policy de UPDATE exige además
 *   una organización con membership activa, la fila actual en preparación y
 *   la nueva disponible).
 * - Solo cambian `status` y `updated_at` (lo pone Drizzle): son las únicas
 *   columnas con UPDATE para authenticated.
 * - Concurrencia: el UPDATE depende del estado actual. Si dos requests marcan
 *   la misma unidad a la vez, la segunda espera el lock de la fila, vuelve a
 *   evaluar el WHERE sobre la versión ya confirmada y no encuentra nada que
 *   actualizar: una sola transición, sin error ni sobrescritura.
 * - Si no se actualizó ninguna fila, una lectura en la misma transacción
 *   distingue "ya no estaba en preparación" (la unidad es visible) de "no
 *   existe o no es de esta organización" (no lo es), sin revelar nada de
 *   otro tenant.
 *
 * `became_available` es la única señal de que esta llamada hizo la
 * transición: pasa una sola vez por unidad. Es el punto donde Hito 3
 * (Match Engine) engancha "vehicle became available → matching"; si
 * necesita registrarlo de forma atómica, va en esta misma transacción, solo
 * cuando el UPDATE devolvió la fila.
 */

/** Origen exigido y destino fijo de la transición, como los guarda la base. */
const FROM = "in_preparation" satisfies typeof vehicles.$inferSelect.status;
const TO = "available" satisfies typeof vehicles.$inferSelect.status;

/** La unidad, para nombrarla en la respuesta. */
export type AvailabilityVehicle = Readonly<{
  id: string;
  brand: string;
  model: string;
  year: number;
}>;

export type AvailabilityTransition =
  /** Esta llamada hizo la transición: la unidad pasó a disponible. */
  | Readonly<{ outcome: "became_available"; vehicle: AvailabilityVehicle }>
  /** La unidad es de la organización, pero ya no estaba en preparación. */
  | Readonly<{
      outcome: "unchanged";
      vehicle: AvailabilityVehicle;
      status: VehicleStatus;
    }>
  /** No existe, o no es de la organización activa. Nada cambió. */
  | Readonly<{ outcome: "not_found" }>;

const identity = {
  id: vehicles.id,
  brand: vehicles.brand,
  model: vehicles.model,
  year: vehicles.year,
};

export async function transitionVehicleToAvailable(
  ctx: TenantContext,
  vehicleId: string,
): Promise<AvailabilityTransition> {
  return withTenant(ctx, async (tx) => {
    // Ya validado por withTenant(): un contexto emitido por Tenant Resolution.
    const { organizationId } = ctx;
    const unit = and(
      eq(vehicles.id, vehicleId),
      eq(vehicles.organizationId, organizationId),
    );

    const [vehicle] = await tx
      .update(vehicles)
      .set({ status: TO })
      .where(and(unit, eq(vehicles.status, FROM)))
      .returning(identity);
    if (vehicle) return { outcome: "became_available", vehicle };

    const [current] = await tx
      .select({ ...identity, status: vehicles.status })
      .from(vehicles)
      .where(unit);
    if (!current) return { outcome: "not_found" };
    const { status, ...rest } = current;
    return {
      outcome: "unchanged",
      vehicle: rest,
      status: statusFromDb[status],
    };
  });
}
