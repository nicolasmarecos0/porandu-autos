import { MARK_AVAILABLE_FIELD } from "@/domains/vehicles/availability";
import type { VehicleStatus } from "@/domains/vehicles/stock";

/*
 * Pedido y respuesta de la Server Action markVehicleAvailable() (H1.3C). El
 * pedido solo identifica la unidad: cualquier otro campo (organización,
 * estado de destino, datos de la unidad) se ignora porque no tiene adónde ir.
 */

/** Respuesta de markVehicleAvailable(). */
export type MarkVehicleAvailableState =
  /** La unidad pasó a disponible con este pedido. */
  | Readonly<{
      status: "available";
      vehicleId: string;
      brand: string;
      model: string;
      year: number;
    }>
  /**
   * La unidad ya no estaba en preparación (por ejemplo, otra persona la
   * marcó antes): no cambió nada. `current` es su estado real.
   */
  | Readonly<{
      status: "unchanged";
      vehicleId: string;
      brand: string;
      model: string;
      year: number;
      current: VehicleStatus;
    }>
  /** La unidad no existe o no es de la organización activa. */
  | Readonly<{ status: "not_found" }>
  /** Falla inesperada al guardar: no cambió nada y se puede reintentar. */
  | Readonly<{ status: "failed" }>
  | null;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Id de la unidad enviado por el cliente: input no confiable. Devuelve el
 * UUID normalizado, o null. Que sea un UUID no significa que la unidad sea de
 * la organización activa: eso lo deciden el filtro explícito y RLS.
 */
export function readVehicleId(formData: FormData): string | null {
  const raw = formData.get(MARK_AVAILABLE_FIELD);
  if (typeof raw !== "string") return null;
  const value = raw.trim();
  return UUID.test(value) ? value.toLowerCase() : null;
}
