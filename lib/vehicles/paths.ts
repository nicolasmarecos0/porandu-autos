import { COCKPIT_METRICS_PATH, COCKPIT_PATH } from "@/lib/cockpit/paths";
import { OPPORTUNITIES_PATH, PIPELINE_PATH } from "@/lib/opportunities/paths";

/*
 * Rutas de Stock (DEC-001). El catálogo visual es una vista de Stock, no un
 * ítem de la navegación global (propuesta DEC-049), como el embudo es una
 * vista de Opportunities (DEC-048). Puras y aptas para el navegador: las
 * usan los enlaces de la UI y las Server Actions que revalidan.
 */

/** Inventario: la Stock List agrupada por estado (DEC-026). */
export const STOCK_PATH = "/stock";

/** Catálogo visual: la galería para mostrar en el salón (propuesta DEC-049). */
export const STOCK_CATALOG_PATH = "/stock/catalog";

/*
 * Vistas que leen `vehicles.status` (Hito 19, propuesta DEC-051): las
 * revalidan los pases de estado de una unidad (changeVehicleStatus()) y el
 * cierre Ganada que la vende (closeOpportunity()). El Inventario y el
 * Catálogo la muestran; la cola y el embudo la usan para Match v0 y para el
 * cierre; el Cockpit y sus Métricas, para la salud del stock.
 */
export const VEHICLE_LIFECYCLE_PATHS = [
  STOCK_PATH,
  STOCK_CATALOG_PATH,
  OPPORTUNITIES_PATH,
  PIPELINE_PATH,
  COCKPIT_PATH,
  COCKPIT_METRICS_PATH,
] as const;
