import { describe, expect, it } from "vitest";

import { demandEditChanges, demandFormBaseline } from "@/domains/demand/edit";
import { EMPTY_DEMAND_FORM_VALUES } from "@/domains/demand/form";
import { demandSummary } from "@/domains/demand/presentation";
import { resolveDemand } from "@/domains/demand/resolver";

import { human, id, PYG } from "../../support/demand-rows";

/*
 * Edición de "Lo que busca" (spec §10, criterio U4): el drawer se precarga
 * con el valor vigente (nunca con el legado) y envía solo los facts
 * modificados; vaciar un valor es Quitar y "Fue un error de carga" solo se
 * ofrece sobre un valor humano.
 */

const summary = demandSummary(
  resolveDemand([
    human(id("h1"), "budget_max", "confirmed", PYG("250000000")),
    human(id("h2"), "purchase_type", "confirmed", "cash"),
    human(id("h3"), "desired_vehicle", "confirmed", {
      brand: "Toyota",
      model: "Hilux",
    }),
  ]),
  { model: "Legado que no se precarga" },
);

describe("demandFormBaseline", () => {
  it("precarga el valor vigente; lo Sin dato queda vacío; nunca el legado", () => {
    expect(demandFormBaseline(summary)).toEqual({
      ...EMPTY_DEMAND_FORM_VALUES,
      brand: "Toyota",
      model: "Hilux",
      budgetAmount: "250.000.000",
      budgetCurrency: "PYG",
      purchaseType: "cash",
    });
  });
});

describe("demandEditChanges (U4)", () => {
  const baseline = demandFormBaseline(summary);

  it("sin cambios, nada que enviar (espacios de más no cuentan)", () => {
    expect(demandEditChanges(summary, baseline)).toEqual([]);
    expect(
      demandEditChanges(summary, { ...baseline, model: "  Hilux " }),
    ).toEqual([]);
  });

  it("solo los facts modificados, en el orden canónico", () => {
    expect(
      demandEditChanges(summary, {
        ...baseline,
        yearMin: "2020",
        budgetAmount: "270.000.000",
      }),
    ).toEqual([
      { fact: "year_range", kind: "set", canBeLoadError: false },
      { fact: "budget_max", kind: "set", canBeLoadError: true },
    ]);
  });

  it("vaciar un fact con valor es Quitar; vaciar uno sin dato no cambia nada", () => {
    expect(
      demandEditChanges(summary, {
        ...baseline,
        purchaseType: "",
        tradeIn: "",
      }),
    ).toEqual([
      { fact: "purchase_type", kind: "remove", canBeLoadError: false },
    ]);
  });

  it("vaciar solo la marca no es Quitar: el modelo sigue", () => {
    expect(demandEditChanges(summary, { ...baseline, brand: "" })).toEqual([
      { fact: "desired_vehicle", kind: "set", canBeLoadError: true },
    ]);
  });
});
