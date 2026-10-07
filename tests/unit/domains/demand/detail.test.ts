import { describe, expect, it } from "vitest";

import {
  authorLabel,
  demandDetail,
  formatDemandDate,
  type DemandFactDetail,
} from "@/domains/demand/presentation";
import { resolveDemand, type DemandRow } from "@/domains/demand/resolver";

import {
  at,
  detection,
  human,
  id,
  OTHER_SELLER,
  PYG,
  SELLER,
} from "../../support/demand-rows";

/*
 * Detalle de la demanda en /opportunities/[id] (spec §10, criterios U5 y
 * H2): para cada fact, el valor, el badge, la explicación ("¿Por qué Porandú
 * cree…?") y el historial con etiqueta, autor, fecha y nota. Los autores se
 * presentan contra el usuario que mira; ningún id de usuario sale.
 */

const [h1, h2, h3] = [id("h1"), id("h2"), id("h3")];
const d1 = id("d1");

/** Alta de la oportunidad: el mismo now() que los facts del alta (14:05Z). */
const CREATED_AT = at("14:05");

function detailOf(
  rows: readonly DemandRow[],
  viewerUserId: string = SELLER,
  legacy = {},
) {
  return demandDetail(resolveDemand(rows), {
    viewerUserId,
    createdAt: CREATED_AT,
    legacy,
  });
}

function factOf(
  rows: readonly DemandRow[],
  fact: DemandFactDetail["fact"],
  viewerUserId: string = SELLER,
): DemandFactDetail {
  return detailOf(rows, viewerUserId).facts.find((item) => item.fact === fact)!;
}

describe("fecha y autor", () => {
  it("fecha y hora de Asunción (UTC-3), como en la spec", () => {
    expect(formatDemandDate(at("17:32"))).toBe("6 oct 2026 14:32");
    // Cruza la medianoche local.
    expect(formatDemandDate(at("02:10"))).toBe("5 oct 2026 23:10");
    expect(formatDemandDate(new Date("2026-07-15T12:00:00Z"))).toBe(
      "15 jul 2026 09:00",
    );
  });

  it("autor: «Vos», «Otro miembro» o una detección; nunca un id", () => {
    expect(authorLabel(SELLER, SELLER)).toBe("Vos");
    expect(authorLabel(OTHER_SELLER, SELLER)).toBe("Otro miembro");
    expect(authorLabel(null, SELLER)).toBe("Detección automática");
  });
});

describe("demandDetail: estado vacío y legado", () => {
  it("sin facts: vacío, cada fact Sin dato «Todavía no se cargó», en el orden de la card", () => {
    const detail = detailOf([]);
    expect(detail.empty).toBe(true);
    expect(detail.legacy).toBeNull();
    expect(detail.facts.map((fact) => [fact.fact, fact.label])).toEqual([
      ["desired_vehicle", "Vehículo"],
      ["year_range", "Año"],
      ["budget_max", "Presupuesto"],
      ["purchase_type", "Pago"],
      ["down_payment", "Entrega inicial"],
      ["trade_in_intent", "Usado"],
    ]);
    for (const fact of detail.facts) {
      expect(fact).toMatchObject({
        status: "unknown",
        statusLabel: null,
        display: null,
        explanation: ["Todavía no se cargó"],
        history: [],
      });
    }
  });

  it("el legado se muestra, de solo lectura, mientras nunca se cargó un vehículo", () => {
    const legacy = { model: " Hilux ", version: "SRV" };
    expect(detailOf([], SELLER, legacy).legacy).toBe("Hilux SRV");
    // Otro fact cargado no lo oculta: el vehículo sigue sin cargarse.
    const budget = [human(h1, "budget_max", "confirmed", PYG("250000000"))];
    const withBudget = detailOf(budget, SELLER, legacy);
    expect(withBudget.legacy).toBe("Hilux SRV");
    expect(withBudget.empty).toBe(false);
  });

  it("T16: con un vehículo cargado (aunque después se quitó), el legado no reaparece", () => {
    const rows = [
      human(h1, "desired_vehicle", "confirmed", { model: "Corolla" }),
      human(h2, "desired_vehicle", "rejected", null, {
        target: h1,
        previous: h1,
        at: "15:00",
      }),
    ];
    const detail = detailOf(rows, SELLER, { model: "Hilux" });
    expect(detail.legacy).toBeNull();
    expect(detail.empty).toBe(false);
  });
});

describe("demandDetail: ¿por qué Porandú cree esto? (U5)", () => {
  it("cargado al crear la oportunidad: recorded_at = created_at", () => {
    const fact = factOf(
      [human(h1, "budget_max", "confirmed", PYG("250000000"))],
      "budget_max",
    );
    expect(fact).toMatchObject({
      status: "confirmed",
      statusLabel: "Confirmado",
      display: "Hasta Gs. 250.000.000",
      explanation: [
        "Cargado al crear la oportunidad por Vos · 6 oct 2026 11:05",
      ],
    });
    expect(fact.history).toEqual([
      {
        factId: h1,
        display: "Hasta Gs. 250.000.000",
        label: "Actual",
        author: "Vos",
        at: "6 oct 2026 11:05",
        note: null,
      },
    ]);
  });

  it("cambio del cliente: «Confirmado por…», «Antes:» del target y la nota", () => {
    const rows = [
      human(h1, "budget_max", "confirmed", PYG("250000000")),
      human(h2, "budget_max", "confirmed", PYG("270000000"), {
        target: h1,
        previous: h1,
        at: "17:32",
        by: OTHER_SELLER,
        note: "Subió el presupuesto",
      }),
    ];
    const fact = factOf(rows, "budget_max");
    expect(fact.statusLabel).toBe("Confirmado");
    expect(fact.display).toBe("Hasta Gs. 270.000.000");
    expect(fact.explanation).toEqual([
      "Confirmado por Otro miembro · 6 oct 2026 14:32",
      "Antes: Hasta Gs. 250.000.000",
      "Nota de la edición: Subió el presupuesto",
    ]);
    expect(fact.history.map((item) => [item.factId, item.label])).toEqual([
      [h2, "Actual"],
      [h1, "Reemplazado"],
    ]);
    expect(fact.history[0]).toMatchObject({
      author: "Otro miembro",
      note: "Nota de la edición: Subió el presupuesto",
    });
    // El mismo historial, mirado por el otro miembro.
    const other = factOf(rows, "budget_max", OTHER_SELLER);
    expect(other.explanation[0]).toBe("Confirmado por Vos · 6 oct 2026 14:32");
    expect(other.history.map((item) => item.author)).toEqual([
      "Vos",
      "Otro miembro",
    ]);
  });

  it("error de carga: badge «Corregido» y el valor erróneo como «Corregido»", () => {
    const rows = [
      human(h1, "desired_vehicle", "confirmed", { model: "Hilux" }),
      human(
        h2,
        "desired_vehicle",
        "corrected",
        { brand: "Toyota", model: "Corolla" },
        { target: h1, previous: h1, at: "15:00" },
      ),
    ];
    const fact = factOf(rows, "desired_vehicle");
    expect(fact).toMatchObject({
      status: "corrected",
      statusLabel: "Corregido",
      display: "Toyota Corolla",
      explanation: ["Corregido por Vos · 6 oct 2026 12:00", "Antes: Hilux"],
    });
    expect(fact.history.map((item) => [item.display, item.label])).toEqual([
      ["Toyota Corolla", "Actual"],
      ["Hilux", "Corregido"],
    ]);
  });

  it("quitado: Sin dato con su motivo, autor, fecha y nota", () => {
    const rows = [
      human(h1, "trade_in_intent", "confirmed", true),
      human(h2, "trade_in_intent", "rejected", null, {
        target: h1,
        previous: h1,
        at: "15:00",
        note: "Era de otro cliente",
      }),
    ];
    const fact = factOf(rows, "trade_in_intent");
    expect(fact).toMatchObject({
      status: "unknown",
      statusLabel: null,
      display: null,
      explanation: [
        "Quitado por Vos · 6 oct 2026 12:00",
        "Nota de la edición: Era de otro cliente",
      ],
    });
    expect(fact.history.map((item) => [item.display, item.label])).toEqual([
      ["Sin dato", "Actual"],
      ["Sí", "Quitado"],
    ]);
  });

  it("quitado y vuelto a cargar: el acto de quitar queda «Reemplazado»", () => {
    const rows = [
      human(h1, "purchase_type", "confirmed", "cash"),
      human(h2, "purchase_type", "rejected", null, {
        target: h1,
        previous: h1,
        at: "15:00",
      }),
      human(h3, "purchase_type", "confirmed", "financed", {
        previous: h2,
        at: "16:00",
      }),
    ];
    const fact = factOf(rows, "purchase_type");
    expect(fact.display).toBe("Financiado");
    expect(fact.explanation).toEqual(["Confirmado por Vos · 6 oct 2026 13:00"]);
    expect(fact.history.map((item) => [item.display, item.label])).toEqual([
      ["Financiado", "Actual"],
      ["Sin dato", "Reemplazado"],
      ["Contado", "Quitado"],
    ]);
  });

  it("entrega inicial 0: «Sin entrega inicial», no Sin dato (T26)", () => {
    const fact = factOf(
      [human(h1, "down_payment", "confirmed", PYG("0"))],
      "down_payment",
    );
    expect(fact.display).toBe("Sin entrega inicial");
    expect(fact.statusLabel).toBe("Confirmado");
  });

  it("un ledger inconsistente no inventa un valor ni un historial", () => {
    const rows = [
      human(h1, "year_range", "confirmed", { min: 2018 }),
      human(h2, "year_range", "confirmed", { min: 2020 }, { at: "15:00" }),
    ];
    expect(factOf(rows, "year_range")).toMatchObject({
      status: "unknown",
      display: null,
      explanation: ["No pudimos leer este dato. Avisá al administrador."],
      history: [],
    });
  });

  it("ningún id de usuario sale del detalle", () => {
    const rows = [
      human(h1, "budget_max", "confirmed", PYG("250000000")),
      human(h2, "budget_max", "confirmed", PYG("270000000"), {
        target: h1,
        previous: h1,
        at: "15:00",
        by: OTHER_SELLER,
      }),
    ];
    const serialized = JSON.stringify(detailOf(rows));
    expect(serialized).not.toContain(SELLER);
    expect(serialized).not.toContain(OTHER_SELLER);
  });
});

describe("demandDetail con detecciones sintéticas (H2a+, criterio F1)", () => {
  it("una detección sin humano es «Detectado», de una detección automática", () => {
    const fact = factOf(
      [detection(d1, "budget_max", PYG("250000000"), { at: "15:00" })],
      "budget_max",
    );
    expect(fact).toMatchObject({
      status: "detected",
      statusLabel: "Detectado",
      explanation: [
        "Detectado automáticamente · 6 oct 2026 12:00",
        "Evidencia: mensaje del cliente",
      ],
    });
    expect(fact.history[0]).toMatchObject({
      author: "Detección automática",
      label: "Actual",
      note: "Evidencia: mensaje del cliente",
    });
  });

  it("aceptar lo detectado sin nota: la evidencia es la de la detección", () => {
    const rows = [
      detection(d1, "budget_max", PYG("270000000"), { at: "15:00" }),
      human(h1, "budget_max", "confirmed", PYG("270000000"), {
        target: d1,
        at: "16:00",
      }),
    ];
    expect(factOf(rows, "budget_max").explanation).toEqual([
      "Confirmado por Vos · 6 oct 2026 13:00",
      "Evidencia: mensaje del cliente",
    ]);
  });

  it("un pendiente nunca es el valor: se explica aparte", () => {
    const rows = [
      human(h1, "budget_max", "confirmed", PYG("250000000")),
      detection(d1, "budget_max", PYG("270000000"), { at: "15:00" }),
    ];
    const fact = factOf(rows, "budget_max");
    expect(fact.display).toBe("Hasta Gs. 250.000.000");
    expect(fact.explanation).toEqual([
      "Cargado al crear la oportunidad por Vos · 6 oct 2026 11:05",
      "Detectado sin revisar: Hasta Gs. 270.000.000",
    ]);
    expect(fact.history.map((item) => item.label)).toEqual([
      "Pendiente",
      "Actual",
    ]);
  });

  it("descartar lo detectado: Sin dato con su motivo", () => {
    const rows = [
      detection(d1, "purchase_type", "cash", { at: "14:00" }),
      human(h1, "purchase_type", "rejected", null, {
        target: d1,
        at: "15:00",
      }),
    ];
    const fact = factOf(rows, "purchase_type");
    expect(fact.status).toBe("unknown");
    expect(fact.explanation).toEqual([
      "Se descartó lo detectado · Vos · 6 oct 2026 12:00",
    ]);
    expect(fact.history.map((item) => [item.display, item.label])).toEqual([
      ["Sin dato", "Actual"],
      ["Contado", "Descartado"],
    ]);
  });
});
