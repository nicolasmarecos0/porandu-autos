import { describe, expect, it } from "vitest";

import {
  formatAmount,
  formatMoney,
  moneyDifference,
  moneyPercent,
  parseAmount,
  toMinorUnits,
} from "@/domains/money";

/*
 * Dinero compartido por Stock y la demanda (DEC-030 §7): exacto, sin float y
 * sin conversión entre monedas.
 */

describe("formatAmount: la inversa de parseAmount", () => {
  it.each([
    ["250000000.00", "250.000.000"],
    ["29990.50", "29.990,50"],
    ["0.00", "0"],
    ["5000", "5.000"],
  ])("%s → %s", (amount, expected) => {
    expect(formatAmount(amount)).toBe(expected);
    expect(parseAmount(expected)).toBe(
      `${amount.split(".")[0]}.${(amount.split(".")[1] ?? "").padEnd(2, "0")}`,
    );
  });

  it("rechaza lo que no es un decimal", () => {
    expect(() => formatAmount("1e3")).toThrow(/invalid decimal amount/);
  });
});

describe("formatMoney", () => {
  it.each([
    ["250000000.00", "PYG", "Gs. 250.000.000"],
    ["0.00", "PYG", "Gs. 0"],
    ["29990.50", "USD", "USD 29.990,50"],
  ] as const)("%s %s → %s", (amount, currency, expected) => {
    expect(formatMoney({ amount, currency })).toBe(expected);
  });
});

describe("aritmética exacta (DEC-058)", () => {
  const usd = (amount: string) => ({ amount, currency: "USD" as const });

  it("centavos exactos, sin float", () => {
    expect(toMinorUnits("49900.50")).toBe(BigInt(4990050));
    expect(toMinorUnits("0.1")).toBe(BigInt(10));
    expect(toMinorUnits("999999999999.99")).toBe(BigInt("99999999999999"));
    expect(() => toMinorUnits("1.999")).toThrow("invalid money amount");
    expect(() => toMinorUnits("-5")).toThrow("invalid money amount");
  });

  it("diferencia con signo, en la misma moneda", () => {
    expect(moneyDifference(usd("58000.00"), usd("49900.00"))).toEqual({
      sign: 1,
      amount: usd("8100.00"),
    });
    expect(moneyDifference(usd("49900.00"), usd("58000.50"))).toEqual({
      sign: -1,
      amount: usd("8100.50"),
    });
    expect(moneyDifference(usd("1.00"), usd("1"))).toEqual({
      sign: 0,
      amount: usd("0.00"),
    });
    // 0,1 + 0,2 en float no es 0,3: acá sí.
    expect(moneyDifference(usd("0.30"), usd("0.10"))?.amount).toEqual(
      usd("0.20"),
    );
  });

  it("monedas distintas no se comparan (sin FX)", () => {
    expect(
      moneyDifference(usd("1.00"), { amount: "7300", currency: "PYG" }),
    ).toBeNull();
    expect(
      moneyPercent(usd("1.00"), { amount: "7300", currency: "PYG" }),
    ).toBeNull();
  });

  it("porcentaje entero truncado; sobre cero no hay porcentaje", () => {
    expect(moneyPercent(usd("20000.00"), usd("58000.00"))).toBe(34);
    expect(moneyPercent(usd("29999.99"), usd("100000.00"))).toBe(29);
    expect(moneyPercent(usd("58000.00"), usd("58000.00"))).toBe(100);
    expect(moneyPercent(usd("1.00"), usd("0.00"))).toBeNull();
  });
});
