import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { QuotesPanel } from "@/components/quotes/quotes-panel";
import { quotesPanelData, type QuoteRow } from "@/domains/quotes/presentation";

/*
 * Panel "Cotizaciones" (Hito 10, DEC-042 §9) renderizado en el servidor sin
 * DOM: estados vacíos, la tarjeta con su desglose y sus acciones, y el
 * aviso de aprobación de admin. Las Server Actions no se llaman: se prueban
 * en actions.test.ts y contra la base en tests/db/quote-actions.test.ts.
 */

vi.mock("@/lib/quotes/actions", () => ({
  createQuote: vi.fn(),
  changeQuoteStatus: vi.fn(),
}));

const VIEWER = "00000000-0000-4000-8000-00000000000a";
const OPPORTUNITY = "10000000-0000-4000-8000-000000000101";

function row(overrides: Partial<QuoteRow> = {}): QuoteRow {
  return {
    id: "30000000-0000-4000-8000-000000000001",
    number: 7,
    status: "draft",
    currency: "USD",
    listPrice: "49900.00",
    discountKind: "percent",
    discountValue: "7.50",
    totalPrice: "46157.50",
    validUntil: "2026-11-08",
    notes: "Incluye transferencia.",
    createdBy: VIEWER,
    createdAt: new Date("2026-11-01T13:02:00Z"),
    approvedBy: null,
    approvedAt: null,
    sentAt: null,
    decidedAt: null,
    vehicleId: "20000000-0000-4000-8000-000000000001",
    vehicleBrand: "Toyota",
    vehicleModel: "Hilux",
    vehicleYear: 2024,
    vehicleStatus: "available",
    ...overrides,
  };
}

function render(
  rows: readonly QuoteRow[],
  stage: "new" | "qualifying" | "negotiating" | "won" = "negotiating",
  viewerIsAdmin = false,
): string {
  const data = quotesPanelData(rows, [], {
    viewerUserId: VIEWER,
    viewerIsAdmin,
    opportunityStage: stage,
    linkedVehicleId: null,
    today: "2026-11-01",
  });
  return renderToStaticMarkup(
    createElement(QuotesPanel, { opportunityId: OPPORTUNITY, data }),
  );
}

describe("QuotesPanel", () => {
  it("sin cotizaciones: estado vacío y el botón de alta", () => {
    const html = render([]);
    expect(html).toContain("Todavía no hay cotizaciones");
    expect(html).toContain("Nueva");
    expect(html).toContain("0 cotizaciones");
  });

  it("fuera de calificación o negociación no ofrece crear y dice por qué", () => {
    const html = render([], "new");
    expect(html).not.toContain("Nueva");
    expect(html).toContain("En calificación");
  });

  it("la tarjeta muestra número, estado, desglose, validez, condiciones y la acción siguiente", () => {
    const html = render([row()]);
    expect(html).toContain("N.º 0007");
    expect(html).toContain("Borrador");
    expect(html).toContain("Toyota Hilux 2024");
    expect(html).toContain("USD 49.900");
    expect(html).toContain("− USD 3.742,50");
    expect(html).toContain("USD 46.157,50");
    expect(html).toContain("8 nov 2026");
    expect(html).toContain("Incluye transferencia.");
    expect(html).toContain("Aprobar cotización");
  });

  it("un seller ve el aviso de admin y no el botón de aprobar", () => {
    const big = row({ discountValue: "12.00", totalPrice: "43912.00" });
    const asSeller = render([big]);
    expect(asSeller).toContain("la aprueba un admin");
    expect(asSeller).not.toContain("Aprobar cotización");
    expect(render([big], "negotiating", true)).toContain("Aprobar cotización");
  });

  it("una vencida se ve Vencida; una anulada no ofrece acciones", () => {
    expect(render([row({ validUntil: "2026-10-31" })])).toContain("Vencida");
    const withdrawn = render([
      row({ status: "withdrawn", decidedAt: new Date() }),
    ]);
    expect(withdrawn).toContain("Anulada");
    expect(withdrawn).not.toContain("Más acciones");
  });
});
