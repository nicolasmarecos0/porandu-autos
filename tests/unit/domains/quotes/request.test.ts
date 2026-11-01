import { describe, expect, it } from "vitest";

import type { Money } from "@/domains/money";
import {
  addDays,
  defaultValidUntil,
  parsePercent,
  parseQuoteTerms,
  QUOTE_NOTES_MAX_LENGTH,
  type QuoteTermsValues,
} from "@/domains/quotes/request";

/*
 * Alta de una cotización (Hito 10, DEC-042 §4): validación con Zod de
 * descuento, validez y condiciones. Input no confiable.
 */

const TODAY = "2026-11-01";
const USD: Money = { amount: "50000.00", currency: "USD" };
const PYG: Money = { amount: "150000000.00", currency: "PYG" };

const values = (
  overrides: Partial<QuoteTermsValues> = {},
): QuoteTermsValues => ({
  discountKind: "none",
  discountValue: "",
  validUntil: "2026-11-08",
  notes: "",
  ...overrides,
});

describe("fechas", () => {
  it("suma días de calendario cruzando meses y años", () => {
    expect(addDays("2026-11-01", 7)).toBe("2026-11-08");
    expect(addDays("2026-12-28", 7)).toBe("2027-01-04");
    expect(addDays("2028-02-28", 1)).toBe("2028-02-29");
    expect(defaultValidUntil(TODAY)).toBe("2026-11-08");
    expect(() => addDays("2026-02-30", 1)).toThrow();
  });
});

describe("parsePercent", () => {
  it("lee porcentajes es-PY con coma", () => {
    expect(parsePercent("7,5")).toBe("7.50");
    expect(parsePercent(" 10 ")).toBe("10.00");
    expect(parsePercent("07,25")).toBe("7.25");
    expect(parsePercent("7.5")).toBeNull();
    expect(parsePercent("100")).toBeNull();
    expect(parsePercent("-5")).toBeNull();
  });
});

describe("parseQuoteTerms", () => {
  it("sin descuento, con la validez propuesta y sin condiciones", () => {
    expect(parseQuoteTerms(values(), USD, TODAY)).toEqual({
      ok: true,
      terms: {
        discount: { kind: "none" },
        validUntil: "2026-11-08",
        notes: null,
      },
    });
  });

  it("monto y porcentaje en formato es-PY, con las condiciones normalizadas", () => {
    expect(
      parseQuoteTerms(
        values({
          discountKind: "amount",
          discountValue: "5.000.000",
          notes: "  Incluye   transferencia.\r\n\r\n\r\nEntrega en 15 días ",
        }),
        PYG,
        TODAY,
      ),
    ).toEqual({
      ok: true,
      terms: {
        discount: { kind: "amount", value: "5000000.00" },
        validUntil: "2026-11-08",
        notes: "Incluye transferencia.\n\nEntrega en 15 días",
      },
    });
    expect(
      parseQuoteTerms(
        values({ discountKind: "percent", discountValue: "7,5" }),
        USD,
        TODAY,
      ),
    ).toMatchObject({
      ok: true,
      terms: { discount: { kind: "percent", value: "7.50" } },
    });
  });

  it("errores de descuento por campo", () => {
    const cases: [Partial<QuoteTermsValues>, Money, string][] = [
      [{ discountKind: "amount", discountValue: "" }, USD, "required"],
      [{ discountKind: "amount", discountValue: "1.5" }, USD, "invalid_amount"],
      [
        { discountKind: "percent", discountValue: "7.5" },
        USD,
        "invalid_percent",
      ],
      [{ discountKind: "percent", discountValue: "0" }, USD, "not_positive"],
      [
        { discountKind: "amount", discountValue: "1000,50" },
        PYG,
        "pyg_decimals",
      ],
      [{ discountKind: "percent", discountValue: "30,01" }, USD, "too_large"],
      [
        { discountKind: "amount", discountValue: "15.000,01" },
        USD,
        "too_large",
      ],
    ];
    for (const [overrides, list, error] of cases) {
      expect(parseQuoteTerms(values(overrides), list, TODAY)).toEqual({
        ok: false,
        errors: { discountValue: error },
      });
    }
  });

  it("tipo de descuento desconocido, validez fuera de la ventana y condiciones largas", () => {
    expect(
      parseQuoteTerms(values({ discountKind: "gift" }), USD, TODAY),
    ).toEqual({ ok: false, errors: { discountKind: "invalid_option" } });
    expect(
      parseQuoteTerms(values({ validUntil: "2026-10-31" }), USD, TODAY),
    ).toEqual({ ok: false, errors: { validUntil: "in_the_past" } });
    expect(
      parseQuoteTerms(values({ validUntil: "2026-12-02" }), USD, TODAY),
    ).toEqual({ ok: false, errors: { validUntil: "too_far" } });
    expect(
      parseQuoteTerms(values({ validUntil: "2026-12-01" }), USD, TODAY).ok,
    ).toBe(true);
    expect(
      parseQuoteTerms(values({ validUntil: "2026-02-30" }), USD, TODAY),
    ).toEqual({ ok: false, errors: { validUntil: "invalid_date" } });
    expect(
      parseQuoteTerms(
        values({ notes: "a".repeat(QUOTE_NOTES_MAX_LENGTH + 1) }),
        USD,
        TODAY,
      ),
    ).toEqual({ ok: false, errors: { notes: "too_long" } });
  });
});
