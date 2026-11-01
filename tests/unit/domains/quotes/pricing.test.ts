import { describe, expect, it } from "vitest";

import {
  discountAmount,
  discountExceeds,
  formatEffectivePercent,
  fromCents,
  MAX_DISCOUNT_PERCENT,
  quoteTotal,
  requiresAdminApproval,
  toCents,
  type Discount,
} from "@/domains/quotes/pricing";
import type { Money } from "@/domains/money";

/*
 * Precio de una cotización (Hito 10, DEC-042 §3): total exacto sobre
 * centavos, con el mismo redondeo que el CHECK quotes_total_price_check
 * (tests/db/quotes.test.ts cruza los dos contra Postgres).
 */

const usd = (amount: string): Money => ({ amount, currency: "USD" });
const pyg = (amount: string): Money => ({ amount, currency: "PYG" });

describe("centavos", () => {
  it("ida y vuelta exacta, sin float", () => {
    expect(toCents("32990.50")).toBe(BigInt(3_299_050));
    expect(fromCents(BigInt(3_299_050))).toBe("32990.50");
    expect(fromCents(BigInt(5))).toBe("0.05");
    expect(toCents("999999999999.99")).toBe(BigInt(99_999_999_999_999));
  });

  it("rechaza decimales no canónicos y negativos", () => {
    expect(() => toCents("1.5")).toThrow();
    expect(() => toCents("1,50")).toThrow();
    expect(() => fromCents(-BigInt(1))).toThrow();
  });
});

describe("quoteTotal", () => {
  it("sin descuento: el total es la lista", () => {
    expect(quoteTotal(usd("50000.00"), { kind: "none" })).toEqual(
      usd("50000.00"),
    );
  });

  it("monto fijo: lista − monto, en la moneda de la lista", () => {
    expect(
      quoteTotal(pyg("150000000.00"), { kind: "amount", value: "5000000.00" }),
    ).toEqual(pyg("145000000.00"));
    expect(
      quoteTotal(usd("32990.50"), { kind: "amount", value: "990.75" }),
    ).toEqual(usd("31999.75"));
  });

  it("porcentaje: redondea al centavo en USD y al guaraní en PYG, la mitad hacia arriba", () => {
    // 32.990,50 × 0,925 = 30.516,2125 → 30.516,21
    expect(
      quoteTotal(usd("32990.50"), { kind: "percent", value: "7.50" }),
    ).toEqual(usd("30516.21"));
    // 0,05 × 0,90 = 0,045 → 0,05 (la mitad sube)
    expect(
      quoteTotal(usd("0.05"), { kind: "percent", value: "10.00" }),
    ).toEqual(usd("0.05"));
    // 1.005 × 0,995 = 999,975 → 1.000
    expect(
      quoteTotal(pyg("1005.00"), { kind: "percent", value: "0.50" }),
    ).toEqual(pyg("1000.00"));
    // 150.000.000 × 0,925 = 138.750.000
    expect(
      quoteTotal(pyg("150000000.00"), { kind: "percent", value: "7.50" }),
    ).toEqual(pyg("138750000.00"));
  });

  it("el monto descontado es lista − total", () => {
    expect(
      discountAmount(usd("32990.50"), { kind: "percent", value: "7.50" }),
    ).toEqual(usd("2474.29"));
    expect(discountAmount(usd("100.00"), { kind: "none" })).toEqual(
      usd("0.00"),
    );
  });
});

describe("límites del descuento", () => {
  const list = usd("50000.00");

  it("compara el descuento efectivo de forma exacta", () => {
    const cases: [Discount, number, boolean][] = [
      [{ kind: "none" }, 0, false],
      [{ kind: "percent", value: "10.00" }, 10, false],
      [{ kind: "percent", value: "10.01" }, 10, true],
      [{ kind: "amount", value: "5000.00" }, 10, false],
      [{ kind: "amount", value: "5000.01" }, 10, true],
      [{ kind: "amount", value: "15000.00" }, MAX_DISCOUNT_PERCENT, false],
      [{ kind: "amount", value: "15000.01" }, MAX_DISCOUNT_PERCENT, true],
    ];
    for (const [discount, percent, exceeds] of cases) {
      expect(discountExceeds(list, discount, percent)).toBe(exceeds);
    }
  });

  it("aprobar más del 10 % exige admin", () => {
    expect(
      requiresAdminApproval(list, { kind: "percent", value: "10.00" }),
    ).toBe(false);
    expect(
      requiresAdminApproval(list, { kind: "percent", value: "12.00" }),
    ).toBe(true);
    expect(requiresAdminApproval(list, { kind: "none" })).toBe(false);
  });

  it("muestra el porcentaje efectivo con coma es-PY", () => {
    expect(
      formatEffectivePercent(list, { kind: "amount", value: "3750.00" }),
    ).toBe("7,5 %");
    expect(
      formatEffectivePercent(list, { kind: "percent", value: "10.00" }),
    ).toBe("10 %");
    expect(formatEffectivePercent(list, { kind: "none" })).toBe("0 %");
  });
});
