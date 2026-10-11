import { describe, expect, it } from "vitest";

import {
  NOTE_MAX_LENGTH,
  noteLength,
  normalizeNoteBody,
  noteTimeline,
  parseNoteBody,
  type NoteRow,
} from "@/domains/opportunities/notes";

/*
 * Bitácora comercial (Hito 2, DEC-033 §1): normalización y validación del
 * texto, y la bitácora que muestra /opportunities/[id]. La base exige lo
 * esencial con su CHECK (tests/db/opportunity-notes.test.ts).
 */

const VIEWER = "00000000-0000-4000-8000-00000000000a";
const OTHER = "00000000-0000-4000-8000-00000000000c";

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

describe("noteTimeline", () => {
  const row = (id: string, at: string, recordedBy = VIEWER): NoteRow => ({
    id,
    body: `Nota ${id}`,
    recordedBy,
    recordedAt: new Date(at),
  });

  it("de la más reciente a la más vieja, con autor y fecha de Asunción", () => {
    expect(
      noteTimeline(
        [
          row("a", "2026-10-11T12:00:00Z"),
          row("b", "2026-10-11T17:32:00Z", OTHER),
        ],
        VIEWER,
      ),
    ).toEqual([
      {
        id: "b",
        body: "Nota b",
        author: "Otro miembro",
        at: "11 oct 2026 14:32",
      },
      { id: "a", body: "Nota a", author: "Vos", at: "11 oct 2026 09:00" },
    ]);
  });

  it("a igual instante, el orden es determinista (por id)", () => {
    const at = "2026-10-11T12:00:00Z";
    expect(
      noteTimeline([row("1", at), row("3", at), row("2", at)], VIEWER).map(
        (entry) => entry.id,
      ),
    ).toEqual(["3", "2", "1"]);
  });

  it("no expone ids de usuario", () => {
    const [entry] = noteTimeline(
      [row("a", "2026-10-11T12:00:00Z", OTHER)],
      VIEWER,
    );
    expect(JSON.stringify(entry)).not.toContain(OTHER);
    expect(JSON.stringify(entry)).not.toContain(VIEWER);
  });
});
