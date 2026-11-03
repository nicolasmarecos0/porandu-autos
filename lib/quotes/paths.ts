/*
 * Rutas del presupuesto de una cotización (Hito 14, DEC-046 §5). Puras y
 * aptas para el navegador: las usan la UI (enlaces y descarga), la página
 * del presupuesto y la Server Action que cambia el estado (revalidación).
 * Los ids son UUID: no necesitan escaparse, pero se escapan igual.
 */

/** Detalle de la oportunidad: el maestro de sus cotizaciones. */
export function opportunityPath(opportunityId: string): string {
  return `/opportunities/${encodeURIComponent(opportunityId)}`;
}

/**
 * Parámetro que abre "Nueva cotización" con una unidad elegida (atajo
 * "Cotizar" del catálogo, propuesta DEC-049). Es solo una preselección: el
 * descuento, la validez y el envío los decide el vendedor en el drawer, y
 * createQuote() vuelve a validar todo.
 */
export const NEW_QUOTE_VEHICLE_PARAM = "quote";

/** Workspace de la oportunidad con "Nueva cotización" abierta para la unidad. */
export function newQuoteHref(opportunityId: string, vehicleId: string): string {
  return `${opportunityPath(opportunityId)}?${NEW_QUOTE_VEHICLE_PARAM}=${encodeURIComponent(vehicleId)}`;
}

/** Vista previa del presupuesto, dentro del workspace de la oportunidad. */
export function quoteDocumentPath(
  opportunityId: string,
  quoteId: string,
): string {
  return `${opportunityPath(opportunityId)}/quotes/${encodeURIComponent(quoteId)}`;
}

/** Descarga del PDF (GET /api/quotes/[quoteId]/pdf). */
export function quotePdfPath(quoteId: string): string {
  return `/api/quotes/${encodeURIComponent(quoteId)}/pdf`;
}
