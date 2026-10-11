import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { OpportunityStagePanel } from "@/components/opportunities/opportunity-stage-panel";
import type { Stage } from "@/domains/opportunities/stages";

/*
 * Panel de etapa de /opportunities/[id] (H1.6, DEC-032 §5), renderizado en el
 * servidor sin DOM: ofrece exactamente las acciones que la máquina de estados
 * permite desde la etapa actual, marca la etapa actual y, cerrada, no ofrece
 * nada. Los diálogos de cierre arrancan cerrados (solo su botón). La Server
 * Action no se llama: se prueba en change-stage-action.test.ts y contra la
 * base en tests/db/opportunity-stages.test.ts.
 */

vi.mock("@/lib/opportunities/actions", () => ({
  changeOpportunityStage: vi.fn(),
  closeOpportunity: vi.fn(),
}));

const ID = "10000000-0000-4000-8000-000000000101";

function render(stage: Stage): string {
  return renderToStaticMarkup(
    createElement(OpportunityStagePanel, {
      opportunityId: ID,
      stage,
      saleVehicle: { name: "Toyota Hilux", detail: "SRV 2.8 4x4 AT · 2025" },
    }),
  );
}

/** Textos de los botones, en orden. */
function buttons(html: string): string[] {
  return [...html.matchAll(/<button[^>]*>([\s\S]*?)<\/button>/g)].map((match) =>
    match[1]!.replace(/<[^>]+>/g, "").trim(),
  );
}

/** Lo que el stepper anuncia como etapa actual. */
function currentStep(html: string): string | undefined {
  const match = html.match(/<li[^>]*aria-current="step"[^>]*>([\s\S]*?)<\/li>/);
  return match?.[1]!.replace(/<[^>]+>/g, "").trim();
}

describe("OpportunityStagePanel", () => {
  it.each([
    ["new", ["Pasar a calificación", "Marcar como perdida"], "Nueva"],
    [
      "qualifying",
      ["Pasar a negociación", "Marcar como perdida"],
      "En calificación",
    ],
    [
      "negotiating",
      ["Marcar como ganada", "Marcar como perdida"],
      "En negociación",
    ],
  ] as const)(
    "en %s ofrece solo los pases de la máquina",
    (stage, expected, current) => {
      const html = render(stage);
      expect(buttons(html)).toEqual(expected);
      expect(currentStep(html)).toBe(`${current} (etapa actual)`);
    },
  );

  it("el avance envía solo la oportunidad y la etapa de destino", () => {
    const html = render("new");
    expect(html).toContain(`name="opportunityId" value="${ID}"`);
    expect(html).toContain('name="stage" value="qualifying"');
    // El resultado y los metadatos del cierre viven dentro de su diálogo,
    // que arranca cerrado (DEC-034).
    expect(html).not.toContain('name="lossReason"');
    expect(html).not.toContain('name="outcome"');
    expect(html).not.toContain('name="salePrice"');
    expect(html).not.toContain('value="lost"');
  });

  it("ganada: etapa final, sin acciones", () => {
    const html = render("won");
    expect(buttons(html)).toEqual([]);
    expect(currentStep(html)).toBe("Ganada (etapa actual)");
    expect(html).toContain("Venta concretada. Es una etapa final");
  });

  it("perdida: etapa final, sin stepper ni acciones (el motivo lo muestra la tarjeta Cierre)", () => {
    const html = render("lost");
    expect(buttons(html)).toEqual([]);
    expect(currentStep(html)).toBeUndefined();
    expect(html).toContain("Oportunidad perdida. Es una etapa final");
  });

  it("el aviso del resultado es una región viva, vacía al empezar", () => {
    expect(render("new")).toMatch(/<p[^>]*role="status"[^>]*><\/p>/);
  });
});
