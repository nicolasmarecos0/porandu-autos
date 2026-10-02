import type { StockVehicle, VehicleStatus } from "@/domains/vehicles/stock";

/*
 * PROTOTIPO (/prototypes/stock). Datos sintéticos con exactamente el contrato
 * de H1.3A (StockVehicle), en el orden del loader (ingreso más reciente
 * primero). Ningún módulo productivo importa este archivo.
 */
export const PROTOTYPE_STOCK: readonly StockVehicle[] = [
  {
    id: "p01",
    brand: "Toyota",
    model: "Hilux",
    version: "SRV 2.8 4x4 AT",
    year: 2025,
    km: 0,
    price: { amount: "49900.00", currency: "USD" },
    status: "available",
  },
  {
    id: "p02",
    brand: "Kia",
    model: "Sportage",
    version: "2.0 EX AT",
    year: 2025,
    km: 0,
    price: { amount: "245000000.00", currency: "PYG" },
    status: "available",
  },
  {
    id: "p03",
    brand: "Suzuki",
    model: "Vitara",
    version: "GLX 1.6 AT",
    year: 2017,
    km: 112000,
    status: "inPreparation",
  },
  {
    id: "p04",
    brand: "Toyota",
    model: "Corolla Cross",
    version: "XEI Hybrid 1.8",
    year: 2023,
    km: 48000,
    price: { amount: "28290.00", currency: "USD" },
    status: "reserved",
  },
  {
    id: "p05",
    brand: "Hyundai",
    model: "HB20",
    year: 2019,
    status: "inPreparation",
  },
  {
    id: "p06",
    brand: "Chevrolet",
    model: "Onix",
    year: 2022,
    km: 31000,
    price: { amount: "98000000.00", currency: "PYG" },
    status: "reserved",
  },
  {
    id: "p07",
    brand: "Volkswagen",
    model: "Amarok",
    version: "V6 Highline 3.0 4x4 AT",
    year: 2020,
    price: { amount: "268500000.00", currency: "PYG" },
    status: "available",
  },
  {
    id: "p08",
    brand: "Mitsubishi",
    model: "L200 Triton",
    version: "GLS 2.4 4x4 MT",
    year: 2024,
    km: 0,
    price: { amount: "42900.00", currency: "USD" },
    status: "available",
  },
  {
    id: "p09",
    brand: "Ford",
    model: "Ranger",
    version: "XLT 3.2 4x4 AT",
    year: 2019,
    km: 96000,
    price: { amount: "31500.00", currency: "USD" },
    status: "available",
  },
  {
    id: "p10",
    brand: "Nissan",
    model: "Frontier",
    version: "XE 2.3 4x4 MT",
    year: 2021,
    km: 72000,
    price: { amount: "32990.50", currency: "USD" },
    status: "sold",
  },
  {
    id: "p11",
    brand: "Toyota",
    model: "Fortuner",
    version: "SRV 2.8 4x4",
    year: 2022,
    km: 54000,
    price: { amount: "52900.00", currency: "USD" },
    status: "reserved",
  },
  {
    id: "p12",
    brand: "Renault",
    model: "Duster",
    year: 2018,
    km: 88000,
    price: { amount: "79000000.00", currency: "PYG" },
    status: "sold",
  },
];

export function countsByStatus(
  vehicles: readonly StockVehicle[],
): Record<VehicleStatus, number> {
  const counts: Record<VehicleStatus, number> = {
    available: 0,
    inPreparation: 0,
    reserved: 0,
    sold: 0,
  };
  for (const vehicle of vehicles) counts[vehicle.status] += 1;
  return counts;
}

/** Orden de lectura comercial: lo vendible primero, lo cerrado al final. */
export const STATUS_ORDER: readonly VehicleStatus[] = [
  "available",
  "inPreparation",
  "reserved",
  "sold",
];

/* Copy de conteo (es-PY), singular y plural. */
export const STATUS_COUNT_LABEL: Record<VehicleStatus, [string, string]> = {
  available: ["disponible", "disponibles"],
  inPreparation: ["en preparación", "en preparación"],
  reserved: ["reservada", "reservadas"],
  sold: ["vendida", "vendidas"],
};

export function countLabel(status: VehicleStatus, count: number): string {
  const [one, many] = STATUS_COUNT_LABEL[status];
  return `${count} ${count === 1 ? one : many}`;
}

export function unitsLabel(count: number): string {
  return count === 1 ? "1 unidad" : `${count} unidades`;
}
