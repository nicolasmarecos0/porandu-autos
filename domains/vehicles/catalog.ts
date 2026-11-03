import { TESTABLE_VEHICLE_STATUSES } from "@/domains/calendar/test-drives";
import { normalizeName } from "@/domains/match/evaluators";
import {
  QUOTABLE_STAGES,
  QUOTABLE_VEHICLE_STATUSES,
} from "@/domains/quotes/statuses";

import type { StockVehicle, VehicleStatus } from "./stock";

/*
 * Catálogo visual del stock (propuesta DEC-049): la galería que el vendedor
 * le muestra al cliente en el salón. Tipos, filtros, facetas y reglas de las
 * acciones rápidas, puros y aptos para el navegador: no cargan datos ni
 * conocen la base, React ni Next.
 *
 * La misma función filtra en el servidor (el primer render, desde la URL)
 * y en el navegador (cada cambio, al instante y sin volver al servidor): el
 * resultado no depende de dónde corre. La URL guarda los filtros para
 * compartir, recargar y volver atrás.
 *
 * Solo se lee lo que la base tiene (DEC-025 §9): marca, modelo, versión,
 * año, kilometraje, precio publicado y estado. No hay fotos reales todavía
 * (vehicle_media), ni datos técnicos, ni interesados.
 */

/* Unidades del catálogo. */

/**
 * Estados que muestra el catálogo: lo que se le puede mostrar a un cliente.
 * "En preparación" no entra (todavía no se entrega, DEC-026): el catálogo
 * dice cuántas hay y dónde verlas, nunca las esconde en silencio
 * (DEC-025 §8).
 */
export const CATALOG_STATUSES = [
  "available",
  "reserved",
  "sold",
] as const satisfies readonly VehicleStatus[];

export type CatalogStatus = (typeof CATALOG_STATUSES)[number];

/** Una unidad del catálogo: la de la Stock List, con un estado mostrable. */
export type CatalogVehicle = StockVehicle & Readonly<{ status: CatalogStatus }>;

export function isCatalogStatus(
  status: VehicleStatus,
): status is CatalogStatus {
  return (CATALOG_STATUSES as readonly VehicleStatus[]).includes(status);
}

/** Unidad de la Stock List → unidad del catálogo, o null si no se muestra. */
export function toCatalogVehicle(vehicle: StockVehicle): CatalogVehicle | null {
  const { status } = vehicle;
  return isCatalogStatus(status) ? { ...vehicle, status } : null;
}

/*
 * Orden de presentación: lo vendible primero y lo cerrado al final
 * (DEC-026 §5: las vendidas siguen consultables, subordinadas al stock
 * operativo). Dentro de cada estado, el orden de entrada (el del loader:
 * ingreso a Porandú, DEC-025 §7).
 */
const STATUS_RANK: Readonly<Record<CatalogStatus, number>> = {
  available: 0,
  reserved: 1,
  sold: 2,
};

/* Filtros. */

/** Filtro de estado: uno de los del catálogo o todos. */
export const CATALOG_STATUS_FILTERS = [
  "available",
  "reserved",
  "sold",
  "all",
] as const;

export type CatalogStatusFilter = (typeof CATALOG_STATUS_FILTERS)[number];

/** Copy de cada filtro de estado (es-PY), en el orden del control. */
export const CATALOG_STATUS_FILTER_LABELS: Readonly<
  Record<CatalogStatusFilter, string>
> = {
  available: "Disponibles",
  reserved: "Reservadas",
  sold: "Vendidas",
  all: "Todas",
};

/** En el salón se muestra, primero, lo que se puede vender hoy. */
export const DEFAULT_CATALOG_STATUS: CatalogStatusFilter = "available";

export type CatalogFilters = Readonly<{
  status: CatalogStatusFilter;
  /** Clave de la marca (catalogBrandKey()), o null para todas. */
  brand: string | null;
  /** Búsqueda libre tal como se escribe; "" es sin búsqueda. */
  query: string;
}>;

export const DEFAULT_CATALOG_FILTERS: CatalogFilters = {
  status: DEFAULT_CATALOG_STATUS,
  brand: null,
  query: "",
};

/** Largo máximo de la búsqueda: defensivo, como los campos del alta. */
export const CATALOG_QUERY_MAX_LENGTH = 80;

/** Largo máximo de la clave de marca que se acepta de la URL (defensivo). */
const BRAND_KEY_MAX_LENGTH = 120;

/** Palabras de búsqueda que se evalúan: el resto se ignora. */
const MAX_SEARCH_TOKENS = 8;

/**
 * Tarjetas por tanda: la grilla dibuja de a 24 (entra justo en 1, 2, 3, 4
 * o 6 columnas) y "Mostrar más" suma la siguiente tanda.
 */
export const CATALOG_PAGE_SIZE = 24;

/*
 * Parámetros de la URL (identificadores en inglés, DEC-011):
 *   /stock/catalog?status=reserved&brand=toyota&q=hilux&unit=<uuid>
 * El estado por defecto no se escribe. `unit` es la unidad abierta en la
 * vista de detalle.
 */
export const CATALOG_PARAMS = {
  status: "status",
  brand: "brand",
  query: "q",
  unit: "unit",
} as const;

/** Parámetros como los entrega Next (`searchParams`) o `URLSearchParams`. */
export type CatalogParamSource = Readonly<
  Record<string, string | readonly string[] | undefined>
>;

function firstParam(
  source: CatalogParamSource,
  name: string,
): string | undefined {
  const value = source[name];
  return typeof value === "string" ? value : value?.[0];
}

// Caracteres de control: nunca forman parte de una búsqueda.
const CONTROL = /\p{Cc}/gu;

function isStatusFilter(value: string): value is CatalogStatusFilter {
  return (CATALOG_STATUS_FILTERS as readonly string[]).includes(value);
}

/**
 * Filtros desde la URL, sin confiar en ella: un estado desconocido es el de
 * por defecto, una marca vacía o demasiado larga es "todas" y la búsqueda
 * se acota. Que la marca exista lo decide resolveCatalogFilters().
 */
export function parseCatalogFilters(
  source: CatalogParamSource,
): CatalogFilters {
  const status = firstParam(source, CATALOG_PARAMS.status);
  const brand = catalogBrandKey(firstParam(source, CATALOG_PARAMS.brand) ?? "");
  const query = (firstParam(source, CATALOG_PARAMS.query) ?? "")
    .replace(CONTROL, " ")
    .trim()
    .slice(0, CATALOG_QUERY_MAX_LENGTH);
  return {
    status:
      status !== undefined && isStatusFilter(status)
        ? status
        : DEFAULT_CATALOG_STATUS,
    brand: brand !== "" && brand.length <= BRAND_KEY_MAX_LENGTH ? brand : null,
    query,
  };
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Unidad abierta desde la URL (`?unit=`), o null si no es un UUID. */
export function parseCatalogUnit(source: CatalogParamSource): string | null {
  const unit = firstParam(source, CATALOG_PARAMS.unit)?.trim() ?? "";
  return UUID.test(unit) ? unit.toLowerCase() : null;
}

/**
 * Query string de los filtros (y de la unidad abierta), con "?" o vacío.
 * Es la inversa de parseCatalogFilters(): lo que se escribe se vuelve a
 * leer igual.
 */
export function catalogSearch(
  filters: CatalogFilters,
  unitId: string | null = null,
): string {
  const params = new URLSearchParams();
  if (filters.status !== DEFAULT_CATALOG_STATUS) {
    params.set(CATALOG_PARAMS.status, filters.status);
  }
  if (filters.brand !== null) params.set(CATALOG_PARAMS.brand, filters.brand);
  const query = filters.query.replace(CONTROL, " ").trim();
  if (query !== "") params.set(CATALOG_PARAMS.query, query);
  if (unitId !== null) params.set(CATALOG_PARAMS.unit, unitId);
  const search = params.toString();
  return search === "" ? "" : `?${search}`;
}

/** ¿Hay algún filtro distinto del de por defecto? */
export function hasActiveFilters(filters: CatalogFilters): boolean {
  return (
    filters.status !== DEFAULT_CATALOG_STATUS ||
    filters.brand !== null ||
    filters.query.trim() !== ""
  );
}

/* Búsqueda y marca. */

/**
 * Clave de una marca: la normalización de Match v0 (sin bordes ni
 * mayúsculas, DEC-031 §3), así "Toyota" y "TOYOTA " son la misma marca en
 * el catálogo y en el motor.
 */
export function catalogBrandKey(brand: string): string {
  return normalizeName(brand);
}

const MARKS = /\p{M}/gu;
const SPACES = /\s+/g;
const EDGE_PUNCTUATION = /^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu;

/**
 * Texto comparable: sin tildes ni diacríticos ("Citroën" → "citroen"), en
 * minúsculas y con los espacios colapsados.
 */
export function foldSearchText(text: string): string {
  return text
    .normalize("NFD")
    .replace(MARKS, "")
    .toLowerCase()
    .replace(SPACES, " ")
    .trim();
}

/**
 * Palabras de la búsqueda, sin repetidas y sin puntuación en los bordes
 * ("hilux," → "hilux"; "2.8" se conserva). Cada una tiene que aparecer en
 * la unidad (Y lógico).
 */
export function searchTokens(query: string): readonly string[] {
  const tokens = foldSearchText(query.replace(CONTROL, " "))
    .split(" ")
    .map((token) => token.replace(EDGE_PUNCTUATION, ""))
    .filter((token) => token !== "");
  return [...new Set(tokens)].slice(0, MAX_SEARCH_TOKENS);
}

/** Lo que se busca de una unidad: marca, modelo, versión y año. */
function searchText(vehicle: CatalogVehicle): string {
  return foldSearchText(
    [
      vehicle.brand,
      vehicle.model,
      vehicle.version ?? "",
      String(vehicle.year),
    ].join(" "),
  );
}

/* Índice y consulta. */

type IndexedVehicle = Readonly<{
  vehicle: CatalogVehicle;
  brandKey: string;
  haystack: string;
}>;

/** Marca del catálogo: su clave y cómo se muestra. */
export type CatalogBrand = Readonly<{ key: string; label: string }>;

/**
 * Catálogo listo para consultar: las unidades en el orden de presentación,
 * con su texto de búsqueda y su marca precalculados, una sola vez.
 */
export type CatalogIndex = Readonly<{
  entries: readonly IndexedVehicle[];
  /** Marcas de todo el catálogo, por nombre (es-PY). */
  brands: readonly CatalogBrand[];
  byId: ReadonlyMap<string, CatalogVehicle>;
}>;

const collator = new Intl.Collator("es", {
  sensitivity: "base",
  numeric: true,
});

/**
 * Orden alfabético es-PY (sin distinguir tildes ni mayúsculas) y, entre
 * textos que solo difieren en eso, por código: el orden nunca depende del
 * orden de entrada.
 */
function compareText(a: string, b: string): number {
  return collator.compare(a, b) || (a < b ? -1 : a > b ? 1 : 0);
}

/**
 * Nombre de una marca: la escritura más frecuente entre sus unidades y, a
 * igual frecuencia, la primera por compareText(). Nunca se inventa: es
 * siempre una de las cargadas.
 */
function brandLabel(spellings: ReadonlyMap<string, number>): string {
  let best = "";
  let bestCount = 0;
  for (const [spelling, count] of spellings) {
    if (
      count > bestCount ||
      (count === bestCount && compareText(spelling, best) < 0)
    ) {
      best = spelling;
      bestCount = count;
    }
  }
  return best;
}

/**
 * Índice del catálogo. `vehicles` llega en el orden del loader; el índice
 * lo ordena por estado (disponibles, reservadas, vendidas) y conserva el
 * orden de entrada dentro de cada uno (orden estable).
 */
export function indexCatalog(
  vehicles: readonly CatalogVehicle[],
): CatalogIndex {
  const entries = vehicles
    .map((vehicle) => ({
      vehicle,
      brandKey: catalogBrandKey(vehicle.brand),
      haystack: searchText(vehicle),
    }))
    .sort(
      (a, b) => STATUS_RANK[a.vehicle.status] - STATUS_RANK[b.vehicle.status],
    );

  const spellings = new Map<string, Map<string, number>>();
  for (const { vehicle, brandKey } of entries) {
    const label = vehicle.brand.trim();
    const counts = spellings.get(brandKey) ?? new Map<string, number>();
    counts.set(label, (counts.get(label) ?? 0) + 1);
    spellings.set(brandKey, counts);
  }
  const brands = [...spellings]
    .map(([key, counts]) => ({ key, label: brandLabel(counts) }))
    .sort((a, b) => compareText(a.label, b.label) || compareText(a.key, b.key));

  return {
    entries,
    brands,
    byId: new Map(entries.map(({ vehicle }) => [vehicle.id, vehicle])),
  };
}

/**
 * Filtros aplicables a este catálogo: una marca que no existe (un enlace
 * viejo o de otra organización) vuelve a "todas".
 */
export function resolveCatalogFilters(
  index: CatalogIndex,
  filters: CatalogFilters,
): CatalogFilters {
  return filters.brand !== null &&
    !index.brands.some((brand) => brand.key === filters.brand)
    ? { ...filters, brand: null }
    : filters;
}

/** Una marca con cuántas unidades daría elegirla con los demás filtros. */
export type BrandFacet = CatalogBrand & Readonly<{ count: number }>;

export type CatalogResult = Readonly<{
  /** Las unidades que coinciden con los tres filtros, en orden. */
  vehicles: readonly CatalogVehicle[];
  /** Por estado: las que coinciden con la marca y la búsqueda. */
  statusCounts: Readonly<Record<CatalogStatusFilter, number>>;
  /** Todas las marcas: las que coinciden con el estado y la búsqueda. */
  brands: readonly BrandFacet[];
}>;

/**
 * Consulta del catálogo. Cada faceta cuenta con los otros dos filtros: los
 * estados dicen cuántas habría con esa marca y esa búsqueda, y las marcas,
 * cuántas con ese estado y esa búsqueda. Una sola pasada, O(unidades).
 */
export function queryCatalog(
  index: CatalogIndex,
  filters: CatalogFilters,
): CatalogResult {
  const tokens = searchTokens(filters.query);
  const statusCounts: Record<CatalogStatusFilter, number> = {
    available: 0,
    reserved: 0,
    sold: 0,
    all: 0,
  };
  const brandCounts = new Map<string, number>();
  const vehicles: CatalogVehicle[] = [];

  for (const { vehicle, brandKey, haystack } of index.entries) {
    if (!tokens.every((token) => haystack.includes(token))) continue;
    const brandMatches = filters.brand === null || brandKey === filters.brand;
    const statusMatches =
      filters.status === "all" || vehicle.status === filters.status;
    if (brandMatches) {
      statusCounts[vehicle.status] += 1;
      statusCounts.all += 1;
    }
    if (statusMatches) {
      brandCounts.set(brandKey, (brandCounts.get(brandKey) ?? 0) + 1);
    }
    if (brandMatches && statusMatches) vehicles.push(vehicle);
  }

  return {
    vehicles,
    statusCounts,
    brands: index.brands.map((brand) => ({
      ...brand,
      count: brandCounts.get(brand.key) ?? 0,
    })),
  };
}

/* Acciones rápidas de la vista de detalle. */

export type CatalogActions = Readonly<{
  /** Agendar una prueba de manejo con la unidad (DEC-041 §3). */
  schedule: boolean;
  /** Cotizar la unidad (DEC-042 §1 y §3): estado y precio publicado. */
  quote: boolean;
  /** Por qué falta una acción (es-PY), o null si se ofrecen las dos. */
  hint: string | null;
}>;

/**
 * Qué acciones rápidas aplican a la unidad. Son atajos: cada una lleva al
 * módulo dueño de la escritura (la agenda o la oportunidad), que vuelve a
 * validar todo en el servidor. El catálogo no escribe nada.
 */
export function catalogActions(vehicle: CatalogVehicle): CatalogActions {
  const schedule = (TESTABLE_VEHICLE_STATUSES as readonly string[]).includes(
    vehicle.status,
  );
  const quotableStatus = (
    QUOTABLE_VEHICLE_STATUSES as readonly string[]
  ).includes(vehicle.status);
  const quote = quotableStatus && vehicle.price !== undefined;
  const hint =
    !schedule && !quotableStatus
      ? "Unidad vendida: ya no se agenda ni se cotiza."
      : quotableStatus && !quote
        ? "Sin precio publicado: todavía no se puede cotizar."
        : null;
  return { schedule, quote, hint };
}

/** Etapa de una oportunidad que admite cotizar (DEC-042 §1). */
export type QuotableStage = (typeof QUOTABLE_STAGES)[number];

/** La etapa, si admite cotizar; null si no. */
export function quotableStage(stage: string): QuotableStage | null {
  return QUOTABLE_STAGES.find((quotable) => quotable === stage) ?? null;
}

/**
 * Cliente al que se le puede cotizar la unidad: una oportunidad En
 * calificación o En negociación. Solo lo necesario para elegirla.
 */
export type QuoteCustomerOption = Readonly<{
  opportunityId: string;
  contactName: string;
  stage: QuotableStage;
}>;

/* Copy (es-PY). */

/** "1 unidad en preparación no se muestra…": nunca se esconden en silencio. */
export function inPreparationNote(count: number): string | null {
  if (count === 0) return null;
  return count === 1
    ? "1 unidad en preparación no se muestra en el catálogo: está en Inventario."
    : `${count} unidades en preparación no se muestran en el catálogo: están en Inventario.`;
}

const RESULT_NOUNS: Readonly<
  Record<CatalogStatusFilter, readonly [string, string]>
> = {
  available: ["unidad disponible", "unidades disponibles"],
  reserved: ["unidad reservada", "unidades reservadas"],
  sold: ["unidad vendida", "unidades vendidas"],
  all: ["unidad", "unidades"],
};

/** Resultado de la consulta: "1 unidad disponible", "12 unidades vendidas". */
export function catalogResultLabel(
  count: number,
  status: CatalogStatusFilter,
): string {
  const [one, many] = RESULT_NOUNS[status];
  return count === 1 ? `1 ${one}` : `${count} ${many}`;
}
