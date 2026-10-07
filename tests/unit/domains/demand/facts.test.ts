import { describe, expect, it } from "vitest";

import {
  canonicalAmount,
  DEMAND_FACTS,
  demandValueEquals,
  validateFactValue,
  type DemandFact,
} from "@/domains/demand/facts";

/*
 * Fact Contract de H1.4 (spec §3, criterios D2, D3 y D4): cada fact acepta
 * los ejemplos válidos y rechaza los inválidos con un error por campo, los
 * decimales de más se rechazan antes de llegar a la base y la igualdad sigue
 * la tabla de §5.
 */

describe("lista cerrada de facts", () => {
  it("son los 6 de v0, en el orden canónico", () => {
    expect(DEMAND_FACTS).toEqual([
      "desired_vehicle",
      "year_range",
      "budget_max",
      "purchase_type",
      "trade_in_intent",
      "down_payment",
    ]);
  });

  it("un fact desconocido no se valida", () => {
    expect(() =>
      validateFactValue("version" as DemandFact, { version: "SRV" }),
    ).toThrow(/unknown demand fact/);
  });
});

describe("desired_vehicle {brand?, model?} (C-4)", () => {
  it.each([
    [{ model: "Hilux" }, { model: "Hilux" }],
    [
      { brand: "Toyota", model: "Hilux" },
      { brand: "Toyota", model: "Hilux" },
    ],
    [{ brand: "Toyota" }, { brand: "Toyota" }],
    // Dos vehículos en el modelo se guardan tal cual, sin parsear.
    [{ model: "Hilux o Ranger" }, { model: "Hilux o Ranger" }],
    [{ brand: "x".repeat(40) }, { brand: "x".repeat(40) }],
    [{ model: "y".repeat(80) }, { model: "y".repeat(80) }],
    // Ausente = null: un campo en null no es un dato.
    [{ brand: null, model: "Hilux" }, { model: "Hilux" }],
    // El largo es en caracteres, no en unidades UTF-16.
    [{ brand: "🚙".repeat(40) }, { brand: "🚙".repeat(40) }],
  ])("válido: %j", (value, expected) => {
    expect(validateFactValue("desired_vehicle", value)).toEqual({
      ok: true,
      value: expected,
    });
  });

  it.each([
    [{}, { value: "empty" }],
    [{ brand: null, model: null }, { value: "empty" }],
    [{ brand: "  " }, { brand: "invalid_text" }],
    [{ brand: "" }, { brand: "invalid_text" }],
    [{ brand: " Toyota" }, { brand: "invalid_text" }],
    [{ model: "Hilux\n" }, { model: "invalid_text" }],
    [{ model: "Hi\u0007lux" }, { model: "invalid_text" }],
    [{ brand: "x".repeat(41) }, { brand: "too_long" }],
    [{ model: "y".repeat(81) }, { model: "too_long" }],
    [{ brand: 7 }, { brand: "invalid_text" }],
    [{ version: "SRV" }, { value: "unexpected_field" }],
    [{ model: "Hilux", version: "SRV" }, { value: "unexpected_field" }],
    ["Toyota Hilux", { value: "invalid_text" }],
    [null, { value: "invalid_text" }],
    [[{ model: "Hilux" }, { model: "Ranger" }], { value: "invalid_text" }],
  ])("inválido: %j → %j", (value, errors) => {
    expect(validateFactValue("desired_vehicle", value)).toEqual({
      ok: false,
      errors,
    });
  });
});

describe("year_range {min?, max?}: extremos abiertos", () => {
  it.each([
    [{ min: 2022 }, { min: 2022 }],
    [{ max: 2020 }, { max: 2020 }],
    [
      { min: 2018, max: 2021 },
      { min: 2018, max: 2021 },
    ],
    [
      { min: 2022, max: 2022 },
      { min: 2022, max: 2022 },
    ],
    [
      { min: 1900, max: 2100 },
      { min: 1900, max: 2100 },
    ],
  ])("válido: %j", (value, expected) => {
    expect(validateFactValue("year_range", value)).toEqual({
      ok: true,
      value: expected,
    });
  });

  it.each([
    [{}, { value: "empty" }],
    [{ min: 2023, max: 2020 }, { max: "year_order" }],
    [{ min: 1850 }, { min: "invalid_year" }],
    [{ max: 2101 }, { max: "invalid_year" }],
    [{ min: 2022.5 }, { min: "invalid_year" }],
    [{ min: "2022" }, { min: "invalid_year" }],
    [{ min: Number.NaN }, { min: "invalid_year" }],
    [{ min: 2020, year: 2021 }, { value: "unexpected_field" }],
    [2022, { value: "invalid_year" }],
  ])("inválido: %j → %j", (value, errors) => {
    expect(validateFactValue("year_range", value)).toEqual({
      ok: false,
      errors,
    });
  });
});

describe("budget_max {amount, currency}: precio total máximo, sin FX", () => {
  it.each([
    [
      { amount: "250000000", currency: "PYG" },
      { amount: "250000000.00", currency: "PYG" },
    ],
    [
      { amount: "30000", currency: "USD" },
      { amount: "30000.00", currency: "USD" },
    ],
    [
      { amount: "29990.50", currency: "USD" },
      { amount: "29990.50", currency: "USD" },
    ],
    [
      { amount: "29990.5", currency: "USD" },
      { amount: "29990.50", currency: "USD" },
    ],
    // Ceros de más no son decimales de más.
    [
      { amount: "150000000.00", currency: "PYG" },
      { amount: "150000000.00", currency: "PYG" },
    ],
    [
      { amount: "999999999999.99", currency: "USD" },
      { amount: "999999999999.99", currency: "USD" },
    ],
  ])("válido: %j", (value, expected) => {
    expect(validateFactValue("budget_max", value)).toEqual({
      ok: true,
      value: expected,
    });
  });

  it.each([
    [{ amount: "0", currency: "PYG" }, { amount: "not_positive" }],
    [{ amount: "-1", currency: "USD" }, { amount: "invalid_amount" }],
    // D3: los decimales de más se rechazan antes de llegar a la base.
    [{ amount: "150000000.5", currency: "PYG" }, { amount: "pyg_decimals" }],
    [{ amount: "29990.505", currency: "USD" }, { amount: "too_many_decimals" }],
    [{ amount: "250000000" }, { currency: "required" }],
    [{ currency: "PYG" }, { amount: "required" }],
    [
      { amount: "250000000", currency: "BRL" },
      { currency: "invalid_currency" },
    ],
    [{ amount: "250.000.000", currency: "PYG" }, { amount: "invalid_amount" }],
    [{ amount: 250000000, currency: "PYG" }, { amount: "invalid_amount" }],
    [
      { amount: "1000000000000", currency: "USD" },
      { amount: "invalid_amount" },
    ],
    [
      { amount: "1", currency: "PYG", fx: "USD" },
      { value: "unexpected_field" },
    ],
  ])("inválido: %j → %j", (value, errors) => {
    expect(validateFactValue("budget_max", value)).toEqual({
      ok: false,
      errors,
    });
  });
});

describe("down_payment {amount, currency}: efectivo inicial, ≥ 0 (C-6)", () => {
  it.each([
    [
      { amount: "50000000", currency: "PYG" },
      { amount: "50000000.00", currency: "PYG" },
    ],
    [
      { amount: "5000", currency: "USD" },
      { amount: "5000.00", currency: "USD" },
    ],
    // T26: 0 es "Sin entrega inicial", una respuesta, no Unknown.
    [
      { amount: "0", currency: "PYG" },
      { amount: "0.00", currency: "PYG" },
    ],
  ])("válido: %j", (value, expected) => {
    expect(validateFactValue("down_payment", value)).toEqual({
      ok: true,
      value: expected,
    });
  });

  it.each([
    [{ amount: "-1", currency: "PYG" }, { amount: "invalid_amount" }],
    [{ amount: "50000000.5", currency: "PYG" }, { amount: "pyg_decimals" }],
    [{ amount: "50000000" }, { currency: "required" }],
  ])("inválido: %j → %j", (value, errors) => {
    expect(validateFactValue("down_payment", value)).toEqual({
      ok: false,
      errors,
    });
  });
});

describe("purchase_type: cash | financed | undecided", () => {
  it.each(["cash", "financed", "undecided"])("válido: %s", (value) => {
    expect(validateFactValue("purchase_type", value)).toEqual({
      ok: true,
      value,
    });
  });

  it.each(["mixed", "", "Contado", null, undefined, 1])(
    "inválido: %j",
    (value) => {
      expect(validateFactValue("purchase_type", value)).toEqual({
        ok: false,
        errors: { value: "invalid_option" },
      });
    },
  );
});

describe("trade_in_intent: boolean", () => {
  it.each([true, false])("válido: %s (false no es Unknown)", (value) => {
    expect(validateFactValue("trade_in_intent", value)).toEqual({
      ok: true,
      value,
    });
  });

  it.each([null, "sí", "true", 1, undefined])("inválido: %j", (value) => {
    expect(validateFactValue("trade_in_intent", value)).toEqual({
      ok: false,
      errors: { value: "invalid_boolean" },
    });
  });
});

describe("canonicalAmount", () => {
  it.each([
    ["250000000", "250000000.00"],
    ["0250000000", "250000000.00"],
    ["29990.5", "29990.50"],
    ["29990.500", "29990.50"],
    ["0", "0.00"],
    ["0.00", "0.00"],
  ])("%s → %s", (raw, expected) => {
    expect(canonicalAmount(raw)).toBe(expected);
  });

  it.each(["29990.505", "-1", "1e3", "", "1.000.000"])("%j → null", (raw) => {
    expect(canonicalAmount(raw)).toBeNull();
  });
});

describe("demandValueEquals (spec §5, D4)", () => {
  it("montos: iguales numéricamente y en la misma moneda", () => {
    const pyg = { amount: "250000000.00", currency: "PYG" } as const;
    expect(
      demandValueEquals("budget_max", pyg, {
        amount: "250000000",
        currency: "PYG",
      }),
    ).toBe(true);
    expect(
      demandValueEquals("budget_max", pyg, {
        amount: "250000000.00",
        currency: "USD",
      }),
    ).toBe(false);
    expect(
      demandValueEquals("down_payment", pyg, {
        amount: "250000001",
        currency: "PYG",
      }),
    ).toBe(false);
  });

  it("textos: igualdad exacta (sin normalizar mayúsculas)", () => {
    expect(
      demandValueEquals(
        "desired_vehicle",
        { model: "Hilux" },
        { model: "Hilux" },
      ),
    ).toBe(true);
    expect(
      demandValueEquals(
        "desired_vehicle",
        { model: "Hilux" },
        { model: "HILUX" },
      ),
    ).toBe(false);
  });

  it("objetos: igualdad estructural con ausente = null; un subconjunto no es igual", () => {
    expect(
      demandValueEquals(
        "desired_vehicle",
        { model: "Hilux" },
        { brand: "Toyota", model: "Hilux" },
      ),
    ).toBe(false);
    expect(demandValueEquals("year_range", { min: 2022 }, { min: 2022 })).toBe(
      true,
    );
    expect(
      demandValueEquals("year_range", { min: 2022 }, { min: 2022, max: 2022 }),
    ).toBe(false);
  });

  it("escalares", () => {
    expect(demandValueEquals("purchase_type", "cash", "cash")).toBe(true);
    expect(demandValueEquals("purchase_type", "cash", "financed")).toBe(false);
    expect(demandValueEquals("trade_in_intent", false, false)).toBe(true);
    expect(demandValueEquals("trade_in_intent", true, false)).toBe(false);
  });
});
