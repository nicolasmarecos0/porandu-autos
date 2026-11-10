import { describe, expect, it } from "vitest";

import type { Stage } from "@/domains/opportunities/stages";
import {
  appraisalOf,
  appraisalValuesOf,
  tradeInCardView,
  tradeInClosureNotice,
  tradeInHint,
  tradeInLabel,
  tradeInPanelData,
  type TradeInRow,
} from "@/domains/opportunities/trade-in-presentation";
import {
  parseTradeInAppraisal,
  type TradeInStatus,
} from "@/domains/opportunities/trade-ins";

/*
 * Presentación del panel "Vehículo en parte de pago / Toma" (Hito 20,
 * DEC-052 §4): qué ve cada rol (la sección financiera es del admin), qué
 * puede pedir, qué dice la nota del ingreso al stock y qué avisa el cierre
 * Ganada.
 */

const VIEWER = "00000000-0000-4000-8000-00000000000a";
const OTHER = "00000000-0000-4000-8000-00000000000c";

function row(
  status: TradeInStatus,
  overrides: Partial<TradeInRow> = {},
): TradeInRow {
  const appraised = status !== "pending";
  return {
    id: "40000000-0000-4000-8000-000000000001",
    status,
    brand: "Toyota",
    model: "Vitz",
    version: "1.3 F",
    year: 2015,
    km: 98000,
    plate: "ABC 123",
    currency: appraised ? "USD" : null,
    estimatedRepairCost: appraised ? "800.00" : null,
    offerPrice: appraised ? "8000.00" : null,
    createdBy: OTHER,
    createdAt: new Date("2026-11-09T12:12:00Z"),
    appraisedBy: appraised ? VIEWER : null,
    appraisedAt: appraised ? new Date("2026-11-09T13:30:00Z") : null,
    convertedVehicleId: null,
    updatedAt: new Date("2026-11-09T14:00:00Z"),
    ...overrides,
  };
}

function view(
  status: TradeInStatus,
  options: {
    admin?: boolean;
    stage?: Stage;
    overrides?: Partial<TradeInRow>;
  } = {},
) {
  return tradeInCardView(row(status, options.overrides), {
    viewerUserId: VIEWER,
    viewerIsAdmin: options.admin ?? false,
    opportunityStage: options.stage ?? "negotiating",
  });
}

describe("la tarjeta de la toma", () => {
  it("el usado con su detalle, km, chapa y quién lo registró", () => {
    expect(view("pending")).toMatchObject({
      statusLabel: "Pendiente de tasación",
      name: "Toyota Vitz",
      detail: "1.3 F · 2015",
      kmLabel: "98.000 km",
      plateLabel: "ABC 123",
      registeredLabel: "Registró: Otro miembro · 9 nov 2026 09:12",
      appraisal: null,
      step: "registered",
      stocked: false,
    });
    expect(
      view("pending", { overrides: { version: null, km: null, plate: null } }),
    ).toMatchObject({ detail: "2015", kmLabel: null, plateLabel: null });
  });

  it("la sección financiera es exclusiva del admin: el seller ve solo el valor de toma", () => {
    expect(view("appraised", { admin: true }).appraisal).toEqual({
      offerPriceLabel: "USD 8.000",
      financial: {
        repairCostLabel: "USD 800",
        intakeCostLabel: "USD 8.800",
      },
      appraisedLabel: "Tasó: Vos · 9 nov 2026 10:30",
    });
    const seller = view("appraised");
    expect(seller.appraisal).toEqual({
      offerPriceLabel: "USD 8.000",
      financial: null,
      appraisedLabel: "Tasó: Vos · 9 nov 2026 10:30",
    });
    // Tampoco llegan los valores para precargar una retasación.
    expect(seller.appraisalValues).toBeNull();
    expect(view("appraised", { admin: true }).appraisalValues).toEqual({
      currency: "USD",
      estimatedRepairCost: "800",
      offerPrice: "8.000",
    });
  });

  it("tasar y retasar solo los ofrece al admin; las decisiones, a cualquier miembro", () => {
    expect(view("pending", { admin: true })).toMatchObject({
      appraise: "appraise",
      decisions: ["discard"],
    });
    expect(view("pending")).toMatchObject({
      appraise: null,
      decisions: ["discard"],
    });
    expect(view("appraised", { admin: true })).toMatchObject({
      appraise: "reappraise",
      decisions: ["accept", "reject"],
    });
    expect(view("accepted", { admin: true })).toMatchObject({
      appraise: null,
      decisions: ["withdraw"],
    });
  });

  it.each(["won", "lost"] as const)(
    "con la oportunidad %s no ofrece nada",
    (stage) => {
      for (const status of ["pending", "appraised", "accepted"] as const) {
        expect(view(status, { admin: true, stage })).toMatchObject({
          appraise: null,
          decisions: [],
        });
      }
    },
  );

  it.each([
    ["pending", "negotiating", false, "info", /la carga un admin/],
    ["pending", "negotiating", true, "info", /Cargá el costo/],
    ["appraised", "negotiating", false, "info", /registrá su respuesta/],
    [
      "accepted",
      "negotiating",
      false,
      "info",
      /ingresa al stock como unidad En preparación/,
    ],
    ["appraised", "won", false, "warning", /sin la aprobación del cliente/],
    ["pending", "won", false, "warning", /sin tasar el usado/],
    ["accepted", "lost", false, "neutral", /no ingresó al stock/],
    ["appraised", "lost", false, "neutral", /sin la respuesta del cliente/],
  ] as const)(
    "nota de %s en %s (admin: %s): %s",
    (status, stage, admin, tone, text) => {
      const note = view(status, { stage, admin }).note;
      expect(note?.tone).toBe(tone);
      expect(note?.text).toMatch(text);
    },
  );

  it("convertida con el cierre Ganada: en stock", () => {
    expect(
      view("accepted", {
        stage: "won",
        overrides: {
          convertedVehicleId: "20000000-0000-4000-8000-000000000009",
        },
      }),
    ).toMatchObject({
      step: "stocked",
      stocked: true,
      note: {
        tone: "success",
        text: "Ingresó al stock como unidad En preparación con el cierre de la venta.",
      },
    });
  });
});

describe("el panel", () => {
  const context = {
    viewerUserId: VIEWER,
    viewerIsAdmin: false,
    opportunityStage: "negotiating" as Stage,
    tradeInIntent: null,
  };

  it("sin tomas: se registra, con la pista de la demanda", () => {
    expect(tradeInPanelData([], context)).toEqual({
      current: null,
      history: [],
      canRegister: true,
      hint: null,
      viewerIsAdmin: false,
      closure: null,
    });
    expect(tradeInPanelData([], { ...context, tradeInIntent: true }).hint).toBe(
      "El cliente dijo que entrega su usado: registralo para tasarlo.",
    );
    expect(
      tradeInPanelData([], { ...context, tradeInIntent: false }).hint,
    ).toMatch(/no entrega usado/);
  });

  it("la vigente arriba, las rechazadas como historial (de la más reciente a la más vieja)", () => {
    const rejectedOld = row("rejected", {
      id: "40000000-0000-4000-8000-000000000002",
      createdAt: new Date("2026-11-01T12:00:00Z"),
      updatedAt: new Date("2026-11-02T12:00:00Z"),
      offerPrice: "6000.00",
    });
    const discarded = row("rejected", {
      id: "40000000-0000-4000-8000-000000000003",
      createdAt: new Date("2026-11-05T12:00:00Z"),
      updatedAt: new Date("2026-11-05T13:00:00Z"),
      currency: null,
      estimatedRepairCost: null,
      offerPrice: null,
      appraisedBy: null,
      appraisedAt: null,
    });
    const current = row("appraised");
    const data = tradeInPanelData([rejectedOld, current, discarded], context);
    expect(data.current?.id).toBe(current.id);
    expect(data.history).toEqual([
      {
        id: discarded.id,
        label: "Toyota Vitz 2015",
        statusLabel: "Rechazado",
        offerPriceLabel: null,
        at: "5 nov 2026 10:00",
      },
      {
        id: rejectedOld.id,
        label: "Toyota Vitz 2015",
        statusLabel: "Rechazado",
        offerPriceLabel: "USD 6.000",
        at: "2 nov 2026 09:00",
      },
    ]);
    // Con una vigente no se registra otra, y no hace falta pista.
    expect(data.canRegister).toBe(false);
    expect(data.hint).toBeNull();
  });

  it("cerrada, no se registra y lo dice", () => {
    const data = tradeInPanelData([], {
      ...context,
      opportunityStage: "won",
    });
    expect(data.canRegister).toBe(false);
    expect(data.hint).toBe(
      "La oportunidad está cerrada: ya no se registran ni se deciden tomas.",
    );
    expect(tradeInHint("lost", true)).toBe(data.hint);
  });

  it("el aviso del cierre Ganada: la aceptada entra al stock; la sin decidir, no", () => {
    expect(tradeInPanelData([row("accepted")], context).closure).toEqual({
      kind: "will_stock",
      name: "Toyota Vitz",
      detail: "1.3 F · 2015",
    });
    expect(tradeInPanelData([row("appraised")], context).closure).toEqual({
      kind: "undecided",
      name: "Toyota Vitz",
      detail: "1.3 F · 2015",
      status: "appraised",
      message:
        "La toma está «Tasado», sin la aprobación del cliente: al confirmar, el usado no ingresa al stock. Si el cliente la aprobó, registralo en «Vehículo en parte de pago» antes de cerrar.",
    });
    expect(tradeInClosureNotice(row("rejected"))).toBeNull();
    expect(
      tradeInClosureNotice(
        row("accepted", {
          convertedVehicleId: "20000000-0000-4000-8000-000000000009",
        }),
      ),
    ).toBeNull();
    expect(tradeInClosureNotice(null)).toBeNull();
  });
});

describe("helpers", () => {
  it("la tasación de una fila y sus valores es-PY ida y vuelta", () => {
    expect(appraisalOf(row("pending"))).toBeNull();
    const appraisal = appraisalOf(
      row("appraised", { offerPrice: "7999.50", estimatedRepairCost: "0.00" }),
    )!;
    const values = appraisalValuesOf(appraisal);
    expect(values).toEqual({
      currency: "USD",
      estimatedRepairCost: "0",
      offerPrice: "7.999,50",
    });
    // Lo que precarga el formulario se vuelve a leer igual.
    expect(parseTradeInAppraisal(values)).toEqual({ ok: true, appraisal });
    expect(tradeInLabel(row("pending"))).toBe("Toyota Vitz 2015");
  });
});
