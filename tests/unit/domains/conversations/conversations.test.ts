import { describe, expect, it } from "vitest";

import {
  MESSAGE_PREVIEW_MAX_LENGTH,
  messagePreview,
} from "@/domains/conversations/conversations";
import { normalizeMessageContent } from "@/domains/conversations/messages";

/*
 * Preview del último mensaje de una conversación (Hito 7, DEC-039 §6): una
 * sola línea, de 1 a 160 caracteres, como exige el CHECK
 * conversations_last_message_preview_check.
 */

/** Lo que exige la base: largo, recortado y sin caracteres de control. */
function satisfiesCheck(preview: string): boolean {
  const length = Array.from(preview).length;
  return (
    length >= 1 &&
    length <= MESSAGE_PREVIEW_MAX_LENGTH &&
    preview === preview.replace(/^ +| +$/g, "") &&
    !/\p{Cc}/u.test(preview)
  );
}

describe("messagePreview", () => {
  it("deja igual un texto corto de una línea", () => {
    expect(messagePreview("Hola, ¿sigue disponible?")).toBe(
      "Hola, ¿sigue disponible?",
    );
  });

  it("une las líneas con un espacio", () => {
    expect(messagePreview("Hola\n\n¿Aceptan usado?\nGracias")).toBe(
      "Hola ¿Aceptan usado? Gracias",
    );
  });

  it("corta en 160 caracteres con '…', sin espacio antes", () => {
    const long = `${"a".repeat(158)} ${"b".repeat(20)}`;
    const preview = messagePreview(long);
    expect(preview).toBe(`${"a".repeat(158)}…`);
    expect(Array.from(preview)).toHaveLength(159);

    const exact = "x".repeat(MESSAGE_PREVIEW_MAX_LENGTH);
    expect(messagePreview(exact)).toBe(exact);
    const over = "x".repeat(MESSAGE_PREVIEW_MAX_LENGTH + 1);
    expect(messagePreview(over)).toBe(
      `${"x".repeat(MESSAGE_PREVIEW_MAX_LENGTH - 1)}…`,
    );
  });

  it("cuenta por code points, como char_length", () => {
    const emoji = "🚗".repeat(MESSAGE_PREVIEW_MAX_LENGTH + 5);
    const preview = messagePreview(emoji);
    expect(Array.from(preview)).toHaveLength(MESSAGE_PREVIEW_MAX_LENGTH);
    expect(preview.endsWith("🚗…")).toBe(true);
  });

  it.each([
    "Hola",
    "  Hola  \n  mundo  ",
    `${"palabra ".repeat(60)}`,
    "línea\r\ncon\tcontrol\u0007y espacios",
    "🚗".repeat(400),
  ])("cumple el CHECK de la base para un texto normalizado (%#)", (raw) => {
    const content = normalizeMessageContent(raw);
    expect(satisfiesCheck(messagePreview(content))).toBe(true);
  });
});
