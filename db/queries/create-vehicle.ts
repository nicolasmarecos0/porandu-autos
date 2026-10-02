import "server-only";

import { vehicles } from "../schema";
import { withTenant, type TenantContext } from "../tenant";

/*
 * Alta rápida de una unidad (H1.3B). La única puerta es la Server Action
 * createVehicle() (lib/vehicles/actions.ts), que obtiene el contexto con
 * requireTenant() y valida el formulario antes de llegar acá; ESLint impide
 * importar este módulo desde cualquier otro lado.
 *
 *   TenantContext → withTenant() → INSERT → COMMIT
 *
 * - `organization_id` sale siempre del contexto, nunca del input. La policy
 *   de INSERT (WITH CHECK) rechaza igualmente una organización sin
 *   membership activa del usuario de la request.
 * - La unidad nace en preparación: el estado lo fija este módulo (nunca el
 *   cliente) y lo exige la misma policy. El id y los timestamps los pone la
 *   base.
 * - Precio y moneda van juntos o no van: el CHECK de la base también lo
 *   exige. Sin precio, la unidad queda "sin dato".
 */

type VehicleRecord = typeof vehicles.$inferInsert;

/** Datos ya validados y normalizados (lib/vehicles/new-vehicle.ts). */
export type NewVehicle = Readonly<{
  brand: string;
  model: string;
  version: string | null;
  year: number;
  /** `0` es una unidad 0 km; null es sin dato. */
  km: number | null;
  /** Precio publicado exacto (decimal en texto, nunca float), con su moneda. */
  price: Readonly<{
    amount: string;
    currency: NonNullable<VehicleRecord["currency"]>;
  }> | null;
}>;

/** La unidad tal como quedó en la base. */
export type CreatedVehicle = Readonly<{
  id: string;
  brand: string;
  model: string;
  year: number;
}>;

/** Estado inicial de toda unidad cargada a mano. No lo elige el cliente. */
const INITIAL_STATUS = "in_preparation" satisfies VehicleRecord["status"];

export async function createVehicleInPreparation(
  ctx: TenantContext,
  input: NewVehicle,
): Promise<CreatedVehicle> {
  return withTenant(ctx, async (tx) => {
    // Ya validado por withTenant(): un contexto emitido por Tenant Resolution.
    const { organizationId } = ctx;
    const [vehicle] = await tx
      .insert(vehicles)
      .values({
        organizationId,
        brand: input.brand,
        model: input.model,
        version: input.version,
        year: input.year,
        km: input.km,
        price: input.price?.amount ?? null,
        currency: input.price?.currency ?? null,
        status: INITIAL_STATUS,
      })
      .returning({
        id: vehicles.id,
        brand: vehicles.brand,
        model: vehicles.model,
        year: vehicles.year,
      });
    if (!vehicle) throw new Error("INSERT … RETURNING returned no row");
    return vehicle;
  });
}
