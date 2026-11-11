import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { VehicleActions } from "@/components/stock/catalog/vehicle-sheet";
import { StockView } from "@/components/stock/stock-view";
import { lifecycleNoticeOf } from "@/components/stock/use-vehicle-lifecycle";
import type { CatalogVehicle } from "@/domains/vehicles/catalog";
import type { StockVehicle } from "@/domains/vehicles/stock";

/*
 * Ciclo de vida de las unidades en la UI (Hito 19, DEC-051),
 * renderizado en el servidor sin DOM: la acción rápida de cada unidad del
 * Inventario según su estado, la del contexto, la acción discreta de la
 * ficha del catálogo y qué dice cada respuesta de changeVehicleStatus(). La
 * máquina se prueba en tests/unit/domains/vehicles/lifecycle.test.ts, la
 * Server Action en status-change.test.ts y la escritura contra la base en
 * tests/db/vehicle-lifecycle.test.ts.
 */

vi.mock("@/lib/vehicles/actions", () => ({
  changeVehicleStatus: vi.fn(),
  createVehicle: vi.fn(),
}));

const id = (n: number) =>
  `30000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

const unit = (
  n: number,
  status: StockVehicle["status"],
  model: string,
): StockVehicle => ({
  id: id(n),
  brand: "Toyota",
  model,
  version: "SRV 2.8 4x4 AT",
  year: 2025,
  km: 0,
  price: { amount: "49900.00", currency: "USD" },
  status,
});

const PREPARING = unit(1, "inPreparation", "Yaris");
const AVAILABLE = unit(2, "available", "Hilux");
const RESERVED = unit(3, "reserved", "Corolla");
const SOLD = unit(4, "sold", "SW4");

function renderStock(
  vehicles: readonly StockVehicle[],
  canEditPrice = true,
): string {
  return renderToStaticMarkup(
    createElement(StockView, { title: "Stock", vehicles, canEditPrice }),
  );
}

/** Textos de los botones, en orden, sin el marcado interno. */
function buttons(html: string): string[] {
  return [...html.matchAll(/<button[^>]*>([\s\S]*?)<\/button>/g)].map((match) =>
    match[1]!.replace(/<[^>]+>/g, "").trim(),
  );
}

/** El bloque de la fila de una unidad (su <li>). */
function row(html: string, vehicle: StockVehicle): string {
  const start = html.lastIndexOf(
    "<li",
    html.indexOf(`stock-unit-${vehicle.id}`),
  );
  return html.slice(start, html.indexOf("</li>", start));
}

describe("Inventario (/stock): el precio publicado según el rol (Hito 22, DEC-054 §3)", () => {
  const rail = (html: string) =>
    html.slice(html.indexOf('id="stock-unit-context"'));

  it("un admin ve «Editar precio» en el contexto de la unidad", () => {
    const html = rail(renderStock([AVAILABLE]));
    expect(html).toMatch(/<button[^>]*>Editar precio<\/button>/);
    expect(html).not.toContain('aria-disabled="true"');
  });

  it("un seller lo ve bloqueado, con quién lo cambia, y sin el drawer", () => {
    const html = rail(renderStock([AVAILABLE], false));
    expect(html).toMatch(/<button[^>]*aria-disabled="true"[^>]*>/);
    expect(html).toContain("Editar precio");
    expect(html).toContain(
      "Solo un administrador (gerente) cambia el precio publicado.",
    );
    expect(html).not.toMatch(/<button[^>]*>Editar precio<\/button>/);
  });

  it("una vendida no ofrece editar el precio, a ningún rol", () => {
    for (const canEditPrice of [true, false]) {
      expect(rail(renderStock([SOLD], canEditPrice))).not.toContain(
        "Editar precio",
      );
    }
  });
});

describe("Inventario (/stock): una acción rápida por unidad", () => {
  const html = renderStock([PREPARING, AVAILABLE, RESERVED, SOLD]);

  it.each([
    [PREPARING, "Poner en salón", "Poner en salón: Toyota Yaris 2025"],
    [AVAILABLE, "Reservar", "Reservar unidad: Toyota Hilux 2025"],
    [RESERVED, "Liberar", "Liberar reserva: Toyota Corolla 2025"],
  ] as const)(
    "la unidad %#: el botón compacto y su nombre accesible completo",
    (vehicle, label, accessible) => {
      const block = row(html, vehicle);
      expect(buttons(block)).toContain(label);
      expect(block).toContain(`aria-label="${accessible}"`);
    },
  );

  it("una vendida no ofrece acción: la operación está cerrada", () => {
    const block = row(html, SOLD);
    // Solo el botón que la elige.
    expect(buttons(block)).toHaveLength(1);
    expect(block).not.toMatch(/Reservar|Liberar|Poner en salón/);
  });

  it("cada fila es un botón que elige la unidad (no un listbox con botones adentro)", () => {
    expect(html).not.toContain('role="listbox"');
    expect(html).not.toContain('role="option"');
    expect(row(html, AVAILABLE)).toContain('aria-current="true"');
    expect(row(html, PREPARING)).not.toContain('aria-current="true"');
    expect(html).toContain('aria-controls="stock-unit-context"');
  });

  it("el contexto de la unidad elegida ofrece la misma acción, con su nombre completo", () => {
    const rail = html.slice(html.indexOf('id="stock-unit-context"'));
    // La primera en el orden visual: Disponibles va primero.
    expect(rail).toContain("Hilux");
    expect(buttons(rail)).toContain("Reservar unidad");
  });

  it("el contexto de una vendida lo dice, sin botón", () => {
    const only = renderStock([SOLD]);
    const rail = only.slice(only.indexOf('id="stock-unit-context"'));
    expect(rail).toContain(
      "Vendida: la operación está cerrada y no cambia desde Stock.",
    );
    expect(buttons(rail)).toEqual([]);
  });

  it("los estados se nombran en femenino, como la unidad", () => {
    expect(html).toContain("Reservada");
    expect(html).toContain("Vendida");
    expect(html).not.toContain("Reservado");
    expect(html).not.toContain("Vendido<");
  });

  it("mobile-first: una columna en el teléfono; el contexto vive en el rail desde md", () => {
    expect(html).toContain("grid-cols-1");
    expect(html).toContain("md:grid-cols-[minmax(0,1fr)_17rem]");
    expect(html).toMatch(/id="stock-unit-context"[^>]*max-md:hidden/);
  });

  it("el aviso de la última escritura existe siempre como región status", () => {
    expect(html).toMatch(/<div role="status" class="sr-only"><\/div>/);
  });
});

describe("Catálogo: reservar o liberar desde la ficha, de forma discreta", () => {
  const sheetUnit = (status: CatalogVehicle["status"]): CatalogVehicle => ({
    ...AVAILABLE,
    status,
  });

  function renderActions(
    vehicle: CatalogVehicle,
    props: Partial<Parameters<typeof VehicleActions>[0]> = {},
  ): string {
    return renderToStaticMarkup(
      createElement(VehicleActions, {
        vehicle,
        quoteCustomers: [],
        onTransition: () => {},
        ...props,
      }),
    );
  }

  it.each([
    ["available", "Reservar unidad"],
    ["reserved", "Liberar reserva"],
  ] as const)("una unidad %s ofrece «%s»", (status, label) => {
    const html = renderActions(sheetUnit(status));
    expect(buttons(html)).toContain(label);
    // Las rápidas siguen primero (Agendar es un enlace, Cotizar un botón):
    // la de la reserva va debajo, separada.
    expect(html.indexOf("Agendar prueba")).toBeGreaterThan(-1);
    expect(html.indexOf(label)).toBeGreaterThan(html.indexOf("Agendar prueba"));
    expect(html.indexOf(label)).toBeGreaterThan(html.indexOf("Cotizar"));
  });

  it("una vendida no ofrece reservar ni liberar", () => {
    const html = renderActions(sheetUnit("sold"));
    expect(html).not.toMatch(/Reservar unidad|Liberar reserva/);
  });

  it("mientras guarda, el botón dice Guardando… y no se vuelve a pedir", () => {
    const html = renderActions(sheetUnit("reserved"), { saving: true });
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>[\s\S]*?Guardando…/);
  });

  it("el aviso de cómo terminó queda al pie, en una región status", () => {
    const html = renderActions(sheetUnit("reserved"), {
      notice: {
        tone: "success",
        message: "Toyota Hilux 2025 quedó reservada.",
        vehicleId: AVAILABLE.id,
      },
    });
    expect(html).toMatch(
      /<p role="status" class="text-caption text-success">Toyota Hilux 2025 quedó reservada\.<\/p>/,
    );
  });

  it("sin manejador (p. ej. una vista de solo lectura), la ficha no ofrece la acción", () => {
    const html = renderToStaticMarkup(
      createElement(VehicleActions, {
        vehicle: sheetUnit("available"),
        quoteCustomers: [],
      }),
    );
    expect(html).not.toContain("Reservar unidad");
  });
});

describe("avisos de changeVehicleStatus()", () => {
  const HILUX = { ...AVAILABLE };
  const UNIT = {
    vehicleId: HILUX.id,
    brand: "Toyota",
    model: "Hilux",
    year: 2025,
  };

  it.each([
    [
      {
        status: "changed",
        ...UNIT,
        transition: "reserve",
        from: "available",
        to: "reserved",
      },
      "success",
      "Toyota Hilux 2025 quedó reservada. Para volver a ofrecerla, liberá la reserva.",
    ],
    [
      {
        status: "unchanged",
        ...UNIT,
        transition: "reserve",
        current: "reserved",
      },
      "neutral",
      "Toyota Hilux 2025 ya estaba reservada. No se hizo ningún cambio.",
    ],
    [
      { status: "conflict", ...UNIT, transition: "reserve", current: "sold" },
      "error",
      "No se pudo reservar: Toyota Hilux 2025 ya está vendida y una venta no se deshace. No se hizo ningún cambio.",
    ],
    [
      { status: "sale_requires_closure" },
      "error",
      "La venta de una unidad se registra al cerrar como Ganada la oportunidad que la tiene vinculada. No se hizo ningún cambio.",
    ],
    [
      { status: "not_found" },
      "error",
      "No encontramos esa unidad en el stock. No se hizo ningún cambio.",
    ],
    [
      { status: "failed" },
      "error",
      "No pudimos guardar el cambio. No se hizo ningún cambio: intentá de nuevo en unos minutos.",
    ],
    [
      null,
      "error",
      "No pudimos guardar el cambio. No se hizo ningún cambio: intentá de nuevo en unos minutos.",
    ],
  ] as const)("%j → %s", (result, tone, message) => {
    expect(lifecycleNoticeOf(result, HILUX, "reserve")).toEqual({
      tone,
      message,
      vehicleId: HILUX.id,
    });
  });
});
