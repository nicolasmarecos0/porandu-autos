import { z } from "zod";

import {
  MESSAGE_MAX_LENGTH,
  messageLength,
} from "@/domains/conversations/messages";

/*
 * Contrato de un mensaje entrante (Hito 7, DEC-039 §3): lo que la ingesta
 * entrega después de validar el payload de un proveedor. Es la frontera de la
 * capa de Ingestion (DEC-029 §2): de acá en adelante nada conoce la forma del
 * webhook de WhatsApp. Puro: no conoce Next, la base ni lib/.
 */

/**
 * Largo máximo del id del mensaje en el proveedor. Espeja
 * `messageExternalIdMaxLength` de db/schema/messages.ts.
 */
export const EXTERNAL_ID_MAX_LENGTH = 256;

/** Largo máximo del nombre de un contacto (el del alta manual, H1.2). */
export const CONTACT_NAME_MAX_LENGTH = 120;

/** Nombre de un contacto nuevo cuyo remitente no informó su perfil. */
export const FALLBACK_CONTACT_NAME = "Contacto de WhatsApp";

/** Un mensaje entrante, validado y sin la forma del proveedor. */
export type InboundMessage = Readonly<{
  /** Identificador de la línea receptora: lo único que determina el tenant. */
  lineId: string;
  /** Id del mensaje en el proveedor: la clave de idempotencia. */
  externalId: string;
  /** Número de origen: código de país y número, solo dígitos (sin "+"). */
  from: string;
  /** Nombre de perfil del remitente, normalizado, si el proveedor lo informó. */
  profileName: string | null;
  /** Texto normalizado como un mensaje (DEC-036 §4): de 1 a 4096 caracteres. */
  content: string;
  /** Cuándo lo envió el cliente, según el proveedor. */
  sentAt: Date;
}>;

// Fechas razonables para un mensaje: ni antes de 2000 ni después de 2100.
const EARLIEST = Date.UTC(2000, 0, 1);
const LATEST = Date.UTC(2100, 0, 1);

/*
 * Estricto: un campo de más es un error del llamador, no del proveedor (la
 * tolerancia a campos nuevos de Meta vive en whatsapp.ts).
 */
const inboundMessageSchema = z.strictObject({
  lineId: z.string().regex(/^[0-9]{1,32}$/),
  externalId: z
    .string()
    .min(1)
    .max(EXTERNAL_ID_MAX_LENGTH)
    .regex(/^[\x21-\x7e]+$/),
  from: z.string().regex(/^[1-9][0-9]{5,14}$/),
  profileName: z
    .string()
    .min(1)
    .refine((name) => messageLength(name) <= CONTACT_NAME_MAX_LENGTH)
    .nullable(),
  content: z
    .string()
    .min(1)
    .refine((content) => messageLength(content) <= MESSAGE_MAX_LENGTH),
  sentAt: z
    .date()
    .refine((date) => date.getTime() >= EARLIEST && date.getTime() < LATEST),
});

/** Valida un mensaje entrante ya traducido del proveedor, o null. */
export function parseInboundMessage(candidate: unknown): InboundMessage | null {
  const parsed = inboundMessageSchema.safeParse(candidate);
  return parsed.success ? parsed.data : null;
}

/**
 * Nombre de perfil tal como se guarda: NFC, los caracteres de control y los
 * espacios repetidos como un espacio, recortado y acotado a
 * CONTACT_NAME_MAX_LENGTH caracteres. Vacío es null.
 */
export function normalizeProfileName(raw: string): string | null {
  const name = raw
    .normalize("NFC")
    .replace(/[\s\p{Cc}]+/gu, " ")
    .trim();
  const limited = Array.from(name)
    .slice(0, CONTACT_NAME_MAX_LENGTH)
    .join("")
    .trimEnd();
  return limited === "" ? null : limited;
}

/**
 * Nombre de un contacto nuevo (DEC-039 §11): el perfil del remitente o, sin
 * perfil, FALLBACK_CONTACT_NAME. Un contacto existente no cambia de nombre.
 */
export function contactNameFor(message: InboundMessage): string {
  return message.profileName ?? FALLBACK_CONTACT_NAME;
}
