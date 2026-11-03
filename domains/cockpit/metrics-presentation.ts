import { countLabel, NO_DATA } from "@/domains/dashboard/presentation";
import { STOCK_GROUPS, type VehicleStatus } from "@/domains/vehicles/stock";

import type {
  AttentionView,
  QuoteValueStatus,
  TestDriveOutcomeCounts,
} from "./metrics";

/*
 * Copy y formato es-PY de las Métricas del salón (propuesta DEC-050 §8).
 * Puro y apto para el navegador. Reutiliza el formato del Dashboard
 * Directivo (domains/dashboard/presentation.ts: "1.234", "66,7%", "Sin
 * dato") y los rótulos de cada módulo: los grupos de la Stock List, los
 * estados de la agenda (DEC-041) y la recencia de DEC-035.
 */

/** Rótulo plural de cada estado de stock: el de los grupos de la Stock List. */
export const STOCK_STATUS_TITLES: Readonly<Record<VehicleStatus, string>> =
  Object.fromEntries(
    STOCK_GROUPS.map(({ status, title }) => [status, title]),
  ) as Record<VehicleStatus, string>;

/** Resultado de una prueba de manejo que ya se debía. */
export type TestDriveOutcome = keyof Omit<TestDriveOutcomeCounts, "upcoming">;

/**
 * Orden y copy de los resultados del pulso operativo. "No asistió" es el
 * rótulo del estado (DEC-041) y no cambia con el número.
 */
export const TEST_DRIVE_OUTCOMES: readonly Readonly<{
  id: TestDriveOutcome;
  label: string;
}>[] = [
  { id: "completed", label: "Realizadas" },
  { id: "noShow", label: "No asistió" },
  { id: "cancelled", label: "Canceladas" },
  { id: "overdue", label: "Vencidas sin resultado" },
];

/** Estado de una cotización en juego: qué le falta. */
export const QUOTE_VALUE_STATUS_LABELS: Readonly<
  Record<QuoteValueStatus, string>
> = {
  approved: "Aprobadas · por enviar",
  sent: "Enviadas · esperando respuesta",
};

/** Recencia de las abiertas, en plural (DEC-035 §2). */
export const ATTENTION_LABELS: Readonly<
  Record<keyof Pick<AttentionView, "active" | "warning" | "stale">, string>
> = {
  active: "Activas",
  warning: "Enfriándose",
  stale: "Inactivas",
};

/**
 * Un promedio de días ya redondeado: "Sin dato" sin base (DEC-005),
 * "Menos de 1 día" cuando redondea a cero, "1 día" o "34 días".
 */
export function averageDaysLabel(days: number | null): string {
  if (days === null) return NO_DATA;
  if (days === 0) return "Menos de 1 día";
  return countLabel(days, "día", "días");
}

/** "1 cotización", "3 cotizaciones". */
export function quotesLabel(count: number): string {
  return countLabel(count, "cotización", "cotizaciones");
}

/** "1 unidad", "1.234 unidades". */
export function unitsCountLabel(count: number): string {
  return countLabel(count, "unidad", "unidades");
}

/** Base de la tasa de realización: "5 realizadas de 8 pruebas". */
export function testDriveRateBasis(completed: number, due: number): string {
  return `${countLabel(completed, "realizada", "realizadas")} de ${countLabel(due, "prueba", "pruebas")}`;
}

/** Base del ciclo de venta: "Promedio de 3 ventas". */
export function salesCycleBasis(won: number): string {
  return `Promedio de ${countLabel(won, "venta", "ventas")}`;
}
