/*
 * Estado de entrega de un mensaje enviado (Hito 12, DEC-044 §3): lo que
 * WhatsApp informa de un saliente después de aceptarlo. Puro y apto para el
 * navegador. No conoce proveedores: traducir los `statuses[]` del webhook de
 * Meta a estos valores es de la capa de Ingestion (domains/webhooks), cuando
 * entre la ingesta de estados.
 *
 *   sent ──► delivered ──► read
 *     └────► failed
 *
 * Los estados llegan sueltos, repetidos y en cualquier orden: el proveedor
 * reintenta y no garantiza el orden. El estado vigente no depende del orden
 * de llegada: es el de mayor precedencia entre los recibidos. Un `failed`
 * no pisa un `delivered` ni un `read`: un mensaje entregado no deja de
 * haberlo sido.
 *
 * Es el "visto" del cliente, no el leído interno del equipo
 * (./read-state.ts).
 */

export const DELIVERY_STATUSES = [
  "sent",
  "delivered",
  "read",
  "failed",
] as const;

export type DeliveryStatus = (typeof DELIVERY_STATUSES)[number];

/**
 * Estado de todo saliente registrado: la base solo lo registra después del
 * `200` de Meta (DEC-040 §6), así que WhatsApp ya lo aceptó.
 */
export const INITIAL_DELIVERY_STATUS: DeliveryStatus = "sent";

/** Precedencia: el vigente es el mayor de los recibidos. */
const PRECEDENCE: Readonly<Record<DeliveryStatus, number>> = {
  sent: 0,
  failed: 1,
  delivered: 2,
  read: 3,
};

/** Copy visible (es-PY). */
export const DELIVERY_STATUS_LABELS: Readonly<Record<DeliveryStatus, string>> =
  {
    sent: "Enviado",
    delivered: "Entregado",
    read: "Leído",
    failed: "No entregado",
  };

export function isDeliveryStatus(value: unknown): value is DeliveryStatus {
  return (
    typeof value === "string" &&
    (DELIVERY_STATUSES as readonly string[]).includes(value)
  );
}

/**
 * El estado vigente de un saliente a partir de los estados recibidos, en el
 * orden en que hayan llegado. Sin estados es INITIAL_DELIVERY_STATUS.
 * Conmutativo e idempotente: un estado repetido o tardío no lo cambia.
 */
export function currentDeliveryStatus(
  received: Iterable<DeliveryStatus>,
): DeliveryStatus {
  let current = INITIAL_DELIVERY_STATUS;
  for (const status of received) {
    if (PRECEDENCE[status] > PRECEDENCE[current]) current = status;
  }
  return current;
}
