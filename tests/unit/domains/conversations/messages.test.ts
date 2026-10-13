import { describe, expect, it } from "vitest";

import {
  MESSAGE_CHANNEL_LABELS,
  MESSAGE_CHANNELS,
  MESSAGE_DIRECTION_LABELS,
  MESSAGE_DIRECTIONS,
  MESSAGE_FIELDS,
  MESSAGE_MAX_LENGTH,
  messageLength,
  normalizeMessageContent,
  parseMessage,
  type MessageValues,
} from "@/domains/conversations/messages";

/*
 * Mensajes registrados (Hito 4, DEC-036 §4 y §7): listas cerradas de canal y
 * dirección y validación del pedido con Zod. La base exige lo mismo con sus
 * CHECKs (tests/db/messages.test.ts).
 */

const VALID: MessageValues = {
  channel: "whatsapp",
  direction: "inbound",
  content: "¿Tienen la Hilux 2024 en blanco?",
};

describe("listas cerradas", () => {
  it("canales: WhatsApp, email y otro medio (sin proveedores)", () => {
    expect(MESSAGE_CHANNELS).toEqual(["whatsapp", "email", "manual"]);
    expect(MESSAGE_CHANNEL_LABELS).toEqual({
      whatsapp: "WhatsApp",
      email: "Email",
      manual: "Otro medio",
    });
  });

  it("direcciones: recibido del cliente o enviado al cliente", () => {
    expect(MESSAGE_DIRECTIONS).toEqual(["inbound", "outbound"]);
    expect(MESSAGE_DIRECTION_LABELS).toEqual({
      inbound: "Recibido del cliente",
      outbound: "Enviado al cliente",
    });
  });

  it("el pedido solo trae oportunidad, canal, dirección y texto", () => {
    expect(Object.values(MESSAGE_FIELDS)).toEqual([
      "opportunityId",
      "channel",
      "direction",
      "content",
    ]);
  });
});

describe("normalizeMessageContent", () => {
  it.each([
    ["recorta los bordes", "  Hola  ", "Hola"],
    ["CRLF como salto de línea", "Uno\r\nDos", "Uno\nDos"],
    ["a lo sumo una línea en blanco seguida", "Uno\n\n\n\nDos", "Uno\n\nDos"],
    ["tabs y espacios repetidos", "Precio\t\tfinal   USD", "Precio final USD"],
    ["caracteres de control como espacio", "A\u0007B", "A B"],
    ["NFC", "Café", "Café"],
  ])("%s, como una nota", (_, raw, expected) => {
    expect(normalizeMessageContent(raw)).toBe(expected);
  });
});

describe("parseMessage", () => {
  it("devuelve el mensaje con el texto normalizado", () => {
    expect(
      parseMessage({ ...VALID, content: "  ¿Tienen\r\nla Hilux?  " }),
    ).toEqual({
      ok: true,
      message: {
        channel: "whatsapp",
        direction: "inbound",
        content: "¿Tienen\nla Hilux?",
      },
    });
  });

  it.each(
    MESSAGE_CHANNELS.flatMap((channel) =>
      MESSAGE_DIRECTIONS.map((direction) => [channel, direction] as const),
    ),
  )("acepta %s · %s", (channel, direction) => {
    expect(parseMessage({ ...VALID, channel, direction })).toMatchObject({
      ok: true,
      message: { channel, direction },
    });
  });

  it("recorta canal y dirección antes de compararlos", () => {
    expect(
      parseMessage({ ...VALID, channel: " email ", direction: " outbound " }),
    ).toMatchObject({
      ok: true,
      message: { channel: "email", direction: "outbound" },
    });
  });

  it.each([
    ["channel", "", "required"],
    ["channel", "  ", "required"],
    ["channel", "sms", "invalid_option"],
    ["channel", "WhatsApp", "invalid_option"],
    ["direction", "", "required"],
    ["direction", "incoming", "invalid_option"],
    ["content", "", "empty"],
    ["content", " \n\t ", "empty"],
    ["content", "a".repeat(MESSAGE_MAX_LENGTH + 1), "too_long"],
  ] as const)("%s = %j es %s", (field, value, error) => {
    expect(parseMessage({ ...VALID, [field]: value })).toEqual({
      ok: false,
      errors: { [field]: error },
    });
  });

  it("devuelve el primer error de cada campo, todos juntos", () => {
    expect(
      parseMessage({ channel: "fax", direction: "", content: "" }),
    ).toEqual({
      ok: false,
      errors: {
        channel: "invalid_option",
        direction: "required",
        content: "empty",
      },
    });
  });

  it("hasta MESSAGE_MAX_LENGTH caracteres, contados como la base (code points)", () => {
    expect(MESSAGE_MAX_LENGTH).toBe(4096);
    const exact = "🚗".repeat(MESSAGE_MAX_LENGTH);
    expect(messageLength(exact)).toBe(MESSAGE_MAX_LENGTH);
    expect(parseMessage({ ...VALID, content: exact })).toMatchObject({
      ok: true,
    });
    expect(parseMessage({ ...VALID, content: `${exact}a` })).toEqual({
      ok: false,
      errors: { content: "too_long" },
    });
  });

  it("el largo se mide después de normalizar", () => {
    const padded = `   ${"a".repeat(MESSAGE_MAX_LENGTH)}   `;
    expect(parseMessage({ ...VALID, content: padded })).toMatchObject({
      ok: true,
    });
  });
});
