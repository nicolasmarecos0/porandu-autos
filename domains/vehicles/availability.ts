import type { VehicleStatus } from "./stock";

/*
 * Disponibilidad de una unidad (H1.3C): la única transición de estado
 * aprobada. Una unidad en preparación pasa a disponible, explícitamente,
 * desde Stock. Ninguna otra transición existe todavía (reservar, liberar,
 * vender, volver a preparación).
 *
 * Módulo puro y apto para el navegador: la UI lo usa para mostrar la acción,
 * pero la regla la imponen el servidor (el UPDATE exige el estado actual) y
 * la base (policy de UPDATE). El destino nunca lo elige el cliente.
 */

export const AVAILABILITY_TRANSITION = {
  from: "inPreparation",
  to: "available",
} as const satisfies Readonly<{ from: VehicleStatus; to: VehicleStatus }>;

/**
 * Único campo que el servidor lee del pedido: la unidad. Organización,
 * estado de destino y datos de la unidad nunca salen del cliente.
 */
export const MARK_AVAILABLE_FIELD = "vehicleId";

/** ¿Se puede marcar disponible una unidad en este estado? */
export function canMarkAvailable(status: VehicleStatus): boolean {
  return status === AVAILABILITY_TRANSITION.from;
}
