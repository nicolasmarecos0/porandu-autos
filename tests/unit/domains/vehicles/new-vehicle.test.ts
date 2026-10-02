import { describe, expect, it } from "vitest";

import {
  MAX_KM,
  MAX_PRICE_INTEGER_DIGITS,
  parseAmount,
  parseWholeNumber,
} from "@/domains/vehicles/new-vehicle";
import { formatKm, formatPrice } from "@/domains/vehicles/stock";

/*
 * Números del alta rápida (H1.3B) escritos en es-PY: punto para los miles y
 * coma para los decimales, como los muestra Stock. Un punto que no separa
 * miles es ambiguo y se rechaza: nunca se lee como decimal.
 */

describe("parseWholeNumber", () => {
  it.each([
    ["0", 0],
    ["00", 0],
    ["7", 7],
    ["142000", 142000],
    ["142.000", 142000],
    ["1.000.000", 1000000],
    ["2147483647", 2147483647],
    ["2.147.483.647", 2147483647],
  ])("%s → %d", (raw, expected) => {
    expect(parseWholeNumber(raw)).toBe(expected);
  });

  it.each([
    [""],
    ["-1"],
    ["+5"],
    ["12,5"],
    ["1.5"],
    ["12.50"],
    ["1.0000"],
    [".500"],
    ["1..000"],
    ["1 000"],
    ["abc"],
    ["1e3"],
    ["0x10"],
    // Dígitos que no son ASCII.
    ["١٢٣"],
    ["１２３"],
    // Más allá de lo que un number representa exacto.
    ["9".repeat(20)],
  ])("rechaza %j", (raw) => {
    expect(parseWholeNumber(raw)).toBeNull();
  });

  it("es la inversa de formatKm()", () => {
    for (const km of [0, 950, 48000, 142000, MAX_KM]) {
      expect(parseWholeNumber(formatKm(km).replace(" km", ""))).toBe(km);
    }
  });
});

describe("parseAmount: decimal canónico, sin float", () => {
  it.each([
    ["31500", "31500.00"],
    ["31.500", "31500.00"],
    ["150.000.000", "150000000.00"],
    ["32.990,50", "32990.50"],
    ["32.990,5", "32990.50"],
    ["32990,05", "32990.05"],
    ["150.000.000,00", "150000000.00"],
    ["0", "0.00"],
    ["0,00", "0.00"],
    ["007", "7.00"],
    ["999.999.999.999,99", "999999999999.99"],
    // Lo que un float perdería (2^53 + 1).
    ["9.007.199.254.740.993", "9007199254740993.00"],
  ])("%s → %s", (raw, expected) => {
    expect(parseAmount(raw)).toBe(expected);
  });

  it.each([
    [""],
    ["-5"],
    ["+5"],
    // Punto decimal (formato inglés): ambiguo en es-PY, se rechaza.
    ["49900.50"],
    ["1.5"],
    ["49.90"],
    // Más de dos decimales.
    ["12,345"],
    ["1.000,505"],
    [",50"],
    ["5,"],
    ["1.000.00"],
    ["31 500"],
    ["USD 31.500"],
    ["Gs. 150.000"],
    ["1e5"],
    ["abc"],
  ])("rechaza %j", (raw) => {
    expect(parseAmount(raw)).toBeNull();
  });

  it("es la inversa de formatPrice() (sin el prefijo de moneda)", () => {
    for (const amount of [
      "49900.00",
      "32990.50",
      "150000000.00",
      "999999999999.99",
    ]) {
      const shown = formatPrice({ amount, currency: "USD" }).replace(
        "USD ",
        "",
      );
      expect(parseAmount(shown)).toBe(amount);
    }
  });

  it("no valida largo: lo decide quien la usa (numeric(14, 2) → 12 enteros)", () => {
    expect(MAX_PRICE_INTEGER_DIGITS).toBe(12);
    expect(parseAmount("1.000.000.000.000")).toBe("1000000000000.00");
  });
});
