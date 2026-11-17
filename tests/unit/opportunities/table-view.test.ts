import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { OpportunitiesTableView } from "@/components/opportunities/opportunities-table-view";
import { demandSummary } from "@/domains/demand/presentation";
import { resolveDemand } from "@/domains/demand/resolver";
import { bucketFromRecency } from "@/domains/opportunities/queue";
import type { Opportunity } from "@/domains/opportunities/types";
import { UNSCORED } from "@/domains/scoring/types";

import { human } from "../support/demand-rows";

/*
 * Vista Tabla de Opportunities (DEC-055), renderizada en el servidor sin
 * DOM: las columnas reales (sin Lease, cuotas ni Outreach), el orden inicial
 * por Porandú, cada fila con su enlace a la ficha de decisión (`?op=`), el
 * pago y los scores "sin dato" dichos como tales, y la lista compacta del
 * teléfono. Buscar, ordenar y paginar se prueban en
 * tests/unit/domains/opportunities/table.test.ts.
 */

vi.mock("@/lib/opportunities/actions", () => ({
  createOpportunity: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

function opportunity(
  id: string,
  name: string,
  porandu: number | null,
  withDemand: boolean,
): Opportunity {
  const minutes = 15;
  return {
    id,
    prospect: { name, initials: "XX", channel: "WhatsApp", live: withDemand },
    demand: withDemand
      ? demandSummary(
          resolveDemand([
            human("v", "desired_vehicle", "confirmed", {
              brand: "Toyota",
              model: "Hilux",
            }),
            human("p", "purchase_type", "confirmed", "financed"),
          ]),
        )
      : demandSummary(resolveDemand([])),
    interest: {},
    scores: { ...UNSCORED, porandu, deal: porandu === null ? null : 45 },
    lastActivity: { minutes, state: "active" },
    owner: withDemand
      ? { id: "adv-1", name: "Lorena Vera", initials: "LV" }
      : undefined,
    stage: withDemand ? "qualifying" : "new",
    bucket: bucketFromRecency(minutes),
    drivers: [],
  };
}

const ROWS = [
  opportunity("op-low", "Carolina Riveros", null, false),
  opportunity("op-high", "Ramón Benítez", 88, true),
];

const html = renderToStaticMarkup(
  createElement(OpportunitiesTableView, {
    title: "Tabla de oportunidades",
    opportunities: ROWS,
    referenceMinuteOfDay: 10 * 60,
  }),
);

function text(markup: string): string {
  return markup
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

describe("OpportunitiesTableView", () => {
  it("encabezado carbón con las columnas reales, sin Lease ni Outreach", () => {
    const head = html.slice(html.indexOf("<thead"), html.indexOf("</thead>"));
    expect(text(head)).toBe(
      "Prospecto / vehículo Pago Responsable Actividad Señales Porandú Intent Vehicle Fit Deal",
    );
    expect(head).toContain("bg-surface-inverse");
    expect(html).not.toMatch(/Lease|Outreach|APR|cuota/i);
  });

  it("ordena de entrada por Porandú descendente, con el sin dato al final", () => {
    expect(html).toMatch(/<th[^>]*aria-sort="descending"[^>]*>.*?Porandú/);
    const tbody = html.slice(html.indexOf("<tbody"), html.indexOf("</tbody>"));
    expect(tbody.indexOf("Ramón Benítez")).toBeLessThan(
      tbody.indexOf("Carolina Riveros"),
    );
  });

  it("cada fila lleva a la ficha de decisión en la cola", () => {
    expect(html).toContain('href="/opportunities?op=op-high"');
    expect(html).toContain('href="/opportunities?op=op-low"');
  });

  it("muestra pago, responsable y vehículo reales; lo que falta, sin dato", () => {
    const tbody = text(
      html.slice(html.indexOf("<tbody"), html.indexOf("</tbody>")),
    );
    expect(tbody).toContain(
      "Ramón Benítez Toyota Hilux En calificación Financiado Lorena Vera",
    );
    expect(tbody).toContain(
      "Carolina Riveros Vehículo sin definir Nueva Sin dato Sin asignar",
    );
    expect(tbody).toContain("— sin dato");
  });

  it("resalta la columna del Porandú en azul hielo", () => {
    expect(html).toMatch(/<td class="[^"]*bg-navy-soft[^"]*">88<\/td>/);
  });

  it("las señales salen de datos reales, con su texto accesible", () => {
    expect(html).toContain("Conversación de WhatsApp en vivo");
    expect(html).not.toContain("Entrega un usado");
  });

  it("cuenta resultados y ofrece el alta en verde", () => {
    expect(text(html)).toContain("2 resultados");
    expect(html).toMatch(/<button[^>]*bg-success[^>]*>.*?Nueva oportunidad/);
  });

  it("en el teléfono, una lista compacta con el mismo destino", () => {
    const list = html.slice(html.indexOf('<ul aria-label="Oportunidades"'));
    expect(list).toContain('href="/opportunities?op=op-high"');
    expect(text(list)).toContain("Financiado");
  });
});
