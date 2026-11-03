import { describe, expect, it } from "vitest";

import {
  CATALOG_PAGE_SIZE,
  CATALOG_QUERY_MAX_LENGTH,
  CATALOG_STATUS_FILTER_LABELS,
  CATALOG_STATUS_FILTERS,
  catalogActions,
  catalogResultLabel,
  catalogSearch,
  DEFAULT_CATALOG_FILTERS,
  foldSearchText,
  hasActiveFilters,
  indexCatalog,
  inPreparationNote,
  parseCatalogFilters,
  parseCatalogUnit,
  queryCatalog,
  resolveCatalogFilters,
  searchTokens,
  toCatalogVehicle,
  type CatalogFilters,
  type CatalogVehicle,
} from "@/domains/vehicles/catalog";

/*
 * Catálogo visual (propuesta DEC-049): filtros de la URL, búsqueda, facetas,
 * orden y acciones rápidas, sin base ni navegador. La misma consulta corre
 * en el servidor (primer render) y en el navegador (cada cambio).
 */

const id = (n: number) =>
  `30000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

/** Unidades en el orden del loader: ingreso más reciente primero. */
const UNITS: readonly CatalogVehicle[] = [
  {
    id: id(1),
    brand: "Toyota",
    model: "Hilux",
    version: "SRV 2.8 4x4 AT",
    year: 2025,
    km: 0,
    price: { amount: "49900.00", currency: "USD" },
    status: "available",
  },
  {
    id: id(2),
    brand: "Citroën",
    model: "C4 Cactus",
    version: "Feel 1.6",
    year: 2022,
    km: 31000,
    price: { amount: "145000000.00", currency: "PYG" },
    status: "sold",
  },
  {
    id: id(3),
    brand: "TOYOTA ",
    model: "Corolla Cross",
    version: "XEI Hybrid 1.8",
    year: 2023,
    km: 48000,
    status: "reserved",
  },
  {
    id: id(4),
    brand: "Ford",
    model: "Ranger",
    year: 2021,
    status: "available",
  },
  {
    id: id(5),
    brand: "toyota",
    model: "Hilux",
    version: "SR 2.4 4x2 MT",
    year: 2019,
    km: 142000,
    price: { amount: "27500.00", currency: "USD" },
    status: "sold",
  },
  {
    id: id(6),
    brand: "Toyota",
    model: "Yaris",
    year: 2024,
    km: 12000,
    price: { amount: "19990.00", currency: "USD" },
    status: "available",
  },
];

const index = indexCatalog(UNITS);

function filters(overrides: Partial<CatalogFilters> = {}): CatalogFilters {
  return { ...DEFAULT_CATALOG_FILTERS, ...overrides };
}

function idsOf(vehicles: readonly CatalogVehicle[]): string[] {
  return vehicles.map((vehicle) => vehicle.id);
}

describe("filtros desde la URL", () => {
  it("sin parámetros: disponibles, todas las marcas y sin búsqueda", () => {
    expect(parseCatalogFilters({})).toEqual({
      status: "available",
      brand: null,
      query: "",
    });
  });

  it("acepta solo los estados del catálogo; cualquier otro es el de por defecto", () => {
    for (const status of CATALOG_STATUS_FILTERS) {
      expect(parseCatalogFilters({ status }).status).toBe(status);
    }
    for (const status of ["inPreparation", "in_preparation", "SOLD", ""]) {
      expect(parseCatalogFilters({ status }).status).toBe("available");
    }
    // Un parámetro repetido usa el primero.
    expect(parseCatalogFilters({ status: ["sold", "reserved"] }).status).toBe(
      "sold",
    );
  });

  it("la marca es una clave normalizada como en Match v0; vacía o desmedida es todas", () => {
    expect(parseCatalogFilters({ brand: "  Toyota " }).brand).toBe("toyota");
    expect(parseCatalogFilters({ brand: "   " }).brand).toBeNull();
    expect(parseCatalogFilters({ brand: "x".repeat(121) }).brand).toBeNull();
  });

  it("la búsqueda se recorta, pierde los caracteres de control y se acota", () => {
    expect(parseCatalogFilters({ q: "  hilux\u0000 2025 " }).query).toBe(
      "hilux  2025",
    );
    expect(parseCatalogFilters({ q: "a".repeat(200) }).query).toHaveLength(
      CATALOG_QUERY_MAX_LENGTH,
    );
  });

  it("la unidad abierta es un UUID o nada", () => {
    expect(parseCatalogUnit({ unit: id(1).toUpperCase() })).toBe(id(1));
    expect(parseCatalogUnit({ unit: "1; DROP TABLE vehicles" })).toBeNull();
    expect(parseCatalogUnit({})).toBeNull();
  });
});

describe("filtros hacia la URL", () => {
  it("el estado por defecto no se escribe y sin filtros no hay query string", () => {
    expect(catalogSearch(DEFAULT_CATALOG_FILTERS)).toBe("");
    expect(catalogSearch(filters({ query: "   " }))).toBe("");
  });

  it("escribe estado, marca, búsqueda y unidad, y se vuelve a leer igual", () => {
    const written = filters({
      status: "reserved",
      brand: "toyota",
      query: " corolla cross ",
    });
    const search = catalogSearch(written, id(3));
    expect(search).toBe(
      `?status=reserved&brand=toyota&q=corolla+cross&unit=${id(3)}`,
    );
    const params = Object.fromEntries(new URLSearchParams(search));
    expect(parseCatalogFilters(params)).toEqual({
      ...written,
      query: "corolla cross",
    });
    expect(parseCatalogUnit(params)).toBe(id(3));
  });

  it("hay filtros activos cuando algo difiere del de por defecto", () => {
    expect(hasActiveFilters(DEFAULT_CATALOG_FILTERS)).toBe(false);
    expect(hasActiveFilters(filters({ query: "  " }))).toBe(false);
    expect(hasActiveFilters(filters({ status: "all" }))).toBe(true);
    expect(hasActiveFilters(filters({ brand: "ford" }))).toBe(true);
    expect(hasActiveFilters(filters({ query: "hilux" }))).toBe(true);
  });
});

describe("búsqueda", () => {
  it("compara sin tildes, sin mayúsculas y con los espacios colapsados", () => {
    expect(foldSearchText("  CITROËN   C4  ")).toBe("citroen c4");
    expect(foldSearchText("Peñarol")).toBe("penarol");
  });

  it("separa palabras, quita la puntuación de los bordes y no repite", () => {
    expect(searchTokens("Hilux, 2.8  hilux (4x4)")).toEqual([
      "hilux",
      "2.8",
      "4x4",
    ]);
    expect(searchTokens(" ,; ")).toEqual([]);
    expect(searchTokens("a b c d e f g h i j")).toHaveLength(8);
  });

  it("cada palabra tiene que estar en la marca, el modelo, la versión o el año", () => {
    const search = (query: string) =>
      idsOf(queryCatalog(index, filters({ status: "all", query })).vehicles);
    expect(search("hilux")).toEqual([id(1), id(5)]);
    expect(search("hilux 2025")).toEqual([id(1)]);
    expect(search("citroen")).toEqual([id(2)]);
    expect(search("4x4 srv")).toEqual([id(1)]);
    expect(search("2.4")).toEqual([id(5)]);
    expect(search("hilux ranger")).toEqual([]);
  });
});

describe("índice y orden", () => {
  it("ordena disponibles, reservadas y vendidas, y conserva el orden del loader en cada estado", () => {
    expect(index.entries.map(({ vehicle }) => vehicle.id)).toEqual([
      id(1),
      id(4),
      id(6),
      id(3),
      id(2),
      id(5),
    ]);
  });

  it("agrupa la marca sin mayúsculas ni bordes y la nombra con la escritura más frecuente", () => {
    expect(index.brands).toEqual([
      { key: "citroën", label: "Citroën" },
      { key: "ford", label: "Ford" },
      { key: "toyota", label: "Toyota" },
    ]);
  });

  it("a igual frecuencia, la primera por orden alfabético, sin depender del orden de entrada", () => {
    const kia = (n: number, brand: string): CatalogVehicle => ({
      ...UNITS[3]!,
      id: id(n),
      brand,
    });
    const label = (...units: CatalogVehicle[]) =>
      indexCatalog(units).brands.map((brand) => brand.label);
    // Solo difieren en mayúsculas: desempata el código, en cualquier orden.
    expect(label(kia(10, "kia"), kia(11, "KIA"))).toEqual(["KIA"]);
    expect(label(kia(11, "KIA"), kia(10, "kia"))).toEqual(["KIA"]);
    // La más frecuente gana, aunque aparezca después.
    expect(label(kia(10, "KIA"), kia(11, "Kia"), kia(12, "Kia"))).toEqual([
      "Kia",
    ]);
  });

  it("ubica cada unidad por id", () => {
    expect(index.byId.get(id(3))?.model).toBe("Corolla Cross");
    expect(index.byId.has(id(99))).toBe(false);
  });
});

describe("consulta y facetas", () => {
  it("por defecto muestra solo las disponibles", () => {
    const result = queryCatalog(index, DEFAULT_CATALOG_FILTERS);
    expect(idsOf(result.vehicles)).toEqual([id(1), id(4), id(6)]);
  });

  it("los conteos por estado respetan la marca y la búsqueda", () => {
    expect(queryCatalog(index, DEFAULT_CATALOG_FILTERS).statusCounts).toEqual({
      available: 3,
      reserved: 1,
      sold: 2,
      all: 6,
    });
    expect(
      queryCatalog(index, filters({ brand: "toyota", query: "hilux" }))
        .statusCounts,
    ).toEqual({ available: 1, reserved: 0, sold: 1, all: 2 });
  });

  it("los conteos por marca respetan el estado y la búsqueda, y listan todas las marcas", () => {
    expect(queryCatalog(index, DEFAULT_CATALOG_FILTERS).brands).toEqual([
      { key: "citroën", label: "Citroën", count: 0 },
      { key: "ford", label: "Ford", count: 1 },
      { key: "toyota", label: "Toyota", count: 2 },
    ]);
    expect(
      queryCatalog(index, filters({ status: "sold", query: "2019" })).brands,
    ).toEqual([
      { key: "citroën", label: "Citroën", count: 0 },
      { key: "ford", label: "Ford", count: 0 },
      { key: "toyota", label: "Toyota", count: 1 },
    ]);
  });

  it("combina los tres filtros", () => {
    const result = queryCatalog(
      index,
      filters({ status: "all", brand: "toyota", query: "cross" }),
    );
    expect(idsOf(result.vehicles)).toEqual([id(3)]);
  });

  it("una marca que no existe en este catálogo vuelve a todas", () => {
    expect(resolveCatalogFilters(index, filters({ brand: "fiat" }))).toEqual(
      DEFAULT_CATALOG_FILTERS,
    );
    const known = filters({ brand: "ford" });
    expect(resolveCatalogFilters(index, known)).toBe(known);
  });

  it("un catálogo vacío no tiene marcas ni unidades", () => {
    const empty = indexCatalog([]);
    expect(queryCatalog(empty, DEFAULT_CATALOG_FILTERS)).toEqual({
      vehicles: [],
      statusCounts: { available: 0, reserved: 0, sold: 0, all: 0 },
      brands: [],
    });
  });
});

describe("unidades y acciones rápidas", () => {
  it("una unidad en preparación no entra al catálogo", () => {
    expect(
      toCatalogVehicle({ ...UNITS[0]!, status: "inPreparation" }),
    ).toBeNull();
    expect(toCatalogVehicle(UNITS[0]!)).toEqual(UNITS[0]);
  });

  it("disponible con precio: se agenda y se cotiza", () => {
    expect(catalogActions(UNITS[0]!)).toEqual({
      schedule: true,
      quote: true,
      hint: null,
    });
  });

  it("reservada sin precio: se agenda, pero no se cotiza", () => {
    expect(catalogActions(UNITS[2]!)).toEqual({
      schedule: true,
      quote: false,
      hint: "Sin precio publicado: todavía no se puede cotizar.",
    });
  });

  it("vendida: ninguna acción", () => {
    expect(catalogActions(UNITS[1]!)).toEqual({
      schedule: false,
      quote: false,
      hint: "Unidad vendida: ya no se agenda ni se cotiza.",
    });
  });
});

describe("copy", () => {
  it("el resultado dice cuántas y de qué estado", () => {
    expect(catalogResultLabel(1, "available")).toBe("1 unidad disponible");
    expect(catalogResultLabel(12, "available")).toBe("12 unidades disponibles");
    expect(catalogResultLabel(0, "reserved")).toBe("0 unidades reservadas");
    expect(catalogResultLabel(1, "sold")).toBe("1 unidad vendida");
    expect(catalogResultLabel(44, "all")).toBe("44 unidades");
  });

  it("las unidades en preparación se nombran, nunca se esconden en silencio", () => {
    expect(inPreparationNote(0)).toBeNull();
    expect(inPreparationNote(1)).toBe(
      "1 unidad en preparación no se muestra en el catálogo: está en Inventario.",
    );
    expect(inPreparationNote(3)).toBe(
      "3 unidades en preparación no se muestran en el catálogo: están en Inventario.",
    );
  });

  it("los filtros de estado tienen copy y la tanda entra en 1, 2, 3, 4 y 6 columnas", () => {
    expect(
      CATALOG_STATUS_FILTERS.map((s) => CATALOG_STATUS_FILTER_LABELS[s]),
    ).toEqual(["Disponibles", "Reservadas", "Vendidas", "Todas"]);
    for (const columns of [1, 2, 3, 4, 6]) {
      expect(CATALOG_PAGE_SIZE % columns).toBe(0);
    }
  });
});
