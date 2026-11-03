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
