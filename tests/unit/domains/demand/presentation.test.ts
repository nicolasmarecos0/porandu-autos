import { describe, expect, it } from "vitest";

import {
  budgetLabel,
  demandSummary,
  downPaymentLabel,
  formatDemandValue,
  PURCHASE_TYPE_LABELS,
  vehicleTitle,
  yearRangeLabel,
} from "@/domains/demand/presentation";
import { resolveDemand } from "@/domains/demand/resolver";

import { detection, human, id, PYG } from "../../support/demand-rows";

/*
 * Presentación de la demanda (spec §10, criterio U3): el copy es-PY de la
 * card "Busca" y el resumen que llega a la cola, sin evidencia, historial
 * ni ids de usuario (U6).
 */

const [h1, h2] = [id("h1"), id("h2")];

describe("copy de cada fact (es-PY)", () => {
  it.each([
    [{ brand: "Toyota", model: "Hilux" }, "Toyota Hilux"],
    [{ model: "Hilux" }, "Hilux"],
    // T14: preferencia incompleta.
    [{ brand: "Toyota" }, "Toyota · modelo sin definir"],
  ])("vehículo %j → %s", (value, expected) => {
    expect(vehicleTitle(value)).toBe(expected);
  });

  it.each([
    [{ min: 2022 }, "Desde 2022"],
    [{ max: 2020 }, "Hasta 2020"],
    [{ min: 2018, max: 2021 }, "2018 a 2021"],
    [{ min: 2022, max: 2022 }, "2022"],
  ])("años %j → %s", (value, expected) => {
    expect(yearRangeLabel(value)).toBe(expected);
  });

  it("presupuesto: precio total máximo", () => {
    expect(budgetLabel(PYG("250000000"))).toBe("Hasta Gs. 250.000.000");
    expect(budgetLabel({ amount: "29990.50", currency: "USD" })).toBe(
      "Hasta USD 29.990,50",
    );
  });

  it("entrega inicial: 0 es «Sin entrega inicial» (T26)", () => {
    expect(downPaymentLabel(PYG("50000000"))).toBe("Gs. 50.000.000");
    expect(downPaymentLabel(PYG("0"))).toBe("Sin entrega inicial");
    expect(downPaymentLabel({ amount: "0", currency: "USD" })).toBe(
      "Sin entrega inicial",
    );
  });

  it("pago y usado", () => {
    expect(PURCHASE_TYPE_LABELS).toEqual({
      cash: "Contado",
      financed: "Financiado",
      undecided: "A definir",
    });
    expect(formatDemandValue("trade_in_intent", true)).toBe("Sí");
    expect(formatDemandValue("trade_in_intent", false)).toBe("No");
  });
});

describe("demandSummary: lo que llega a la cola", () => {
  it("sin demanda, todo Sin dato; sin legado, «Vehículo sin definir» (vehicle null)", () => {
    const summary = demandSummary(resolveDemand([]));
    expect(summary.vehicle).toBeNull();
    for (const fact of Object.values(summary.facts)) {
      expect(fact).toMatchObject({
        status: "unknown",
        display: null,
        input: {},
        unknownReason: "never_captured",
        headId: null,
        currentFactId: null,
        pending: false,
      });
    }
  });

  it("T15: sin facts y con legado, el vehículo es el legado marcado (Dato anterior)", () => {
    expect(
      demandSummary(resolveDemand([]), {
        model: "Toyota Hilux",
        version: "SRV",
      }).vehicle,
    ).toEqual({ title: "Toyota Hilux SRV", source: "legacy" });
  });

  it("T16: con un vehículo cargado y quitado, el legado no reaparece", () => {
    const loaded = human(h1, "desired_vehicle", "confirmed", {
      model: "Ranger",
    });
    expect(
      demandSummary(resolveDemand([loaded]), { model: "Hilux" }).vehicle,
    ).toEqual({ title: "Ranger", source: "demand" });
    const summary = demandSummary(
      resolveDemand([
        loaded,
        human(h2, "desired_vehicle", "rejected", null, {
          target: h1,
          previous: h1,
          at: "14:10",
        }),
      ]),
      { model: "Hilux" },
    );
    expect(summary.vehicle).toBeNull();
    expect(summary.facts.desired_vehicle).toMatchObject({
      status: "unknown",
      display: null,
      unknownReason: "withdrawn",
      headId: h2,
      currentFactId: null,
    });
  });

  it("U3: cada fact con su valor formateado, su estado y los ids de la edición", () => {
    const summary = demandSummary(
      resolveDemand([
        human(id("h1"), "desired_vehicle", "confirmed", { brand: "Toyota" }),
        human(id("h2"), "year_range", "confirmed", { min: 2018, max: 2021 }),
        human(id("h3"), "budget_max", "confirmed", PYG("250000000")),
        human(id("h4"), "purchase_type", "confirmed", "financed"),
        human(id("h5"), "trade_in_intent", "confirmed", true),
        human(id("h6"), "down_payment", "confirmed", PYG("0")),
      ]),
    );
    expect(summary.vehicle).toEqual({
      title: "Toyota · modelo sin definir",
      source: "demand",
    });
    expect(
      Object.fromEntries(
        Object.entries(summary.facts).map(([fact, value]) => [
          fact,
          [value.status, value.display, value.input],
        ]),
      ),
    ).toEqual({
      desired_vehicle: [
        "confirmed",
        "Toyota · modelo sin definir",
        { brand: "Toyota", model: "" },
      ],
      year_range: [
        "confirmed",
        "2018 a 2021",
        { yearMin: "2018", yearMax: "2021" },
      ],
      budget_max: [
        "confirmed",
        "Hasta Gs. 250.000.000",
        { budgetAmount: "250.000.000", budgetCurrency: "PYG" },
      ],
      purchase_type: ["confirmed", "Financiado", { purchaseType: "financed" }],
      trade_in_intent: ["confirmed", "Sí", { tradeIn: "yes" }],
      down_payment: [
        "confirmed",
        "Sin entrega inicial",
        { downPaymentAmount: "0", downPaymentCurrency: "PYG" },
      ],
    });
    expect(summary.facts.budget_max).toMatchObject({
      headId: id("h3"),
      currentFactId: id("h3"),
    });
  });

  it("U6: sin evidencia, historial ni ids de usuario; un pendiente solo se señala", () => {
    const summary = demandSummary(
      resolveDemand([
        human(h1, "budget_max", "confirmed", PYG("250000000"), {
          note: "dijo que vende el auto de la señora",
        }),
        detection(id("d1"), "budget_max", PYG("270000000"), {
          at: "14:10",
          note: "mensaje de whatsapp",
        }),
      ]),
    );
    expect(summary.facts.budget_max).toMatchObject({
      status: "confirmed",
      display: "Hasta Gs. 250.000.000",
      pending: true,
    });
    const json = JSON.stringify(summary);
    expect(json).not.toMatch(
      /señora|whatsapp|history|recordedBy|evidence|00000000000a|270/,
    );
  });
});
