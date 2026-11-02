import { describe, expect, it } from "vitest";

import { parseAmount } from "@/domains/money";
import {
  buildQuoteDocument,
  formatLongCalendarDate,
  QUOTE_DOCUMENT_LABELS,
  quoteDocumentFileName,
  type QuoteDocumentSource,
} from "@/domains/quotes/document";
import { quoteTotal, toCents } from "@/domains/quotes/pricing";

/*
 * Contenido del presupuesto (Hito 14, DEC-046 §3): lo que comparten la
 * vista previa HTML y el PDF. Puro, sin reloj ni base.
 */

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
    notes: "Incluye transferencia y primer service.\n\nEntrega en 15 días.",
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

describe("buildQuoteDocument()", () => {
  it("arma encabezado, cliente, unidad, desglose, condiciones, términos y pie", () => {
    const doc = buildQuoteDocument(source());

    expect(doc.title).toBe("Presupuesto N.º 0007");
    expect(doc.numberLabel).toBe("N.º 0007");
    expect(doc.fileName).toBe("presupuesto-0007-ramon-benitez.pdf");
    expect(doc.issuer).toEqual({ name: "Automotores Lambaré", monogram: "AL" });
    expect(doc.issuedOn).toBe("2026-11-01");
    expect(doc.issuedLabel).toBe("1 de noviembre de 2026");
    expect(doc.validUntil).toBe("2026-11-08");
    expect(doc.validUntilLabel).toBe("8 de noviembre de 2026");
    expect(doc.customer).toEqual({
      name: "Ramón Benítez",
      fields: [{ label: "Ciudad", value: "Asunción" }],
    });
    expect(doc.vehicle).toEqual({
      name: "Toyota Hilux",
      fields: [
        { label: "Versión", value: "SRV 2.8 4x4 AT" },
        { label: "Año", value: "2024" },
        { label: "Kilometraje", value: "32.000 km" },
      ],
    });
    expect(doc.pricing).toEqual({
      currency: "USD",
      lines: [
        { label: "Precio de lista", value: "USD 49.900", tone: "default" },
        {
          label: "Descuento (7,5 %)",
          value: "− USD 3.742,50",
          tone: "discount",
        },
      ],
      total: "USD 46.157,50",
    });
    // Un renglón por condición; las líneas en blanco no cuentan.
    expect(doc.conditions).toEqual([
      "Incluye transferencia y primer service.",
      "Entrega en 15 días.",
    ]);
    expect(doc.terms).toEqual([
      "Precios y condiciones válidos hasta el 8 de noviembre de 2026 inclusive.",
      "Importes expresados en dólares estadounidenses (USD).",
      "Esta cotización no reserva la unidad: queda sujeta a disponibilidad al momento de su aceptación.",
    ]);
    expect(doc.footer).toBe("Automotores Lambaré · Presupuesto N.º 0007");
    expect(doc.issuedAt).toEqual(new Date("2026-11-01T13:02:00Z"));
  });

  it("la fecha de emisión es el día de Asunción del alta, no el de UTC", () => {
    // 02:30 UTC del 2 de noviembre son las 23:30 del 1 en Asunción (UTC-3).
    const doc = buildQuoteDocument(
      source({ createdAt: new Date("2026-11-02T02:30:00Z") }),
    );
    expect(doc.issuedOn).toBe("2026-11-01");
    expect(doc.issuedLabel).toBe("1 de noviembre de 2026");
  });

  it("un monto fijo en guaraníes: sin porcentaje en el rótulo y moneda en los términos", () => {
    const doc = buildQuoteDocument(
      source({
        currency: "PYG",
        listPrice: "185000000.00",
        discountKind: "amount",
        discountValue: "5000000.00",
        totalPrice: "180000000.00",
      }),
    );
    expect(doc.pricing.lines).toEqual([
      { label: "Precio de lista", value: "Gs. 185.000.000", tone: "default" },
      { label: "Descuento", value: "− Gs. 5.000.000", tone: "discount" },
    ]);
    expect(doc.pricing.total).toBe("Gs. 180.000.000");
    expect(doc.terms[1]).toBe("Importes expresados en guaraníes (Gs.).");
  });

  it("sin descuento: solo el precio de lista y el total", () => {
    const doc = buildQuoteDocument(
      source({
        discountKind: "none",
        discountValue: null,
        totalPrice: "49900.00",
      }),
    );
    expect(doc.pricing.lines).toEqual([
      { label: "Precio de lista", value: "USD 49.900", tone: "default" },
    ]);
    expect(doc.pricing.total).toBe("USD 49.900");
  });

  it("el desglose cierra: lista − descuento = total guardado", () => {
    const cases: Partial<QuoteDocumentSource>[] = [
      {
        listPrice: "32990.50",
        discountKind: "percent",
        discountValue: "7.50",
        totalPrice: "30516.21",
      },
      {
        currency: "PYG",
        listPrice: "123456789.00",
        discountKind: "percent",
        discountValue: "12.35",
        totalPrice: quoteTotal(
          { amount: "123456789.00", currency: "PYG" },
          { kind: "percent", value: "12.35" },
        ).amount,
      },
    ];
    for (const overrides of cases) {
      const row = source(overrides);
      const doc = buildQuoteDocument(row);
      // "− USD 2.474,29" → "2474.29": el importe tal como lo lee el cliente.
      const off = parseAmount(
        doc.pricing.lines[1]!.value.replace(/^− (USD|Gs\.) /, ""),
      );
      expect(off).not.toBeNull();
      expect(toCents(row.listPrice) - toCents(off!)).toBe(
        toCents(row.totalPrice),
      );
    }
  });

  it("no imprime lo que no se sabe: ni 'Sin dato', ni ciudad, versión o kilometraje vacíos", () => {
    const doc = buildQuoteDocument(
      source({
        customerCity: "   ",
        vehicleVersion: null,
        vehicleKm: null,
        notes: null,
      }),
    );
    expect(doc.customer.fields).toEqual([]);
    expect(doc.vehicle.fields).toEqual([{ label: "Año", value: "2024" }]);
    expect(doc.conditions).toEqual([]);
    expect(JSON.stringify(doc)).not.toContain("Sin dato");
  });

  it("un 0 km es un dato y se imprime", () => {
    const doc = buildQuoteDocument(source({ vehicleKm: 0 }));
    expect(doc.vehicle.fields).toContainEqual({
      label: QUOTE_DOCUMENT_LABELS.km,
      value: "0 km",
    });
  });

  it("nunca incluye el teléfono del cliente ni ids", () => {
    const text = JSON.stringify(buildQuoteDocument(source()));
    expect(text).not.toMatch(/\+595|0981|[0-9a-f]{8}-[0-9a-f]{4}-/);
  });
});

describe("quoteDocumentFileName()", () => {
  it("ASCII en minúsculas, sin tildes ni símbolos, con el número de cuatro cifras", () => {
    expect(quoteDocumentFileName(7, "María José Rolón")).toBe(
      "presupuesto-0007-maria-jose-rolon.pdf",
    );
    expect(quoteDocumentFileName(12345, "  Ñandutí S.A. ")).toBe(
      "presupuesto-12345-nanduti-s-a.pdf",
    );
  });

  it("sin nombre aprovechable, solo el número", () => {
    expect(quoteDocumentFileName(3, "🚗🚗")).toBe("presupuesto-0003.pdf");
    expect(quoteDocumentFileName(3, "")).toBe("presupuesto-0003.pdf");
  });

  it("acota el nombre del cliente y no deja guiones al borde", () => {
    const name = quoteDocumentFileName(1, `${"Ana ".repeat(30)}Pérez`);
    expect(name).toMatch(/^presupuesto-0001-[a-z0-9-]+\.pdf$/);
    expect(name.length).toBeLessThanOrEqual(
      "presupuesto-0001-".length + 40 + ".pdf".length,
    );
    expect(name).not.toMatch(/--|-\.pdf$/);
  });
});

describe("formatLongCalendarDate()", () => {
  it("día y mes en letras, en es-PY", () => {
    expect(formatLongCalendarDate("2026-01-01")).toBe("1 de enero de 2026");
    expect(formatLongCalendarDate("2026-12-31")).toBe(
      "31 de diciembre de 2026",
    );
  });

  it("una fecha mal formada falla en vez de inventar", () => {
    expect(() => formatLongCalendarDate("2026/11/08")).toThrow();
  });
});
