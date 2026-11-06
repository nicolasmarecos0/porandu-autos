import {
  isStockTransitionId,
  VEHICLE_STATUS_CHANGE_FIELDS,
  type StockTransitionId,
} from "@/domains/vehicles/lifecycle";
import type { VehicleStatus } from "@/domains/vehicles/stock";

/*
 * Pedido y respuesta de la Server Action changeVehicleStatus() (Hito 19,
 * propuesta DEC-051). El pedido solo identifica la unidad y la transición
 * (poner en el salón, reservar o liberar): cualquier otro campo
 * (organización, estado de destino escrito a mano, datos de la unidad,
 * usuario, reloj) se ignora porque no tiene adónde ir. Nada de esto expone
 * la base: ni SQLSTATE, ni constraints, ni datos de otra organización.
 */

type Unit = Readonly<{
  vehicleId: string;
  brand: string;
  model: string;
  year: number;
}>;

/** Respuesta de changeVehicleStatus(). */
export type ChangeVehicleStatusState =
  /** Este pedido hizo el pase. */
  | (Unit &
      Readonly<{
        status: "changed";
        transition: StockTransitionId;
        from: VehicleStatus;
        to: VehicleStatus;
      }>)
  /** Ya estaba en el destino (otra persona hizo lo mismo): nada cambió. */
  | (Unit &
      Readonly<{
        status: "unchanged";
        transition: StockTransitionId;
        current: VehicleStatus;
      }>)
  /**
   * La unidad ya no está en el origen de la transición (otra persona la
   * cambió, o se vendió): nada cambió. `current` es su estado real.
   */
  | (Unit &
      Readonly<{
        status: "conflict";
        transition: StockTransitionId;
        current: VehicleStatus;
      }>)
  /** Vender desde Stock no existe: se registra al cerrar Ganada. */
  | Readonly<{ status: "sale_requires_closure" }>
  /** La transición no es una de Stock. Nada cambió. */
  | Readonly<{ status: "invalid" }>
  /** La unidad no existe o no es de la organización activa. */
  | Readonly<{ status: "not_found" }>
  /** Falla inesperada al guardar: nada cambió y se puede reintentar. */
  | Readonly<{ status: "failed" }>
  | null;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type ParsedVehicleStatusChange =
  | Readonly<{
      kind: "ok";
      vehicleId: string;
      transition: StockTransitionId;
    }>
  /** El id no es un UUID: no llega a la base. */
  | Readonly<{ kind: "not_found" }>
  /** Pidió vender: no es una acción de Stock (no llega a la base). */
  | Readonly<{ kind: "sale_requires_closure" }>
  /** La transición no existe. */
  | Readonly<{ kind: "invalid" }>;

function text(value: FormDataEntryValue | null): string {
  return typeof value === "string" ? value.trim() : "";
}

/**
 * Lee el pedido, que es input no confiable. Que el id sea un UUID no
 * significa que la unidad sea de la organización activa: eso lo deciden el
 * filtro explícito y RLS. Vender se rechaza acá, sin tocar la base: la
 * venta nace del cierre Ganada (DEC-034 §3).
 */
export function parseVehicleStatusChange(
  formData: FormData,
): ParsedVehicleStatusChange {
  const vehicleId = text(formData.get(VEHICLE_STATUS_CHANGE_FIELDS.vehicleId));
  if (!UUID.test(vehicleId)) return { kind: "not_found" };
  const transition = text(
    formData.get(VEHICLE_STATUS_CHANGE_FIELDS.transition),
  );
  if (transition === "sell") return { kind: "sale_requires_closure" };
  if (!isStockTransitionId(transition)) return { kind: "invalid" };
  return { kind: "ok", vehicleId: vehicleId.toLowerCase(), transition };
}
