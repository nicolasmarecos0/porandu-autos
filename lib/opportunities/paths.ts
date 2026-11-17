/*
 * Rutas de Opportunities (DEC-001): la cola, el embudo de ventas y la tabla,
 * que son vistas de Opportunities y no ítems de la navegación global. Puras
 * y aptas para el navegador: las usan los enlaces de la UI y las Server
 * Actions que revalidan.
 */

/** Cola operativa de oportunidades (DEC-015, DEC-017). */
export const OPPORTUNITIES_PATH = "/opportunities";

/** Embudo de ventas: el tablero de oportunidades por etapa (DEC-048). */
export const PIPELINE_PATH = "/opportunities/pipeline";

/** Tabla de oportunidades con sus scores por columna (DEC-055). */
export const TABLE_PATH = "/opportunities/table";

/**
 * Parámetro que abre la cola con una oportunidad seleccionada (DEC-055): lo
 * usa la tabla para llevar a la ficha de decisión. Solo elige entre las
 * oportunidades que la cola ya leyó; no se consulta con él.
 */
export const SELECTED_OPPORTUNITY_PARAM = "op";

/**
 * Parámetro que dice desde qué vista se abrió la oportunidad (DEC-055): en
 * el teléfono, "Volver" regresa a esa lista. Solo admite `table`.
 */
export const SELECTION_ORIGIN_PARAM = "from";

/** Vista desde la que se abre una oportunidad en la cola. */
export type SelectionOrigin = "table";

/** La cola con esa oportunidad seleccionada. */
export function queueSelectionHref(
  opportunityId: string,
  origin?: SelectionOrigin,
): string {
  const query = new URLSearchParams({
    [SELECTED_OPPORTUNITY_PARAM]: opportunityId,
  });
  if (origin) query.set(SELECTION_ORIGIN_PARAM, origin);
  return `${OPPORTUNITIES_PATH}?${query.toString()}`;
}
