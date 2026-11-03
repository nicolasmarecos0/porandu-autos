import { createElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { scheduleTestDriveHref } from "@/components/calendar/links";
import { CatalogView } from "@/components/stock/catalog/catalog-view";
import { readCatalogState } from "@/components/stock/catalog/use-catalog-state";
import {
  VehicleActions,
  VehicleDetail,
} from "@/components/stock/catalog/vehicle-sheet";
import { StockViewSwitch } from "@/components/stock/stock-view-switch";
import { Sheet } from "@/components/ui/sheet";
import type { StockCatalog } from "@/db/queries/stock-catalog";
import {
  CATALOG_PAGE_SIZE,
  indexCatalog,
  type CatalogVehicle,
} from "@/domains/vehicles/catalog";
import { newQuoteHref } from "@/lib/quotes/paths";

/*
 * Catálogo visual del stock (propuesta DEC-049), renderizado en el servidor
 * sin DOM: el encabezado con el selector de vista, la barra de filtros con
 * sus conteos, la grilla de tarjetas y sus datos (nada inventado), el primer
 * render ya filtrado desde la URL, las tandas, lo que no se muestra dicho,
 * los estados vacíos y la ficha con sus acciones rápidas. La consulta se
 * prueba en tests/unit/domains/vehicles/catalog.test.ts y el loader contra
 * la base en tests/db/stock-catalog.test.ts.
 */

const navigation = vi.hoisted(() => ({ search: "" }));

vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(navigation.search),
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

const id = (n: number) =>
  `30000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

const HILUX: CatalogVehicle = {
  id: id(1),
  brand: "Toyota",
  model: "Hilux",
  version: "SRV 2.8 4x4 AT",
  year: 2025,
  km: 0,
  price: { amount: "49900.00", currency: "USD" },
  status: "available",
};
const RANGER: CatalogVehicle = {
  id: id(2),
  brand: "Ford",
  model: "Ranger",
  year: 2021,
  status: "available",
};
const COROLLA: CatalogVehicle = {
  id: id(3),
  brand: "Toyota",
  model: "Corolla Cross",
  version: "XEI Hybrid 1.8",
  year: 2023,
  km: 48000,
  status: "reserved",
};
const C4: CatalogVehicle = {
  id: id(4),
  brand: "Citroën",
  model: "C4 Cactus",
  year: 2022,
  km: 31000,
  price: { amount: "145000000.00", currency: "PYG" },
  status: "sold",
};

const CUSTOMERS = [
  {
    opportunityId: "10000000-0000-4000-8000-000000000101",
    contactName: "Ramón Benítez",
    stage: "qualifying",
  },
] as const;

function catalog(overrides: Partial<StockCatalog> = {}): StockCatalog {
  const vehicles = overrides.vehicles ?? [HILUX, C4, COROLLA, RANGER];
  return {
    vehicles,
    total: vehicles.length,
    inPreparation: 0,
    quoteCustomers: CUSTOMERS,
    ...overrides,
  };
}

function render(element: ReactElement): string {
  return renderToStaticMarkup(element);
}

function view(search = "", data: StockCatalog = catalog()): string {
  navigation.search = search;
  return render(
    createElement(CatalogView, { title: "Catálogo", catalog: data }),
  );
}

function text(markup: string): string {
  return markup
    .replace(/<[^>]+>/g, " ")
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
}

function anchorTag(markup: string, href: string): string {
  const tag = [...markup.matchAll(/<a\b[^>]*>/g)]
    .map((match) => match[0])
    .find((candidate) => candidate.includes(`href="${href}"`));
  if (!tag) throw new Error(`missing link ${href}`);
  return tag;
}

/** Nombres de las tarjetas de la grilla, en orden. */
function cards(markup: string): string[] {
  return [...markup.matchAll(/<h3[^>]*>([\s\S]*?)<\/h3>/g)].map((match) =>
    text(match[1]!),
  );
}

beforeEach(() => {
  navigation.search = "";
});

describe("CatalogView", () => {
  it("encabezado: título, total y el selector Inventario · Catálogo", () => {
    const html = view();
    expect(html).toContain("<h1");
    expect(text(html)).toContain("Catálogo · 4 unidades");
    expect(anchorTag(html, "/stock/catalog")).toContain('aria-current="page"');
    expect(anchorTag(html, "/stock")).not.toContain("aria-current");
  });

  it("por defecto muestra las disponibles, con los conteos de cada estado", () => {
    const html = view();
    expect(cards(html)).toEqual(["Toyota Hilux", "Ford Ranger"]);
    expect(text(html)).toContain("2 unidades disponibles");
    expect(text(html)).toContain("Disponibles 2");
    expect(text(html)).toContain("Reservadas 1");
    expect(text(html)).toContain("Vendidas 1");
    expect(text(html)).toContain("Todas 4");
    const radio = [...html.matchAll(/<input\b[^>]*>/g)]
      .map((match) => match[0])
      .find(
        (tag) =>
          tag.includes('type="radio"') && tag.includes('value="available"'),
      );
    expect(radio).toContain('checked=""');
  });

  it("la barra de filtros es una búsqueda fija con los nombres de la URL", () => {
    const html = view();
    expect(html).toMatch(/<form[^>]*role="search"[^>]*method="get"/);
    expect(html).toContain('name="q"');
    expect(html).toContain('name="brand"');
    expect(html).toContain("sticky top-0");
    // Marcas por nombre, con lo que daría elegirlas.
    expect(text(html)).toContain(
      "Todas las marcas Citroën (0) Ford (1) Toyota (1)",
    );
  });

  it("el primer render ya llega filtrado desde la URL", () => {
    const html = view("status=all&brand=toyota&q=hybrid");
    expect(cards(html)).toEqual(["Toyota Corolla Cross"]);
    expect(text(html)).toContain("1 unidad");
    expect(html).toMatch(/<input[^>]*value="hybrid"/);
    expect(html).toMatch(/<option[^>]*value="toyota"[^>]*selected=""/);
    expect(text(html)).toContain("Limpiar filtros");
  });

  it("todas: stock primero y vendidas al final, subordinadas", () => {
    const html = view("status=all");
    expect(cards(html)).toEqual([
      "Toyota Hilux",
      "Ford Ranger",
      "Toyota Corolla Cross",
      "Citroën C4 Cactus",
    ]);
  });

  it("la tarjeta dice lo que hay y lo que falta, sin inventar", () => {
    const html = view("status=all");
    const all = text(html);
    expect(all).toContain("SRV 2.8 4x4 AT");
    expect(all).toContain("Año 2025 · Kilometraje 0 km");
    expect(all).toContain("USD 49.900");
    expect(all).toContain("Gs. 145.000.000");
    // Sin precio publicado ni km: se dice, no se completa.
    expect(all).toContain("Precio a confirmar");
    expect(all).toContain("Km sin dato");
    // El lugar de la foto real: sin silueta, sin "Representación".
    expect(all).toContain("Sin fotos cargadas");
    expect(all).not.toContain("Representación");
    expect(html).not.toContain("<img");
  });

  it("cada tarjeta abre la ficha con un botón de nombre corto", () => {
    const html = view();
    expect(html).toMatch(
      /<button[^>]*aria-haspopup="dialog"[^>]*><span class="sr-only">Toyota <\/span>Hilux<\/button>/,
    );
  });

  it("sin coincidencias: dice cuántas hay en otros estados y cómo verlas", () => {
    const html = view("q=cactus");
    expect(cards(html)).toEqual([]);
    expect(text(html)).toContain("Ninguna unidad coincide");
    expect(text(html)).toContain(
      "Hay 1 unidad en otros estados que coinciden con la búsqueda y la marca.",
    );
    expect(text(html)).toContain("Ver todas");
  });

  it("dibuja de a tandas y ofrece la siguiente", () => {
    const many = Array.from({ length: CATALOG_PAGE_SIZE + 5 }, (_, n) => ({
      ...RANGER,
      id: id(100 + n),
      model: `Ranger ${n + 1}`,
    }));
    const html = view("", catalog({ vehicles: many }));
    expect(cards(html)).toHaveLength(CATALOG_PAGE_SIZE);
    expect(text(html)).toContain("Mostrar 5 más · quedan 5");
  });

  it("nombra las unidades en preparación y lo que no se cargó", () => {
    const html = view("", catalog({ inPreparation: 2, total: 1004 }));
    expect(text(html)).toContain(
      "2 unidades en preparación no se muestran en el catálogo: están en Inventario. Ver Inventario",
    );
    expect(text(html)).toContain(
      "Se cargaron 4 de 1004 unidades: quedan afuera las vendidas más antiguas.",
    );
  });

  it("una organización sin unidades para mostrar tiene su estado vacío, sin filtros", () => {
    const html = view(
      "",
      catalog({ vehicles: [], total: 0, inPreparation: 1 }),
    );
    expect(text(html)).toContain("Todavía no hay unidades para mostrar");
    expect(text(html)).toContain("1 unidad en preparación no se muestra");
    expect(html).not.toContain('role="search"');
  });
});

describe("estado desde la URL", () => {
  const index = indexCatalog([HILUX, C4, COROLLA, RANGER]);

  it("lee filtros y unidad, y descarta lo que no existe en el catálogo", () => {
    expect(readCatalogState(index, `brand=ford&unit=${C4.id}`)).toEqual({
      filters: { status: "available", brand: "ford", query: "" },
      unitId: C4.id,
      visible: CATALOG_PAGE_SIZE,
    });
    expect(
      readCatalogState(index, `brand=fiat&unit=${id(99)}&status=nope`),
    ).toEqual({
      filters: { status: "available", brand: null, query: "" },
      unitId: null,
      visible: CATALOG_PAGE_SIZE,
    });
  });
});

describe("ficha de la unidad", () => {
  function detail(vehicle: CatalogVehicle): string {
    return render(
      createElement(
        Sheet,
        { open: true },
        createElement(VehicleDetail, { vehicle }),
      ),
    );
  }

  it("título, descripción y la ficha completa con el precio publicado", () => {
    const html = detail(HILUX);
    expect(html).toMatch(/<h2[^>]*>.*Hilux<\/h2>/);
    expect(text(html)).toContain("SRV 2.8 4x4 AT · 2025");
    expect(text(html)).toContain("Precio publicado USD 49.900");
    expect(text(html)).toContain(
      "Marca Toyota Modelo Hilux Versión SRV 2.8 4x4 AT Año 2025 Kilometraje 0 km Estado Disponible",
    );
  });

  it("lo que falta es sin dato y el precio, a confirmar", () => {
    const html = detail(RANGER);
    expect(text(html)).toContain("Versión Sin dato");
    expect(text(html)).toContain("Kilometraje Sin dato");
    expect(text(html)).toContain("Precio publicado Precio a confirmar");
  });
});

describe("acciones rápidas", () => {
  function actions(vehicle: CatalogVehicle): string {
    return render(
      createElement(VehicleActions, { vehicle, quoteCustomers: CUSTOMERS }),
    );
  }

  it("disponible con precio: agendar lleva a la agenda y cotizar pide el cliente", () => {
    const html = actions(HILUX);
    expect(anchorTag(html, `/calendar?schedule=${HILUX.id}`)).toBeDefined();
    expect(text(html)).toContain("Agendar prueba");
    expect(text(html)).toContain("Cotizar");
  });

  it("reservada sin precio: solo agendar, y dice por qué", () => {
    const html = actions(COROLLA);
    expect(text(html)).toBe(
      "Sin precio publicado: todavía no se puede cotizar. Agendar prueba",
    );
  });

  it("vendida: ninguna acción", () => {
    const html = actions(C4);
    expect(text(html)).toBe("Unidad vendida: ya no se agenda ni se cotiza.");
    expect(html).not.toContain("<a");
    expect(html).not.toContain("<button");
  });

  it("los atajos llevan la unidad a la puerta de su módulo", () => {
    expect(scheduleTestDriveHref(HILUX.id)).toBe(
      `/calendar?schedule=${HILUX.id}`,
    );
    expect(newQuoteHref(CUSTOMERS[0].opportunityId, HILUX.id)).toBe(
      `/opportunities/${CUSTOMERS[0].opportunityId}?quote=${HILUX.id}`,
    );
  });
});

describe("StockViewSwitch", () => {
  it("dos enlaces, Inventario y Catálogo, con la vista actual marcada", () => {
    const html = render(
      createElement(StockViewSwitch, { current: "inventory" }),
    );
    expect(html).toContain('aria-label="Vista de stock"');
    expect(anchorTag(html, "/stock")).toContain('aria-current="page"');
    expect(anchorTag(html, "/stock/catalog")).not.toContain("aria-current");
    expect(text(html)).toBe("Inventario Catálogo");
  });
});
