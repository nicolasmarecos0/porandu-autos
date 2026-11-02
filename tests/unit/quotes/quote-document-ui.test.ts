import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { QuoteDocumentSheet } from "@/components/quotes/quote-document-sheet";
import { QuoteDocumentView } from "@/components/quotes/quote-document-view";
import { QuotesPanel } from "@/components/quotes/quotes-panel";
import {
  buildQuoteDocument,
  type QuoteDocumentSource,
} from "@/domains/quotes/document";
import {
  quoteCardView,
  quotesPanelData,
  type QuoteRow,
} from "@/domains/quotes/presentation";

/*
 * Presupuesto en la UI (Hito 14, DEC-046 §6), renderizado en el servidor
 * sin DOM: la hoja de vista previa (el mismo contenido que el PDF), la
 * página maestro/detalle y el pie de cada tarjeta del panel. Ni la Server
 * Action ni la descarga se ejecutan: se prueban en actions.test.ts y
 * pdf-download.test.ts.
 */

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
}));
vi.mock("@/lib/quotes/actions", () => ({
  createQuote: vi.fn(),
  changeQuoteStatus: vi.fn(),
}));

const VIEWER = "00000000-0000-4000-8000-00000000000a";
const OPPORTUNITY = "10000000-0000-4000-8000-000000000101";
const QUOTE = "30000000-0000-4000-8000-000000000007";
const OTHER_QUOTE = "30000000-0000-4000-8000-000000000005";
const TODAY = "2026-11-01";

const APPROVED = {
  status: "approved",
  approvedBy: VIEWER,
  approvedAt: new Date("2026-11-01T14:15:00Z"),
} as const;

function row(overrides: Partial<QuoteRow> = {}): QuoteRow {
  return {
    id: QUOTE,
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

function documentOf(overrides: Partial<QuoteDocumentSource> = {}) {
  return buildQuoteDocument({
    number: 7,
    status: "approved",
    currency: "USD",
    listPrice: "49900.00",
    discountKind: "percent",
    discountValue: "7.50",
    totalPrice: "46157.50",
    validUntil: "2026-11-08",
    notes: "Incluye transferencia.",
    createdAt: new Date("2026-11-01T13:02:00Z"),
    opportunityStage: "negotiating",
    organizationName: "Automotores Lambaré",
    customerName: "Ramón Benítez",
    customerCity: "Asunción",
    vehicleBrand: "Toyota",
    vehicleModel: "Hilux",
    vehicleVersion: "SRV 2.8 4x4 AT",
    vehicleYear: 2024,
    vehicleKm: 32000,
    ...overrides,
  });
}

const context = {
  viewerUserId: VIEWER,
  viewerIsAdmin: false,
  opportunityStage: "negotiating" as const,
  linkedVehicleId: null,
  today: TODAY,
};

function view(quoteRow: QuoteRow, others: readonly QuoteRow[] = []) {
  const quote = quoteCardView(quoteRow, context);
  return renderToStaticMarkup(
    createElement(QuoteDocumentView, {
      opportunityId: OPPORTUNITY,
      contactName: "Ramón Benítez",
      quote,
      quotes: quotesPanelData([quoteRow, ...others], [], context).quotes,
      document: documentOf({ status: quoteRow.status }),
    }),
  );
}

function panel(rows: readonly QuoteRow[]) {
  return renderToStaticMarkup(
    createElement(QuotesPanel, {
      opportunityId: OPPORTUNITY,
      data: quotesPanelData(rows, [], context),
    }),
  );
}

describe("QuoteDocumentSheet", () => {
  it("muestra el mismo contenido que el PDF", () => {
    const html = renderToStaticMarkup(
      createElement(QuoteDocumentSheet, {
        document: documentOf(),
        exportability: { exportable: true },
      }),
    );
    for (const expected of [
      "AL",
      "Automotores Lambaré",
      "Presupuesto",
      "N.º 0007",
      "Fecha de emisión",
      "1 de noviembre de 2026",
      "8 de noviembre de 2026",
      "Ramón Benítez",
      "Asunción",
      "Toyota Hilux",
      "SRV 2.8 4x4 AT",
      "32.000 km",
      "USD 49.900",
      "Descuento (7,5 %)",
      "− USD 3.742,50",
      "USD 46.157,50",
      "Incluye transferencia.",
      "Importes expresados en dólares estadounidenses (USD).",
      "Automotores Lambaré · Presupuesto N.º 0007",
    ]) {
      expect(html).toContain(expected);
    }
    expect(html).not.toContain("Vista previa ·");
    // Fechas legibles por máquina, tabla con encabezados.
    expect(html).toContain('dateTime="2026-11-08"');
    expect(html).toContain('scope="col"');
  });

  it("una que no se entrega lleva el sello de vista previa", () => {
    const html = renderToStaticMarkup(
      createElement(QuoteDocumentSheet, {
        document: documentOf({ status: "draft" }),
        exportability: { exportable: false, reason: "draft" },
      }),
    );
    expect(html).toContain(
      "Vista previa · Borrador: no se entrega al cliente.",
    );
  });
});

describe("QuoteDocumentView", () => {
  it("aprobada: descargar el PDF es la acción principal y marcar enviada, la siguiente", () => {
    const html = view(row(APPROVED));
    expect(html).toContain("<h1");
    expect(html).toContain("Presupuesto N.º 0007");
    expect(html).toContain("Descargar PDF");
    expect(html).toContain("Marcar como enviada");
    expect(html).toContain("Descargá el PDF para entregarlo");
    expect(html).toContain(`href="/opportunities/${OPPORTUNITY}"`);
    expect(html).toContain("Volver a la oportunidad");
  });

  it("borrador: se aprueba desde la vista previa y no ofrece el PDF", () => {
    const html = view(row());
    expect(html).toContain("Aprobar cotización");
    expect(html).not.toContain("Descargar PDF");
    expect(html).toContain("Aprobala para descargar el PDF");
    expect(html).toContain("Vista previa · Borrador");
  });

  it("anulada: ni acciones ni PDF, y dice por qué", () => {
    const html = view(row({ status: "withdrawn", decidedAt: new Date() }));
    expect(html).not.toContain("Descargar PDF");
    expect(html).not.toContain("Más acciones");
    expect(html).toContain("Está anulada: el PDF ya no se descarga.");
  });

  it("el maestro lista las cotizaciones de la oportunidad y marca la actual", () => {
    const html = view(row(APPROVED), [
      row({
        id: OTHER_QUOTE,
        number: 5,
        status: "withdrawn",
        decidedAt: new Date(),
      }),
    ]);
    expect(html).toContain('aria-label="Cotizaciones de Ramón Benítez"');
    expect(html).toContain("2 cotizaciones");
    const current = [
      ...html.matchAll(/<a [^>]*aria-current="page"[^>]*>/g),
    ].map(([tag]) => tag);
    expect(current).toHaveLength(1);
    expect(current[0]).toContain(
      `href="/opportunities/${OPPORTUNITY}/quotes/${QUOTE}"`,
    );
    expect(html).toContain(
      `href="/opportunities/${OPPORTUNITY}/quotes/${OTHER_QUOTE}"`,
    );
    expect(html).toContain("N.º 0005");
  });
});

describe("tarjeta del panel: presupuesto", () => {
  it("toda cotización abre su vista previa", () => {
    const html = panel([row()]);
    expect(html).toContain("Ver presupuesto");
    expect(html).toContain(
      `href="/opportunities/${OPPORTUNITY}/quotes/${QUOTE}"`,
    );
  });

  it("un borrador explica que falta aprobarla; una aprobada ofrece el PDF", () => {
    const draft = panel([row()]);
    expect(draft).toContain("Aprobala para descargar el PDF");
    expect(draft).not.toContain("Descargar PDF");

    const approved = panel([row(APPROVED)]);
    expect(approved).toContain("Descargar PDF");
    // El nombre accesible empieza con el texto visible (WCAG 2.5.3).
    expect(approved).toMatch(
      /Descargar PDF<span class="sr-only"> del presupuesto (?:<!-- -->)?N\.º 0007<\/span>/,
    );
  });

  it("vencida o anulada: sin PDF y sin aviso de aprobación", () => {
    for (const html of [
      panel([row({ ...APPROVED, validUntil: "2026-10-31" })]),
      panel([row({ status: "withdrawn", decidedAt: new Date() })]),
    ]) {
      expect(html).toContain("Ver presupuesto");
      expect(html).not.toContain("Descargar PDF");
      expect(html).not.toContain("Aprobala para descargar");
    }
  });
});
