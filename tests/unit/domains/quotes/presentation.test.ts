import { describe, expect, it } from "vitest";

import {
  ADMIN_APPROVAL_HINT,
  quoteCardView,
  quoteCreateHint,
  quoteNumberLabel,
  quotesPanelData,
  type QuotableVehicleRow,
  type QuoteRow,
} from "@/domains/quotes/presentation";

/*
 * Presentación de las cotizaciones (Hito 10, DEC-042 §9): lo que muestra el
 * panel de /opportunities/[id] y lo que recibe el drawer de alta.
 */

const VIEWER = "00000000-0000-4000-8000-00000000000a";
const OTHER = "00000000-0000-4000-8000-00000000000b";
const TODAY = "2026-11-01";

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
    notes: null,
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

const context = {
  viewerUserId: VIEWER,
  viewerIsAdmin: false,
  opportunityStage: "negotiating" as const,
  today: TODAY,
};

describe("quoteCardView", () => {
  it("número, unidad, desglose, validez, autor y acciones del que mira", () => {
    expect(quoteCardView(row(), context)).toMatchObject({
      numberLabel: "N.º 0007",
      displayStatus: "draft",
      displayLabel: "Borrador",
      vehicleLabel: "Toyota Hilux 2024",
      listPriceLabel: "USD 49.900",
      discount: {
        label: "7,5 %",
        amountLabel: "− USD 3.742,50",
        effectiveLabel: "7,5 %",
      },
      totalLabel: "USD 46.157,50",
      total: { amount: "46157.50", currency: "USD" },
      validUntilLabel: "8 nov 2026",
      transitions: ["approved", "withdrawn"],
      requiresAdmin: false,
      approvalHint: null,
      approvedLabel: null,
    });
    expect(quoteCardView(row(), context).createdLabel).toMatch(/^Vos · /);
  });

  it("un seller no ve aprobar un descuento sobre el 10 %; el aviso lo explica", () => {
    const big = row({ discountValue: "12.00", totalPrice: "43912.00" });
    expect(quoteCardView(big, context)).toMatchObject({
      transitions: ["withdrawn"],
      requiresAdmin: true,
      approvalHint: ADMIN_APPROVAL_HINT,
    });
    expect(
      quoteCardView(big, { ...context, viewerIsAdmin: true }),
    ).toMatchObject({
      transitions: ["approved", "withdrawn"],
      approvalHint: null,
    });
  });

  it("una abierta vencida se ve Vencida y solo se anula", () => {
    const view = quoteCardView(
      row({ status: "approved", validUntil: "2026-10-31" }),
      context,
    );
    expect(view).toMatchObject({
      displayStatus: "expired",
      displayLabel: "Vencida",
      transitions: ["withdrawn"],
    });
  });

  it("sin descuento y aprobada por otro miembro", () => {
    const view = quoteCardView(
      row({
        status: "sent",
        discountKind: "none",
        discountValue: null,
        totalPrice: "49900.00",
        approvedBy: OTHER,
        approvedAt: new Date("2026-11-01T14:15:00Z"),
      }),
      context,
    );
    expect(view.discount).toBeNull();
    expect(view.approvedLabel).toMatch(/^Aprobó: Otro miembro · /);
    expect(view.transitions).toEqual(["accepted", "rejected", "withdrawn"]);
  });
});

describe("quotesPanelData", () => {
  const vehicles: QuotableVehicleRow[] = [
    {
      id: "20000000-0000-4000-8000-000000000001",
      brand: "Toyota",
      model: "Hilux",
      year: 2024,
      price: "49900.00",
      currency: "USD",
    },
  ];

  it("ordena por número, propone la unidad vinculada y expone el total aceptado", () => {
    const data = quotesPanelData(
      [
        row({ number: 3, id: "a" }),
        row({
          number: 5,
          id: "b",
          status: "accepted",
          approvedBy: VIEWER,
          approvedAt: new Date(),
          sentAt: new Date(),
          decidedAt: new Date(),
        }),
      ],
      vehicles,
      { ...context, linkedVehicleId: vehicles[0]!.id },
    );
    expect(data.quotes.map((quote) => quote.number)).toEqual([5, 3]);
    expect(data.suggestedVehicleId).toBe(vehicles[0]!.id);
    expect(data.acceptedTotal).toEqual({ amount: "46157.50", currency: "USD" });
    expect(data.vehicleOptions).toEqual([
      {
        id: vehicles[0]!.id,
        label: "Toyota Hilux 2024",
        listPrice: { amount: "49900.00", currency: "USD" },
        listPriceLabel: "USD 49.900",
      },
    ]);
    expect(data.canCreate).toBe(true);
  });

  it("una unidad vinculada que no se puede cotizar no se propone", () => {
    const data = quotesPanelData([], vehicles, {
      ...context,
      linkedVehicleId: "20000000-0000-4000-8000-000000000999",
    });
    expect(data.suggestedVehicleId).toBeNull();
    expect(data.acceptedTotal).toBeNull();
  });

  it("solo se cotiza en calificación o negociación", () => {
    expect(quoteCreateHint("new")).toMatch(/En calificación/);
    expect(quoteCreateHint("won")).toMatch(/cerrada/);
    expect(quoteCreateHint("qualifying")).toBeNull();
    expect(
      quotesPanelData([], vehicles, {
        ...context,
        opportunityStage: "lost",
        linkedVehicleId: null,
      }).canCreate,
    ).toBe(false);
  });

  it("el número lleva cuatro dígitos", () => {
    expect(quoteNumberLabel(1)).toBe("N.º 0001");
    expect(quoteNumberLabel(12345)).toBe("N.º 12345");
  });
});
