import {
  MESSAGE_FIELDS,
  MESSAGE_MAX_LENGTH,
  parseMessage,
  type MessageErrors,
  type MessageValues,
  type NewMessage,
} from "@/domains/conversations/messages";

/*
 * Pedido y respuesta de la Server Action addMessage() (Hito 4, DEC-036 §6).
 * El pedido solo identifica la oportunidad y trae canal, dirección y texto:
 * cualquier otro campo (organización, contacto, autor, fecha) se ignora
 * porque no tiene adónde ir. Nada de esto expone la base: ni SQLSTATE, ni
 * constraints, ni datos de otra organización.
 */

/** Respuesta de addMessage(). */
export type AddMessageState =
  /** El mensaje quedó registrado en la oportunidad. */
  | Readonly<{ status: "recorded"; opportunityId: string }>
  /** Algún campo no es válido: vuelve lo cargado para corregirlo. */
  | Readonly<{
      status: "invalid";
      errors: MessageErrors;
      values: MessageValues;
    }>
  /** La oportunidad no existe o no es de la organización activa. */
  | Readonly<{ status: "not_found" }>
  /** Falla inesperada: nada se escribió y lo cargado vuelve para reintentar. */
  | Readonly<{ status: "failed"; values: MessageValues }>
  | null;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/*
 * Lo que vuelve al formulario: lo tipeado, acotado. El texto puede ser más
 * largo que el máximo (para que se vea qué sobra); canal y dirección son de
 * una lista.
 */
const MAX_OPTION_ECHO_LENGTH = 32;
const MAX_CONTENT_ECHO_LENGTH = MESSAGE_MAX_LENGTH * 4;

export type ParsedMessageRequest =
  | Readonly<{
      kind: "ok";
      opportunityId: string;
      message: NewMessage;
      values: MessageValues;
    }>
  /** El id no es un UUID: no llega a la base. */
  | Readonly<{ kind: "not_found" }>
  /** Algún campo no es válido. */
  | Readonly<{
      kind: "invalid";
      errors: MessageErrors;
      values: MessageValues;
    }>;

function text(value: FormDataEntryValue | null): string {
  return typeof value === "string" ? value : "";
}

/**
 * Lee el pedido, que es input no confiable, y lo valida en el servidor
 * (domains/conversations/messages.ts, Zod): lo que validó el navegador no
 * cuenta. Que el id sea un UUID no significa que la oportunidad sea de la
 * organización activa: eso lo deciden el filtro explícito y RLS.
 */
export function parseMessageRequest(formData: FormData): ParsedMessageRequest {
  const id = text(formData.get(MESSAGE_FIELDS.opportunityId)).trim();
  if (!UUID.test(id)) return { kind: "not_found" };

  // Se valida lo que llegó completo; al formulario vuelve el eco acotado.
  const typed: MessageValues = {
    channel: text(formData.get(MESSAGE_FIELDS.channel)),
    direction: text(formData.get(MESSAGE_FIELDS.direction)),
    content: text(formData.get(MESSAGE_FIELDS.content)),
  };
  const values: MessageValues = {
    channel: typed.channel.slice(0, MAX_OPTION_ECHO_LENGTH),
    direction: typed.direction.slice(0, MAX_OPTION_ECHO_LENGTH),
    content: typed.content.slice(0, MAX_CONTENT_ECHO_LENGTH),
  };
  const parsed = parseMessage(typed);
  if (!parsed.ok) return { kind: "invalid", errors: parsed.errors, values };
  return {
    kind: "ok",
    opportunityId: id.toLowerCase(),
    message: parsed.message,
    values,
  };
}
