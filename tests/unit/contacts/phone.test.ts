import { describe, expect, it, vi } from "vitest";

import {
  DEFAULT_PHONE_REGION,
  MAX_PHONE_INPUT_LENGTH,
  normalizePhone,
} from "@/lib/contacts/phone";

/*
 * Identidad telefónica (H1.2): teléfono cargado → E.164. Es la clave con que
 * se deduplican contactos dentro de una organización, así que formatos
 * equivalentes tienen que dar exactamente el mismo valor y un número
 * inválido no puede dar ninguno.
 */

vi.mock("server-only", () => ({}));

const HILUX_BUYER = "+595981555214";

describe("números de Paraguay sin prefijo internacional", () => {
  it("interpreta la región por defecto como Paraguay", () => {
    expect(DEFAULT_PHONE_REGION).toBe("PY");
  });

  it.each([
    "0981555214",
    "0981 555 214",
    "0981-555-214",
    "(0981) 555-214",
    "0981.555.214",
    "  0981  555  214  ",
    "981 555 214",
  ])("%s → E.164 de Paraguay", (raw) => {
    expect(normalizePhone(raw)).toBe(HILUX_BUYER);
  });

  it("líneas fijas y otros prefijos móviles", () => {
    expect(normalizePhone("021 555 214")).toBe("+59521555214");
    expect(normalizePhone("0331 555 480")).toBe("+595331555480");
    expect(normalizePhone("0983 555 846")).toBe("+595983555846");
    expect(normalizePhone("0972 123 456")).toBe("+595972123456");
  });
});

describe("números con prefijo internacional", () => {
  it.each([
    "+595981555214",
    "+595 981 555 214",
    "+595 (981) 555-214",
    "+595 0981 555 214",
    "00595 981 555 214",
    "595981555214",
  ])("%s → el mismo E.164 de Paraguay", (raw) => {
    expect(normalizePhone(raw)).toBe(HILUX_BUYER);
  });

  it("un número internacional explícito conserva su país", () => {
    expect(normalizePhone("+54 9 11 2345 6789")).toBe("+5491123456789");
    expect(normalizePhone("0054 9 11 2345 6789")).toBe("+5491123456789");
    expect(normalizePhone("+1 (202) 555-0143")).toBe("+12025550143");
    expect(normalizePhone("+44 20 7946 0958")).toBe("+442079460958");
  });
});

describe("formatos equivalentes dan un único valor canónico", () => {
  it("todas las formas del mismo número coinciden", () => {
    const forms = [
      "0981 555 214",
      "0981-555-214",
      "(0981) 555 214",
      "+595 981 555 214",
      "+595981555214",
      "00595981555214",
    ];
    expect(new Set(forms.map(normalizePhone))).toEqual(new Set([HILUX_BUYER]));
  });

  it("números distintos no colisionan", () => {
    expect(normalizePhone("0981 555 214")).not.toBe(
      normalizePhone("0981 555 215"),
    );
    // Los mismos dígitos locales en otro país son otra persona.
    const asuncion = normalizePhone("021 555 2140");
    const montevideo = normalizePhone("+598 2 555 2140");
    expect([asuncion, montevideo]).toEqual(["+595215552140", "+59825552140"]);
  });
});

describe("números inválidos se rechazan", () => {
  it.each([
    ["vacío", ""],
    ["solo espacios", "   "],
    ["corto", "0981 1"],
    ["un dígito de más", "0981 555 2140"],
    ["un dígito de menos", "0981 555 21"],
    ["ceros", "0000000000"],
    ["letras", "abc"],
    ["texto alrededor", "Ramón 0981 555 214"],
    ["extensión", "0981 555 214 ext 12"],
    ["prefijo de país inexistente", "+999 981 555 214"],
    ["un + en el medio", "0981+555214"],
    ["caracteres de control", "0981\u0000555214"],
  ])("%s", (_, raw) => {
    expect(normalizePhone(raw)).toBeNull();
  });

  it("una entrada más larga que la cota no se parsea", () => {
    const padded = `0981 555 214${" ".repeat(MAX_PHONE_INPUT_LENGTH)}x`;
    expect(normalizePhone(padded)).toBeNull();
    expect(normalizePhone("9".repeat(MAX_PHONE_INPUT_LENGTH + 1))).toBeNull();
  });
});
