import { describe, expect, it } from "vitest";

import { MESSAGE_MAX_LENGTH } from "@/domains/conversations/messages";
import { parseSendMessage } from "@/domains/conversations/outbound";

/*
 * Pedido de envío desde la bandeja (Hito 8, DEC-040 §2): Zod sobre input no
 * confiable, el mismo esquema en el composer y en el servidor.
 */

const ID = "00000000-0000-4000-8000-0000000000c2";

describe("parseSendMessage", () => {
  it("acepta la conversación y el texto, normalizado como un mensaje registrado", () => {
    expect(
      parseSendMessage({
        conversationId: ` ${ID.toUpperCase()} `,
        text: "  Hola,\r\n\r\n\r\n¿seguís  interesado?  ",
      }),
    ).toEqual({
      ok: true,
      request: { conversationId: ID, text: "Hola,\n\n¿seguís interesado?" },
    });
  });

  it("ignora cualquier otro campo: organización, contacto, línea, autor y reloj no salen del pedido", () => {
    const parsed = parseSendMessage({
      conversationId: ID,
      text: "Hola",
      organizationId: "00000000-0000-4000-8000-000000000002",
      contactId: "x",
      phoneNumberId: "1",
      recordedBy: "x",
      sentAt: "2020-01-01",
    });
    expect(parsed).toEqual({
      ok: true,
      request: { conversationId: ID, text: "Hola" },
    });
  });

  it.each([
    ["sin cuerpo", undefined, { conversationId: "required", text: "required" }],
    [
      "un cuerpo que no es objeto",
      "hola",
      { conversationId: "required", text: "required" },
    ],
    ["sin campos", {}, { conversationId: "required", text: "required" }],
    [
      "la conversación vacía",
      { conversationId: " ", text: "Hola" },
      { conversationId: "required" },
    ],
    [
      "un id que no es UUID",
      { conversationId: "123", text: "Hola" },
      { conversationId: "invalid" },
    ],
    [
      "un id que no es texto",
      { conversationId: 7, text: "Hola" },
      { conversationId: "required" },
    ],
    [
      "un texto vacío después de normalizar",
      { conversationId: ID, text: " \n\t " },
      { text: "empty" },
    ],
    [
      "un texto que no es texto",
      { conversationId: ID, text: ["Hola"] },
      { text: "required" },
    ],
  ])("rechaza %s, con el primer error de cada campo", (_, input, errors) => {
    expect(parseSendMessage(input)).toEqual({ ok: false, errors });
  });

  it("acepta hasta 4096 caracteres (code points) y rechaza uno más", () => {
    const max = "🚗".repeat(MESSAGE_MAX_LENGTH);
    expect(parseSendMessage({ conversationId: ID, text: max })).toMatchObject({
      ok: true,
    });
    expect(parseSendMessage({ conversationId: ID, text: `${max}a` })).toEqual({
      ok: false,
      errors: { text: "too_long" },
    });
  });
});
