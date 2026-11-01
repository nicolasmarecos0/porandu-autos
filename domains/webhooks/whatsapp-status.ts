import { z } from "zod";

import {
  DELIVERY_STATUSES,
  isDeliveryStatus,
  type DeliveryStatus,
} from "@/domains/conversations/delivery";

import {
  externalIdSchema,
  lineIdSchema,
  providerInstantSchema,
} from "./inbound-message";

/*
 * Estados de entrega del webhook de la WhatsApp Cloud API (Hito 12C, DEC-044
 * §3): los `statuses[]` que Meta envía, en el campo `messages`, por cada
 * saliente después de aceptarlo. Valida cada estado y lo traduce al contrato
 * propio (DeliveryStatusEvent). Es parte de la capa de Ingestion (DEC-029
 * §2), junto con whatsapp.ts, que lee el sobre: de acá en adelante nada
 * conoce la forma del payload. Puro: no conoce Next, la base, lib/ ni la
 * firma (que se verifica antes, sobre el cuerpo crudo).
 *
 *   value.statuses[]: { id, status, timestamp, recipient_id,
 *     conversation?, pricing?, errors? }
 *
 * - Se ingieren los cuatro estados del contrato: `sent`, `delivered`, `read`
 *   y `failed` (DEC-044 §3.1). Otro estado del proveedor (`deleted`,
 *   `warning`…) se ignora por diseño.
 * - Estricto en lo que se usa (`id`, `status` y `timestamp`) y tolerante al
 *   resto: `recipient_id`, `conversation`, `pricing` y `errors` no se leen,
 *   y un campo nuevo de Meta no hace perder un estado.
 * - El tenant no sale del estado: lo determina la línea del sobre
 *   (`metadata.phone_number_id`), como en un mensaje entrante.
 * - Acá no se decide el estado vigente de un saliente: es el de mayor
 *   precedencia entre los recibidos (domains/conversations/delivery.ts).
 *   Por eso el orden del lote, las repeticiones y los estados tardíos no
 *   importan: un `failed` que llega después de un `read` se registra, pero
 *   nunca lo pisa.
 */

/** Un estado de entrega, validado y sin la forma del proveedor. */
export type DeliveryStatusEvent = Readonly<{
  /**
   * La línea del concesionario que envió el mensaje (`phone_number_id`): lo
   * único que determina el tenant.
   */
  lineId: string;
  /** Id del saliente en el proveedor: el wamid que devolvió Meta al enviar. */
  externalId: string;
  status: DeliveryStatus;
  /** Cuándo ocurrió, según el proveedor. */
  occurredAt: Date;
}>;

/**
 * Lo mínimo para clasificar un estado antes de validarlo entero: un nombre
 * de estado bien formado. Uno que no es del contrato se ignora; uno mal
 * formado (vacío, con otros caracteres, que no es texto) es inválido.
 */
const statusValueSchema = z.object({
  status: z.string().regex(/^[a-z_]{1,32}$/),
});

/** Un estado del payload de Meta que se ingiere. */
const providerStatusSchema = z.object({
  id: z.string(),
  status: z.enum(DELIVERY_STATUSES),
  // Segundos Unix, como texto.
  timestamp: z.string().regex(/^[0-9]{1,12}$/),
});

/*
 * Estricto: un campo de más es un error del llamador, no del proveedor (la
 * tolerancia a campos nuevos de Meta vive en providerStatusSchema).
 */
const deliveryStatusEventSchema = z.strictObject({
  lineId: lineIdSchema,
  externalId: externalIdSchema,
  status: z.enum(DELIVERY_STATUSES),
  occurredAt: providerInstantSchema,
});

/** Valida un estado de entrega ya traducido del proveedor, o null. */
export function parseDeliveryStatusEvent(
  candidate: unknown,
): DeliveryStatusEvent | null {
  const parsed = deliveryStatusEventSchema.safeParse(candidate);
  return parsed.success ? parsed.data : null;
}

/**
 * Un estado del payload, recibido por la línea `lineId` (ya validada en el
 * sobre): el estado propio si es uno de los que se ingieren y es válido,
 * "ignored" si es otro estado del proveedor e "invalid" si le falta un campo
 * o tiene uno inválido (un id vacío o con espacios, un instante fuera de
 * rango). Input no confiable: nada sale sin validar.
 */
export function readDeliveryStatus(
  raw: unknown,
  lineId: string,
): DeliveryStatusEvent | "ignored" | "invalid" {
  const typed = statusValueSchema.safeParse(raw);
  if (!typed.success) return "invalid";
  if (!isDeliveryStatus(typed.data.status)) return "ignored";

  const parsed = providerStatusSchema.safeParse(raw);
  if (!parsed.success) return "invalid";
  const { id, status, timestamp } = parsed.data;
  return (
    parseDeliveryStatusEvent({
      lineId,
      externalId: id,
      status,
      occurredAt: new Date(Number(timestamp) * 1000),
    }) ?? "invalid"
  );
}
