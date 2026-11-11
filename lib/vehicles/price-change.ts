import {
  parseVehiclePrice,
  VEHICLE_PRICE_FIELDS,
  type VehiclePriceErrors,
  type VehiclePriceValues,
} from "@/domains/vehicles/price";
import type { VehicleStatus } from "@/domains/vehicles/stock";
import type { UnauthorizedRoleState } from "@/lib/auth/roles";

/*
 * Pedido y respuesta de la Server Action changeVehiclePrice() (Hito 22,
 * DEC-054 §3). El pedido solo identifica la unidad y trae el precio y su
 * moneda: organización, estado, usuario y reloj no salen de acá. Nada de
 * esto expone la base.
 */

type Unit = Readonly<{
  vehicleId: string;
  brand: string;
  model: string;
  year: number;
}>;

export type ChangeVehiclePriceState =
  /** Este pedido cambió el precio. `priceLabel`: el nuevo, para el aviso. */
  | (Unit & Readonly<{ status: "changed"; priceLabel: string }>)
  /** Ya tenía ese precio: nada cambió. */
  | (Unit & Readonly<{ status: "unchanged" }>)
  /** Vendida o entregada: el precio no cambia más. */
  | (Unit & Readonly<{ status: "locked"; current: VehicleStatus }>)
  /** El rol de la membership no edita precios (UNAUTHORIZED_ROLE). */
  | UnauthorizedRoleState
  | Readonly<{
      status: "invalid";
      errors: VehiclePriceErrors;
      values: VehiclePriceValues;
    }>
  | Readonly<{ status: "not_found" }>
  | Readonly<{ status: "failed"; values: VehiclePriceValues }>
  | null;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function text(value: FormDataEntryValue | null): string {
  return typeof value === "string" ? value : "";
}

export function priceValuesOf(formData: FormData): VehiclePriceValues {
  return {
    price: text(formData.get(VEHICLE_PRICE_FIELDS.price)),
    currency: text(formData.get(VEHICLE_PRICE_FIELDS.currency)),
  };
}

export type ParsedVehiclePriceChange =
  | Readonly<{
      kind: "ok";
      vehicleId: string;
      price: { amount: string; currency: "PYG" | "USD" };
      values: VehiclePriceValues;
    }>
  | Readonly<{ kind: "not_found" }>
  | Readonly<{
      kind: "invalid";
      errors: VehiclePriceErrors;
      values: VehiclePriceValues;
    }>;

/** Lee el pedido (input no confiable). */
export function parseVehiclePriceChange(
  formData: FormData,
): ParsedVehiclePriceChange {
  const vehicleId = text(formData.get(VEHICLE_PRICE_FIELDS.vehicleId)).trim();
  if (!UUID.test(vehicleId)) return { kind: "not_found" };
  const values = priceValuesOf(formData);
  const parsed = parseVehiclePrice(values);
  if (!parsed.ok) return { kind: "invalid", errors: parsed.errors, values };
  return {
    kind: "ok",
    vehicleId: vehicleId.toLowerCase(),
    price: parsed.price,
    values,
  };
}
