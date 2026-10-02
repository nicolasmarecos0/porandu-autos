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
export type Currency = "PYG" | "USD";

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

const CURRENCY_PREFIX: Readonly<Record<Currency, string>> = {
  USD: "USD",
  PYG: "Gs.",
};

/** Agrupa los miles con punto (es-PY): "49900" → "49.900". */
function groupThousands(digits: string): string {
  return digits.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
}

const DECIMAL = /^(\d+)(?:\.(\d+))?$/;

/**
 * Precio para mostrar, con el formato del contrato visual de B1 ("USD 49.900",
 * "Gs. 150.000.000"). Trabaja sobre el texto decimal, sin pasar por float:
 * el valor que se ve es exactamente el guardado. Los centavos solo aparecen
 * si existen ("USD 49.900,50").
 */
export function formatPrice({ amount, currency }: Price): string {
  const match = DECIMAL.exec(amount.trim());
  if (!match) throw new Error(`invalid decimal amount: ${amount}`);
  const integer = match[1]!.replace(/^0+(?=\d)/, "");
  const cents = (match[2] ?? "").replace(/0+$/, "");
  const fraction = cents === "" ? "" : `,${cents.padEnd(2, "0")}`;
  return `${CURRENCY_PREFIX[currency]} ${groupThousands(integer)}${fraction}`;
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
