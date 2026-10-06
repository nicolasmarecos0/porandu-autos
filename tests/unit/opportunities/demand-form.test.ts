import { describe, expect, it } from "vitest";

import {
  demandErrorsToForm,
  parseDemandEditForm,
  parseDemandFields,
} from "@/lib/opportunities/demand-form";

/*
 * "Lo que busca" (H1.4) leído en el servidor: del texto del formulario al
 * valor candidato de cada fact, con las reglas del dominio. Todo es
 * opcional: un fact vacío no tiene dato.
 */

function form(fields: Record<string, string | string[]>): FormData {
  const data = new FormData();
  for (const [name, value] of Object.entries(fields)) {
    for (const item of [value].flat()) data.append(name, item);
  }
  return data;
}

describe("parseDemandFields: el alta", () => {
  it("sin datos, ningún fact: el vendedor no es un data-entry", () => {
    expect(parseDemandFields(form({}))).toMatchObject({
      ok: true,
      values: {
        desired_vehicle: null,
        year_range: null,
        budget_max: null,
        purchase_type: null,
        trade_in_intent: null,
        down_payment: null,
      },
    });
  });

  it("lee cada fact en su forma canónica", () => {
    expect(
      parseDemandFields(
        form({
          brand: "  Toyota ",
          model: "Hilux   SRV",
          purchaseType: "financed",
          downPaymentAmount: "0",
          downPaymentCurrency: "PYG",
          tradeIn: "no",
          budgetAmount: "29.990,5",
          budgetCurrency: "USD",
          yearMin: "2022",
          yearMax: "",
        }),
      ),
    ).toEqual({
      ok: true,
      values: {
        desired_vehicle: { brand: "Toyota", model: "Hilux SRV" },
        year_range: { min: 2022 },
        budget_max: { amount: "29990.50", currency: "USD" },
        purchase_type: "financed",
        trade_in_intent: false,
        down_payment: { amount: "0.00", currency: "PYG" },
      },
      echo: expect.objectContaining({ brand: "Toyota", model: "Hilux SRV" }),
    });
  });

  it("marca sola es válida (T14)", () => {
    expect(parseDemandFields(form({ brand: "Toyota" }))).toMatchObject({
      ok: true,
      values: { desired_vehicle: { brand: "Toyota" } },
    });
  });

  it.each([
    [{ budgetAmount: "250.000.000" }, { budgetCurrency: "required" }],
    [{ budgetCurrency: "PYG" }, { budgetAmount: "required" }],
    [
      { budgetAmount: "0", budgetCurrency: "PYG" },
      { budgetAmount: "not_positive" },
    ],
    [
      { budgetAmount: "150.000.000,5", budgetCurrency: "PYG" },
      { budgetAmount: "pyg_decimals" },
    ],
    [
      { budgetAmount: "49900.50", budgetCurrency: "USD" },
      { budgetAmount: "invalid_amount" },
    ],
    [
      { budgetAmount: "1.000", budgetCurrency: "BRL" },
      { budgetCurrency: "invalid_currency" },
    ],
    [
      { downPaymentAmount: "-1", downPaymentCurrency: "PYG" },
      { downPaymentAmount: "invalid_amount" },
    ],
    [{ yearMin: "22" }, { yearMin: "invalid_year" }],
    [{ yearMin: "1850" }, { yearMin: "invalid_year" }],
    [{ yearMin: "2023", yearMax: "2020" }, { yearMax: "year_order" }],
    [{ purchaseType: "Contado" }, { purchaseType: "invalid_option" }],
    [{ tradeIn: "sí" }, { tradeIn: "invalid_boolean" }],
    [{ brand: "x".repeat(41) }, { brand: "too_long" }],
    [{ model: "y".repeat(81) }, { model: "too_long" }],
  ])("%j → %j", (fields, errors) => {
    expect(parseDemandFields(form(fields))).toEqual({
      ok: false,
      errors,
      echo: expect.any(Object),
    });
  });

  it("solo lee los campos de la demanda: estado, fuente, autor y organización no tienen adónde ir", () => {
    const parsed = parseDemandFields(
      form({
        purchaseType: "cash",
        status: "detected",
        source_kind: "extractor",
        recorded_by: "x",
        organization_id: "y",
        version: "SRV",
      }),
    );
    expect(JSON.stringify(parsed)).not.toMatch(/detected|extractor|SRV/);
  });
});

describe("parseDemandEditForm: la edición", () => {
  const OPPORTUNITY = "30000000-0000-4000-8000-000000000001";
  const HEAD = "40000000-0000-4000-8000-000000000001";

  it("solo los facts modificados, con su head; facts desconocidos se ignoran", () => {
    const parsed = parseDemandEditForm(
      form({
        opportunityId: OPPORTUNITY.toUpperCase(),
        changed: ["year_range", "version", "year_range"],
        "head.year_range": HEAD,
        yearMin: "2020",
        budgetAmount: "1",
      }),
    );
    expect(parsed).toEqual({
      kind: "ok",
      opportunityId: OPPORTUNITY,
      items: [
        {
          op: "set",
          fact: "year_range",
          value: { min: 2020 },
          basedOnHead: HEAD,
        },
      ],
      echo: expect.any(Object),
      note: "",
    });
  });

  it("un head malformado cuenta como sin head (el planner decide si está stale)", () => {
    const parsed = parseDemandEditForm(
      form({
        opportunityId: OPPORTUNITY,
        changed: "purchase_type",
        "head.purchase_type": "no-es-un-id",
        purchaseType: "cash",
      }),
    );
    expect(parsed).toMatchObject({
      kind: "ok",
      items: [{ basedOnHead: null }],
    });
  });

  it("una nota de más de 500 caracteres es inválida", () => {
    expect(
      parseDemandEditForm(
        form({
          opportunityId: OPPORTUNITY,
          changed: "purchase_type",
          purchaseType: "cash",
          note: "x".repeat(501),
        }),
      ),
    ).toMatchObject({ kind: "invalid", errors: { note: "too_long" } });
  });

  it("sin oportunidad identificable → not_found", () => {
    expect(parseDemandEditForm(form({ changed: "purchase_type" }))).toEqual({
      kind: "not_found",
    });
  });
});

describe("demandErrorsToForm", () => {
  it("lleva los errores del planner a los campos del formulario", () => {
    expect(
      demandErrorsToForm([
        { fact: "budget_max", field: "amount", error: "not_positive" },
        { fact: "year_range", field: "max", error: "year_order" },
        { fact: "trade_in_intent", field: "item", error: "invalid_target" },
        { fact: "purchase_type", field: "note", error: "too_long" },
        { fact: null, field: "item", error: "unknown_fact" },
      ]),
    ).toEqual({
      budgetAmount: "not_positive",
      yearMax: "year_order",
      tradeIn: "invalid_option",
      note: "too_long",
    });
  });
});
