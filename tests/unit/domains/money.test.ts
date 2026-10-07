import { describe, expect, it } from "vitest";

import { formatAmount, formatMoney, parseAmount } from "@/domains/money";

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
