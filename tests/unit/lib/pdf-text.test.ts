import { PDFDocument, StandardFonts } from "pdf-lib";
import { beforeAll, describe, expect, it } from "vitest";

import { toPdfText, truncateText, wrapText } from "@/lib/pdf/text";

/*
 * Texto para las fuentes estándar del PDF (Hito 14, DEC-046 §4), con el
 * juego de caracteres real de Helvetica (WinAnsi) y su medida real.
 */

let canEncode: (codePoint: number) => boolean;
let measure: (text: string) => number;

beforeAll(async () => {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const charset = new Set(font.getCharacterSet());
  canEncode = (codePoint) => charset.has(codePoint);
  measure = (text) => font.widthOfTextAtSize(text, 10);
});

describe("toPdfText()", () => {
  it("conserva el español completo", () => {
    const text = "¿Señor Núñez? ¡Pingüino! «Año» N.º 1 · ª — “ok” € …";
    expect(toPdfText(text, canEncode)).toBe(text);
  });

  it("usa equivalentes para lo que Helvetica no tiene", () => {
    expect(toPdfText("− USD 3.742,50", canEncode)).toBe("– USD 3.742,50");
    expect(toPdfText("₲ 1.500.000", canEncode)).toBe("Gs. 1.500.000");
    expect(toPdfText("8 nov 2026", canEncode)).toBe("8 nov 2026");
  });

  it("las letras del guaraní sin equivalente conservan su letra base", () => {
    expect(toPdfText("Avañe'ẽ", canEncode)).toBe("Avañe'e");
    expect(toPdfText("Ỹsyry g̃uasu", canEncode)).toBe("Ysyry guasu");
  });

  it("omite emojis y otros alfabetos, y colapsa los espacios", () => {
    expect(toPdfText("Ramón 🚗 Benítez 👋", canEncode)).toBe("Ramón Benítez");
    expect(toPdfText("Cliente 王", canEncode)).toBe("Cliente");
  });

  it("aplana saltos de línea y tabulaciones en un renglón", () => {
    expect(toPdfText("  Línea 1\nLínea\t2\r\n ", canEncode)).toBe(
      "Línea 1 Línea 2",
    );
  });

  it("lo que devuelve siempre se puede codificar", () => {
    const hostile = "Ç̧a͏ ⁂ \u0000\u0007 ﷽ 🏳️‍🌈 Z̤͔ͧ̑̓ä͖̭̈̇lͮ̒ͫǫ̗ ☃";
    const clean = toPdfText(hostile, canEncode);
    for (const char of clean) {
      expect(canEncode(char.codePointAt(0)!)).toBe(true);
    }
  });
});

describe("wrapText()", () => {
  it("corta entre palabras sin pasarse del ancho", () => {
    const text =
      "Esta cotización no reserva la unidad: queda sujeta a disponibilidad al momento de su aceptación.";
    const lines = wrapText(text, 150, measure);
    expect(lines.length).toBeGreaterThan(1);
    expect(lines.join(" ")).toBe(text);
    for (const line of lines) expect(measure(line)).toBeLessThanOrEqual(150);
  });

  it("una palabra más ancha que el renglón se corta donde haga falta", () => {
    const word = "x".repeat(200);
    const lines = wrapText(`a ${word} b`, 100, measure);
    expect(lines.join("")).toBe(`a${word}b`);
    for (const line of lines) expect(measure(line)).toBeLessThanOrEqual(100);
  });

  it("un texto vacío no tiene renglones", () => {
    expect(wrapText("", 100, measure)).toEqual([]);
    expect(wrapText("   ", 100, measure)).toEqual([]);
  });
});

describe("truncateText()", () => {
  it("deja entero lo que entra", () => {
    expect(truncateText("Página 1 de 1", 200, measure)).toBe("Página 1 de 1");
  });

  it("recorta con … lo que no entra", () => {
    const text = "Concesionaria con un nombre larguísimo ".repeat(5);
    const cut = truncateText(text, 120, measure);
    expect(cut.endsWith("…")).toBe(true);
    expect(measure(cut)).toBeLessThanOrEqual(120);
    expect(text.startsWith(cut.slice(0, -1))).toBe(true);
  });
});
