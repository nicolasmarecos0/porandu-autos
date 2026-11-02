import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { PDFDocument } from "pdf-lib";
import { describe, expect, it, vi } from "vitest";

import {
  buildQuoteDocument,
  type QuoteDocumentSource,
} from "@/domains/quotes/document";
import {
  PDF_COLOR_TOKENS,
  PDF_PAGE_SIZE,
  PDF_PRODUCER,
  renderQuotePdf,
} from "@/lib/quotes/pdf";

import { pdfText, pdfTextByPage } from "../support/pdf-text";

/*
 * Generador del presupuesto en PDF (Hito 14, DEC-046 §4), sin base ni red:
 * un PDF válido de una página A4, con el texto del documento, metadatos
 * deterministas, colores de los tokens de DEC-013 y sin fallar por
 * caracteres que Helvetica no tiene.
 */

vi.mock("server-only", () => ({}));

function source(
  overrides: Partial<QuoteDocumentSource> = {},
): QuoteDocumentSource {
  return {
    number: 7,
    status: "approved",
    currency: "USD",
    listPrice: "49900.00",
    discountKind: "percent",
    discountValue: "7.50",
    totalPrice: "46157.50",
    validUntil: "2026-11-08",
    notes: "Incluye transferencia y primer service.",
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
  };
}

async function render(overrides: Partial<QuoteDocumentSource> = {}) {
  return renderQuotePdf(buildQuoteDocument(source(overrides)));
}

describe("renderQuotePdf()", () => {
  it("es un PDF de una página A4, liviano", async () => {
    const bytes = await render();
    expect(new TextDecoder().decode(bytes.slice(0, 5))).toBe("%PDF-");
    expect(bytes.byteLength).toBeLessThan(20_000);
    const doc = await PDFDocument.load(bytes);
    expect(doc.getPageCount()).toBe(1);
    const { width, height } = doc.getPage(0).getSize();
    expect(width).toBeCloseTo(PDF_PAGE_SIZE.width, 1);
    expect(height).toBeCloseTo(PDF_PAGE_SIZE.height, 1);
  });

  it("dice lo mismo que el documento: emisor, número, fechas, cliente, unidad, precio y términos", async () => {
    const text = await pdfText(await render());
    for (const expected of [
      "AL",
      "Automotores Lambaré",
      "PRESUPUESTO",
      "N.º 0007",
      "Fecha de emisión",
      "1 de noviembre de 2026",
      "Válido hasta",
      "8 de noviembre de 2026",
      "CLIENTE",
      "Ramón Benítez",
      "Asunción",
      "UNIDAD COTIZADA",
      "Toyota Hilux",
      "SRV 2.8 4x4 AT",
      "32.000 km",
      "DETALLE DE PRECIO",
      "Precio de lista",
      "USD 49.900",
      "Descuento (7,5 %)",
      // El signo menos tipográfico se escribe como raya corta (WinAnsi).
      "– USD 3.742,50",
      "Total",
      "USD 46.157,50",
      "CONDICIONES PARTICULARES",
      "Incluye transferencia y primer service.",
      "TÉRMINOS",
      "Importes expresados en dólares estadounidenses (USD).",
      "Automotores Lambaré · Presupuesto N.º 0007",
      "Página 1 de 1",
    ]) {
      expect(text).toContain(expected);
    }
  });

  it("sin condiciones no imprime esa sección", async () => {
    const text = await pdfText(await render({ notes: null }));
    expect(text).not.toContain("CONDICIONES PARTICULARES");
    expect(text).toContain("TÉRMINOS");
  });

  it("metadatos del documento con la fecha del alta, nunca la del servidor", async () => {
    const doc = await PDFDocument.load(await render(), {
      updateMetadata: false,
    });
    expect(doc.getTitle()).toBe("Presupuesto N.º 0007");
    expect(doc.getAuthor()).toBe("Automotores Lambaré");
    expect(doc.getSubject()).toBe("Presupuesto N.º 0007 · Toyota Hilux");
    expect(doc.getCreator()).toBe(PDF_PRODUCER);
    expect(doc.getProducer()).toBe(PDF_PRODUCER);
    expect(doc.getCreationDate()).toEqual(new Date("2026-11-01T13:02:00Z"));
    expect(doc.getModificationDate()).toEqual(new Date("2026-11-01T13:02:00Z"));
  });

  it("es determinista: el mismo documento da los mismos bytes", async () => {
    // Solo el reloj: pdf-lib cede el turno con setTimeout al guardar.
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      vi.setSystemTime(new Date("2026-11-02T10:00:00Z"));
      const first = await render();
      vi.setSystemTime(new Date("2027-03-15T22:00:00Z"));
      const second = await render();
      expect(Buffer.from(second).equals(Buffer.from(first))).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it("no falla con emojis, guaraní ni caracteres de control, y los omite o los reemplaza", async () => {
    const text = await pdfText(
      await render({
        organizationName: "Concesionaria Avañe'ẽ 🚘",
        customerName: "María 👋 Ñandutí\u0007",
        notes: "Entrega 🔑 en la sucursal de Ỹpacaraí.",
      }),
    );
    expect(text).toContain("Concesionaria Avañe'e");
    expect(text).toContain("María Ñandutí");
    expect(text).toContain("Entrega en la sucursal de Ypacaraí.");
  });

  it("guaraníes: importes con Gs. y la moneda nombrada en los términos", async () => {
    const text = await pdfText(
      await render({
        currency: "PYG",
        listPrice: "185000000.00",
        discountKind: "amount",
        discountValue: "5000000.00",
        totalPrice: "180000000.00",
      }),
    );
    expect(text).toContain("Gs. 185.000.000");
    expect(text).toContain("– Gs. 5.000.000");
    expect(text).toContain("Gs. 180.000.000");
    expect(text).toContain("Importes expresados en guaraníes (Gs.).");
  });

  it("si el contenido no entra, sigue en otra página con el pie numerado", async () => {
    const notes = Array.from(
      { length: 80 },
      (_, index) =>
        `Condición ${index + 1}: un renglón largo de condiciones particulares para llenar la hoja.`,
    ).join("\n");
    const bytes = await render({ notes });
    const pages = await pdfTextByPage(bytes);
    expect(pages.length).toBeGreaterThan(1);
    pages.forEach((lines, index) => {
      expect(lines).toContain(`Página ${index + 1} de ${pages.length}`);
      expect(lines).toContain("Automotores Lambaré · Presupuesto N.º 0007");
    });
    // Nada se pierde: la última condición y los términos están.
    const text = pages.flat().join("\n");
    expect(text).toContain("Condición 80:");
    expect(text).toContain("TÉRMINOS");
  });

  it("nunca imprime el teléfono del cliente", async () => {
    const text = await pdfText(await render());
    expect(text).not.toMatch(/\+595|0981/);
  });
});

describe("colores del PDF", () => {
  it("son los valores de los tokens de components/ui/tokens.css (DEC-013)", () => {
    const css = readFileSync(
      fileURLToPath(
        new URL("../../../components/ui/tokens.css", import.meta.url),
      ),
      "utf8",
    );
    for (const { token, hex } of Object.values(PDF_COLOR_TOKENS)) {
      const match = new RegExp(`${token}:\\s*(#[0-9a-fA-F]{6})\\s*;`).exec(css);
      expect(match?.[1]?.toLowerCase(), token).toBe(hex);
    }
  });
});
