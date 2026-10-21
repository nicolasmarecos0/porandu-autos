import { z } from "zod";

import {
  MESSAGE_MAX_LENGTH,
  messageLength,
  normalizeMessageContent,
} from "@/domains/conversations/messages";

import {
  normalizeProfileName,
  parseInboundMessage,
  type InboundMessage,
} from "./inbound-message";

/*
 * Payload del webhook de la WhatsApp Cloud API (Hito 7, DEC-039 §3): el único
 * módulo que conoce su forma. Valida el sobre y cada mensaje, y traduce los
 * mensajes de texto entrantes al contrato propio (InboundMessage). Puro: no
 * conoce Next, la base, lib/ ni la firma (que se verifica antes, sobre el
 * cuerpo crudo).
 *
 * Estricto en lo que se usa y tolerante a lo demás: z.object() descarta los
 * campos que el proveedor agregue sin aviso, para que un campo nuevo de Meta
 * no haga perder mensajes. Lo que se lee tiene forma, largo y rango.
 *
 *   object: "whatsapp_business_account"
 *   entry[].changes[]: { field, value }
 *     field "messages" → value: { messaging_product: "whatsapp",
 *       metadata: { phone_number_id }, contacts?: [{ wa_id, profile: { name } }],
 *       messages?: [{ id, from, timestamp, type, text?: { body } }],
 *       statuses?: [...] }
 *     otro field → se ignora
 */

/** Tipo de mensaje que se ingiere. Los demás (media, reacciones…) no. */
const TEXT = "text";

const lineIdSchema = z.string().regex(/^[0-9]{1,32}$/);

const messagesValueSchema = z.object({
  messaging_product: z.literal("whatsapp"),
  metadata: z.object({ phone_number_id: lineIdSchema }),
  contacts: z
    .array(
      z.object({
        wa_id: z.string(),
        profile: z.object({ name: z.string() }).optional(),
      }),
    )
    .optional(),
  messages: z.array(z.unknown()).optional(),
  statuses: z.array(z.unknown()).optional(),
});

const envelopeSchema = z.object({
  object: z.literal("whatsapp_business_account"),
  entry: z
    .array(
      z.object({
        changes: z.array(z.object({ field: z.string(), value: z.unknown() })),
      }),
    )
    .min(1),
});

const messageTypeSchema = z.object({ type: z.string() });

const textMessageSchema = z.object({
  id: z.string(),
  // Código de país y número, solo dígitos (E.164 sin "+").
  from: z.string().regex(/^[1-9][0-9]{5,14}$/),
  // Segundos Unix, como texto.
  timestamp: z.string().regex(/^[0-9]{1,12}$/),
  type: z.literal(TEXT),
  text: z.object({ body: z.string() }),
});

/**
 * Resultado de leer un webhook:
 * - `messages`: los mensajes de texto entrantes válidos, en el orden del
 *   payload;
 * - `ignored`: eventos que no se ingieren por diseño (estados de entrega,
 *   mensajes que no son de texto, cambios de otros campos);
 * - `invalid`: mensajes de texto descartados por un campo inválido.
 *
 * Un sobre inválido es `{ ok: false }` y no se ingiere nada.
 */
export type WhatsAppWebhook =
  | Readonly<{
      ok: true;
      messages: readonly InboundMessage[];
      ignored: number;
      invalid: number;
    }>
  | Readonly<{ ok: false }>;

type Contacts = z.infer<typeof messagesValueSchema>["contacts"];

function profileNameOf(contacts: Contacts, from: string): string | null {
  const name = contacts?.find((contact) => contact.wa_id === from)?.profile
    ?.name;
  return name === undefined ? null : normalizeProfileName(name);
}

/**
 * Un mensaje del payload: el mensaje propio si es de texto y válido,
 * "ignored" si no es de texto e "invalid" si es de texto con un campo
 * inválido (incluido un texto vacío o demasiado largo después de
 * normalizar).
 */
function readMessage(
  raw: unknown,
  lineId: string,
  contacts: Contacts,
): InboundMessage | "ignored" | "invalid" {
  const typed = messageTypeSchema.safeParse(raw);
  if (!typed.success) return "invalid";
  if (typed.data.type !== TEXT) return "ignored";

  const parsed = textMessageSchema.safeParse(raw);
  if (!parsed.success) return "invalid";
  const { id, from, timestamp, text } = parsed.data;

  const content = normalizeMessageContent(text.body);
  if (content === "" || messageLength(content) > MESSAGE_MAX_LENGTH) {
    return "invalid";
  }
  return (
    parseInboundMessage({
      lineId,
      externalId: id,
      from,
      profileName: profileNameOf(contacts, from),
      content,
      sentAt: new Date(Number(timestamp) * 1000),
    }) ?? "invalid"
  );
}

/**
 * Lee un webhook de la Cloud API ya autenticado (la firma se verifica antes)
 * y parseado como JSON. Input no confiable: nada sale sin validar.
 */
export function parseWhatsAppWebhook(payload: unknown): WhatsAppWebhook {
  const envelope = envelopeSchema.safeParse(payload);
  if (!envelope.success) return { ok: false };

  const messages: InboundMessage[] = [];
  let ignored = 0;
  let invalid = 0;
  for (const entry of envelope.data.entry) {
    for (const change of entry.changes) {
      if (change.field !== "messages") {
        ignored += 1;
        continue;
      }
      const value = messagesValueSchema.safeParse(change.value);
      if (!value.success) return { ok: false };
      const { metadata, contacts, statuses } = value.data;
      ignored += statuses?.length ?? 0;
      for (const raw of value.data.messages ?? []) {
        const message = readMessage(raw, metadata.phone_number_id, contacts);
        if (message === "ignored") ignored += 1;
        else if (message === "invalid") invalid += 1;
        else messages.push(message);
      }
    }
  }
  return { ok: true, messages, ignored, invalid };
}
