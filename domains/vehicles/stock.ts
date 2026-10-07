import { formatMoney, groupThousands, type Currency } from "@/domains/money";

/*
 * Stock: unidades del inventario de una organización (H1.3A). Tipos, copy y
 * derivaciones de presentación, puras: no cargan datos ni conocen la base.
 */

/**
 * Estado comercial de la unidad (TB §10, "Estados de vehículo": el mínimo
 * de P1). En H1.3A solo se lee: las transiciones llegan con su flujo.
 */
export type VehicleStatus = "inPreparation" | "available" | "reserved" | "sold";

/** Moneda del precio publicado. No se convierte entre monedas. */
export type { Currency };

/** Precio publicado exacto: decimal en texto, nunca un `number` (float). */
export type Price = Readonly<{ amount: string; currency: Currency }>;

/*
 * ViewModel de una fila de la Stock List. Un campo opcional que no llega es
 * "sin dato": la UI lo dice y nunca lo completa con un valor inventado. No
 * hay matches, interesados, fotos reales ni demanda: no tienen fuente todavía.
 */
export type StockVehicle = Readonly<{
  id: string;
  brand: string;
  model: string;
  version?: string;
  year: number;
  /** Kilometraje. `0` es una unidad 0 km; ausente es sin dato. */
  km?: number;
  price?: Price;
  status: VehicleStatus;
}>;

/* Copy visible (es-PY). */

export const VEHICLE_STATUSES: readonly {
  id: VehicleStatus;
  label: string;
}[] = [
  { id: "inPreparation", label: "En preparación" },
  { id: "available", label: "Disponible" },
  { id: "reserved", label: "Reservado" },
  { id: "sold", label: "Vendido" },
];

export function vehicleStatusLabel(status: VehicleStatus): string {
  return VEHICLE_STATUSES.find((item) => item.id === status)?.label ?? status;
}

/**
 * Precio para mostrar, con el formato del contrato visual de B1 ("USD 49.900",
 * "Gs. 150.000.000"): el de todo dinero de Porandú (domains/money.ts), exacto
 * y sin pasar por float.
 */
export function formatPrice(price: Price): string {
  return formatMoney(price);
}

/** Kilometraje para mostrar: "0 km", "142.000 km". */
export function formatKm(km: number): string {
  if (!Number.isSafeInteger(km) || km < 0) {
    throw new Error(`invalid km: ${km}`);
  }
  return `${groupThousands(String(km))} km`;
}

/** Marca y modelo, la identificación principal de la unidad. */
export function vehicleName({
  brand,
  model,
}: Pick<StockVehicle, "brand" | "model">): string {
  return `${brand} ${model}`;
}

/** Versión y año: la segunda línea de la identidad ("SRV 2.8 4x4 AT · 2025"). */
export function vehicleDetail({
  version,
  year,
}: Pick<StockVehicle, "version" | "year">): string {
  return version ? `${version} · ${year}` : String(year);
}

export function unitsLabel(count: number): string {
  return count === 1 ? "1 unidad" : `${count} unidades`;
}

/*
 * Stock Surface v0.1: el inventario se presenta agrupado por estado, de lo
 * vendible a lo cerrado. Es una regla de presentación: el loader conserva su
 * orden (ingreso a Porandú) y cada grupo lo respeta.
 */
export const STOCK_GROUPS: readonly {
  status: VehicleStatus;
  title: string;
  hint: string;
}[] = [
  { status: "available", title: "Disponibles", hint: "Listas para vender" },
  {
    status: "inPreparation",
    title: "En preparación",
    hint: "Todavía no se entregan",
  },
  {
    status: "reserved",
    title: "Reservadas",
    hint: "Comprometidas con un comprador",
  },
  { status: "sold", title: "Vendidas", hint: "Operaciones cerradas" },
];

/** Unidades por estado: conteos derivados de la lista, no persistidos. */
export function countByStatus(
  vehicles: readonly StockVehicle[],
): Record<VehicleStatus, number> {
  const counts: Record<VehicleStatus, number> = {
    inPreparation: 0,
    available: 0,
    reserved: 0,
    sold: 0,
  };
  for (const vehicle of vehicles) counts[vehicle.status] += 1;
  return counts;
}

export type StockGroup = Readonly<{
  status: VehicleStatus;
  title: string;
  hint: string;
  vehicles: readonly StockVehicle[];
}>;

/**
 * Grupos no vacíos en el orden de STOCK_GROUPS. Dentro de cada grupo, el
 * orden de entrada (el del loader). No filtra nada: toda unidad está en un
 * grupo, incluidas las vendidas.
 */
export function groupByStatus(
  vehicles: readonly StockVehicle[],
): readonly StockGroup[] {
  return STOCK_GROUPS.map((group) => ({
    ...group,
    vehicles: vehicles.filter((vehicle) => vehicle.status === group.status),
  })).filter((group) => group.vehicles.length > 0);
}
