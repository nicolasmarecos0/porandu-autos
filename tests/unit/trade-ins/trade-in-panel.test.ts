import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { TradeInPanel } from "@/components/trade-ins/trade-in-panel";
import type { Stage } from "@/domains/opportunities/stages";
import {
  tradeInPanelData,
  type TradeInRow,
} from "@/domains/opportunities/trade-in-presentation";
import type { TradeInStatus } from "@/domains/opportunities/trade-ins";

/*
 * Panel "Vehículo en parte de pago / Toma" (Hito 20, DEC-052 §4)
 * renderizado en el servidor sin DOM: el estado vacío, el recorrido, la
 * tasación según el rol (la sección financiera es del admin), las acciones
 * de cada estado y la nota del ingreso al stock. Las Server Actions no se
 * llaman: se prueban en actions.test.ts y contra la base en
 * tests/db/trade-ins.test.ts.
 */

vi.mock("@/lib/trade-ins/actions", () => ({
  registerTradeIn: vi.fn(),
  appraiseTradeIn: vi.fn(),
  changeTradeInStatus: vi.fn(),
}));

const VIEWER = "00000000-0000-4000-8000-00000000000a";
const OPPORTUNITY = "10000000-0000-4000-8000-000000000101";

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
    createdBy: VIEWER,
    createdAt: new Date("2026-11-09T12:12:00Z"),
    appraisedBy: appraised ? VIEWER : null,
    appraisedAt: appraised ? new Date("2026-11-09T13:30:00Z") : null,
    convertedVehicleId: null,
    updatedAt: new Date("2026-11-09T14:00:00Z"),
    ...overrides,
  };
}

function render(
  rows: readonly TradeInRow[],
  options: { admin?: boolean; stage?: Stage } = {},
): string {
  const data = tradeInPanelData(rows, {
    viewerUserId: VIEWER,
    viewerIsAdmin: options.admin ?? false,
    opportunityStage: options.stage ?? "negotiating",
    tradeInIntent: null,
  });
  return renderToStaticMarkup(
    createElement(TradeInPanel, { opportunityId: OPPORTUNITY, data }),
  );
}

function buttons(html: string): string[] {
  return [...html.matchAll(/<button[^>]*>([\s\S]*?)<\/button>/g)].map((match) =>
    match[1]!.replace(/<[^>]+>/g, "").trim(),
  );
}

/** El texto visible, sin etiquetas. */
function text(html: string): string {
  return html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
}

describe("TradeInPanel", () => {
  it("se llama como lo pidió el fundador y sin toma ofrece registrar el usado", () => {
    const html = render([]);
    expect(text(html)).toContain("Vehículo en parte de pago / Toma");
    expect(text(html)).toContain("Sin vehículo en parte de pago");
    expect(buttons(html)).toEqual(["Registrar usado"]);
    // El drawer y la confirmación no se dibujan cerrados.
    expect(html).not.toContain('role="dialog"');
  });

  it("en el teléfono: el título entero, etiquetas cortas e importes que no se parten", () => {
    const html = render([row("appraised")], { admin: true });
    // El sufijo y el chip del encabezado se muestran desde sm: en 390 px el
    // título va entero y el estado va en la tarjeta, junto al usado.
    expect(html).toMatch(
      /Vehículo en parte de pago<span class="hidden text-text-muted sm:inline"> \/ Toma<\/span>/,
    );
    expect(html).toMatch(/<span class="ml-auto hidden sm:inline-flex">/);
    expect(html).toMatch(/<span class="sm:hidden"><span[^>]*>.*?Tasado/);
    expect(html).toMatch(/<span class="sm:hidden">Cargado<\/span>/);
    // Cada importe va en una sola línea.
    const amounts = [...html.matchAll(/<dd class="([^"]+)">([^<]+)<\/dd>/g)];
    expect(amounts.map((match) => match[2])).toEqual([
      "USD 8.000",
      "USD 800",
      "USD 8.800",
    ]);
    for (const [, classes] of amounts)
      expect(classes).toContain("whitespace-nowrap");
  });

  it("para el seller, el valor de toma va solo, sin la línea del total", () => {
    const html = render([row("appraised")]);
    const rows = [
      ...html.matchAll(/<div class="([^"]*justify-between[^"]*)"><dt/g),
    ];
    expect(rows).toHaveLength(1);
    expect(rows[0]![1]).not.toContain("border-t");
  });

  it("cerrada, no ofrece registrar", () => {
    const html = render([], { stage: "lost" });
    expect(buttons(html)).toEqual([]);
    expect(text(html)).toContain(
      "La oportunidad está cerrada: ya no se registran ni se deciden tomas.",
    );
  });

  it("pendiente: el recorrido en Registrado, la chapa y la nota según el rol", () => {
    const seller = render([row("pending")]);
    expect(seller).toContain('aria-current="step"');
    expect(text(seller)).toMatch(/Registrado \(paso actual\)/);
    expect(text(seller)).toContain("Pendiente de tasación");
    expect(text(seller)).toContain("ABC 123");
    expect(text(seller)).toContain("98.000 km");
    expect(text(seller)).toContain("la carga un admin (tasador o gerente)");
    expect(buttons(seller)).toEqual(["Descartar toma"]);

    const admin = render([row("pending")], { admin: true });
    expect(buttons(admin)).toEqual(["Tasar", "Descartar toma"]);
  });

  it("tasado para un seller: el valor de toma sí, el detalle financiero no", () => {
    const html = render([row("appraised")]);
    const visible = text(html);
    expect(visible).toContain("Valor de toma");
    expect(visible).toContain("USD 8.000");
    expect(visible).toContain(
      "El costo de reacondicionamiento y el costo total de ingreso los ve el admin",
    );
    // Ni el costo de reacondicionamiento ni el total llegan al HTML.
    expect(visible).not.toContain("USD 800 ");
    expect(visible).not.toContain("USD 8.800");
    expect(buttons(html)).toEqual(["Cliente aprobó", "Cliente rechazó"]);
  });

  it("tasado para un admin: la sección financiera completa y retasar", () => {
    const html = render([row("appraised")], { admin: true });
    const visible = text(html);
    expect(visible).toContain("Costo de reacondicionamiento");
    expect(visible).toContain("USD 800");
    expect(visible).toContain("Costo total de ingreso");
    expect(visible).toContain("USD 8.800");
    expect(visible).toContain("Tasó: Vos");
    expect(buttons(html)).toEqual([
      "Cliente aprobó",
      "Cliente rechazó",
      "Retasar",
    ]);
  });

  it("aprobado por el cliente: avisa que entra al stock al ganar y deja desistir", () => {
    const html = render([row("accepted")]);
    expect(text(html)).toContain("Aprobado por el cliente");
    expect(text(html)).toContain(
      "Al marcar la oportunidad como ganada, ingresa al stock como unidad En preparación.",
    );
    expect(buttons(html)).toEqual(["Cliente desistió"]);
  });

  it("convertida con el cierre Ganada: En stock, con el enlace al Inventario y sin acciones", () => {
    const html = render(
      [
        row("accepted", {
          convertedVehicleId: "20000000-0000-4000-8000-000000000009",
        }),
      ],
      { stage: "won", admin: true },
    );
    expect(text(html)).toMatch(/En stock \(paso actual\)/);
    expect(text(html)).toContain(
      "Ingresó al stock como unidad En preparación con el cierre de la venta.",
    );
    expect(html).toContain('href="/stock"');
    expect(buttons(html)).toEqual([]);
  });

  it("las rechazadas quedan como historial y se puede registrar otra", () => {
    const html = render([
      row("rejected", { id: "40000000-0000-4000-8000-000000000002" }),
    ]);
    expect(text(html)).toContain("Tomas anteriores (1)");
    expect(text(html)).toContain("Valor de toma USD 8.000");
    expect(text(html)).toContain("La última toma se rechazó");
    expect(buttons(html)).toEqual(["Registrar usado"]);
  });
});
