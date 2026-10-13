import { describe, expect, it } from "vitest";

import {
  NOTE_MAX_LENGTH,
  noteLength,
  normalizeNoteBody,
  parseNoteBody,
} from "@/domains/opportunities/notes";

/*
 * Bitácora comercial (Hito 2, DEC-033 §1): normalización y validación del
 * texto. La base exige lo esencial con su CHECK
 * (tests/db/opportunity-notes.test.ts). Cómo se muestran las notas en el
 * muro de actividad lo prueba tests/unit/domains/conversations/timeline.test.ts.
 */

describe("normalizeNoteBody", () => {
  it.each([
    ["recorta los bordes", "  Llamé al cliente.  ", "Llamé al cliente."],
    ["colapsa espacios y tabs", "Pide\t\tcuota   fija", "Pide cuota fija"],
    ["CRLF y CR como salto de línea", "Uno\r\nDos\rTres", "Uno\nDos\nTres"],
    ["recorta cada línea", "Uno   \n   Dos", "Uno\nDos"],
    ["a lo sumo una línea en blanco seguida", "Uno\n\n\n\n\nDos", "Uno\n\nDos"],
    ["líneas en blanco en los bordes", "\n\n  Uno \n\n", "Uno"],
    [
      "otros caracteres de control como espacio",
      "A\u0000B\u0007C\u0085D",
      "A B C D",
    ],
    ["NBSP y separadores de línea como espacio", "A B C", "A B C"],
    ["NFC", "Café", "Café"],
  ])("%s", (_, raw, expected) => {
    expect(normalizeNoteBody(raw)).toBe(expected);
  });

  it("es idempotente", () => {
    const raw = " Uno\t \r\n\r\n\r\n  Dos\u0007 ";
    const once = normalizeNoteBody(raw);
    expect(normalizeNoteBody(once)).toBe(once);
  });

  it("solo deja saltos de línea como control (lo que exige el CHECK)", () => {
    const body = normalizeNoteBody(
      Array.from({ length: 0x20 }, (_, code) => String.fromCharCode(code)).join(
        "x",
      ),
    );
    expect(body.replace(/\n/g, "")).not.toMatch(/\p{Cc}/u);
  });
});

describe("parseNoteBody", () => {
  it("devuelve el texto normalizado", () => {
    expect(parseNoteBody("  Pidió una prueba de manejo.\r\n ")).toEqual({
      ok: true,
      body: "Pidió una prueba de manejo.",
    });
  });

  it.each(["", "   ", "\n\n\t", "\u0000"])("%j vacía es `empty`", (raw) => {
    expect(parseNoteBody(raw)).toEqual({ ok: false, error: "empty" });
  });

  it("hasta NOTE_MAX_LENGTH caracteres, contados como la base (code points)", () => {
    expect(NOTE_MAX_LENGTH).toBe(1000);
    const exact = "a".repeat(NOTE_MAX_LENGTH);
    expect(parseNoteBody(exact)).toEqual({ ok: true, body: exact });
    expect(parseNoteBody(`${exact}b`)).toEqual({
      ok: false,
      error: "too_long",
    });
    // Un emoji son dos unidades UTF-16, pero un solo carácter para la base.
    const emoji = "🚗".repeat(NOTE_MAX_LENGTH);
    expect(noteLength(emoji)).toBe(NOTE_MAX_LENGTH);
    expect(parseNoteBody(emoji)).toEqual({ ok: true, body: emoji });
  });

  it("el largo se mide después de normalizar", () => {
    const padded = `   ${"a".repeat(NOTE_MAX_LENGTH)}   `;
    expect(parseNoteBody(padded)).toMatchObject({ ok: true });
  });
});
