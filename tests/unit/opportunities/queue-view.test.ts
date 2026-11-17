import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { OpportunitiesView } from "@/components/opportunities/opportunities-view";
import { demandSummary } from "@/domains/demand/presentation";
import { resolveDemand } from "@/domains/demand/resolver";
import type { Opportunity } from "@/domains/opportunities/types";
import {
  MOCK_REFERENCE_MINUTE_OF_DAY,
  MOCK_SCORE_COMPOSITION,
  OPPORTUNITY_FIXTURES,
} from "@/mocks/opportunities";

import { human } from "../support/demand-rows";

/*
 * Cola de Opportunities en el teléfono (DEC-055, maestro/detalle),
 * renderizada en el servidor sin DOM: abierta con `?op=` muestra el detalle
 * con su salida ("Volver", o "Volver a la tabla" si vino de la tabla), el
 * atajo "Showroom" al catálogo filtrado por lo que busca y los cuatro scores
 * fijos abajo. Qué región se ve en cada ancho es CSS (`max-md:hidden`).
 */

vi.mock("@/lib/opportunities/actions", () => ({
  createOpportunity: vi.fn(),
  recordOpportunityDemand: vi.fn(),
}));

const [first, second] = OPPORTUNITY_FIXTURES;

const withDemand: Opportunity = {
  ...first!,
  demand: demandSummary(
    resolveDemand([
      human("v", "desired_vehicle", "confirmed", {
        brand: "Toyota",
        model: "Hilux",
      }),
    ]),
  ),
};

function render(
  props: Partial<{
    initialSelectedId: string | null;
    returnHref: string | null;
    opportunities: readonly Opportunity[];
  }> = {},
): string {
  return renderToStaticMarkup(
    createElement(OpportunitiesView, {
      title: "Oportunidades",
      opportunities: props.opportunities ?? [withDemand, second!],
      referenceMinuteOfDay: MOCK_REFERENCE_MINUTE_OF_DAY,
      scoreComposition: MOCK_SCORE_COMPOSITION,
      initialSelectedId: props.initialSelectedId ?? null,
      returnHref: props.returnHref ?? null,
    }),
  );
}

/** Las clases del primer elemento con ese aria-label. */
function classOf(markup: string, label: string): string {
  const tag = new RegExp(`<[^>]*aria-label="${label}"[^>]*>`).exec(markup);
  if (!tag) throw new Error(`missing ${label}`);
  return /class="([^"]*)"/.exec(tag[0])?.[1] ?? "";
}

describe("OpportunitiesView en el teléfono", () => {
  it("sin selección inicial muestra la cola y oculta el detalle", () => {
    const html = render();
    expect(classOf(html, "Prospecto y cola")).not.toContain("max-md:hidden");
    expect(html).toMatch(/<div[^>]*max-md:hidden[^>]*>.*Volver/);
  });

  it("con ?op= abre el detalle con Volver, el Showroom y los cuatro scores", () => {
    const html = render({ initialSelectedId: withDemand.id });
    expect(classOf(html, "Prospecto y cola")).toContain("max-md:hidden");
    expect(html).toContain(">Volver</button>");
    expect(html).toContain('href="/stock/catalog?q=Toyota+Hilux"');
    expect(html).toContain("Showroom");
    expect(html).toMatch(
      /<dl aria-label="Scores"[^>]*md:hidden[^>]*>.*Porandú.*Intent.*Vehicle Fit.*Deal/,
    );
  });

  it("abierta desde la tabla, Volver regresa a la tabla", () => {
    const html = render({
      initialSelectedId: withDemand.id,
      returnHref: "/opportunities/table",
    });
    expect(html).toMatch(
      /<a[^>]*href="\/opportunities\/table"[^>]*>.*Volver a la tabla<\/a>/,
    );
    expect(html).not.toContain(">Volver</button>");
  });

  it("sin vehículo cargado, el Showroom abre el catálogo completo", () => {
    const html = render({
      initialSelectedId: second!.id,
      opportunities: [
        withDemand,
        { ...second!, demand: demandSummary(resolveDemand([])) },
      ],
    });
    expect(html).toContain('href="/stock/catalog"');
    expect(html).toContain("Vehículo sin definir");
  });

  it("sin oportunidades no hay detalle ni barra de scores, pero sí salida", () => {
    const html = render({ opportunities: [] });
    expect(html).not.toContain('aria-label="Scores"');
    expect(html).toContain("Todavía no hay oportunidades");
    expect(html).toContain(">Volver</button>");
  });
});
