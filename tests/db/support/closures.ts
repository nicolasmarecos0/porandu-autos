/*
 * Metadatos de cierre válidos (DEC-034) para armar escenarios: una fila
 * `won` o `lost` tiene que traerlos (CHECKs de 0010). Con los nombres de
 * Drizzle, para un UPDATE por el boundary, y en columnas de SQL, para un
 * INSERT con el superusuario.
 */

/** Una venta en dólares, entregada (columnas de Drizzle). */
export const WON_METADATA = {
  salePrice: "47500.00",
  saleCurrency: "USD",
  paymentMethod: "cash",
  deliveryStatus: "delivered",
  deliveryDate: "2026-10-01",
} as const;

/** Una pérdida por precio, sin notas (columnas de Drizzle). */
export const LOST_METADATA = {
  lossReason: "price",
  lossNotes: null,
} as const;

/** Las columnas del cierre en SQL, nulas: una oportunidad abierta. */
export const OPEN_COLUMNS = {
  loss_reason: null,
  loss_notes: null,
  sale_price: null,
  sale_currency: null,
  payment_method: null,
  delivery_status: null,
  delivery_date: null,
} as const;

/** Las columnas del cierre en SQL para una fila en `stage`. */
export function closureColumns(stage: string) {
  if (stage === "won") {
    return {
      ...OPEN_COLUMNS,
      sale_price: WON_METADATA.salePrice,
      sale_currency: WON_METADATA.saleCurrency,
      payment_method: WON_METADATA.paymentMethod,
      delivery_status: WON_METADATA.deliveryStatus,
      delivery_date: WON_METADATA.deliveryDate,
    };
  }
  if (stage === "lost") {
    return { ...OPEN_COLUMNS, loss_reason: LOST_METADATA.lossReason };
  }
  return OPEN_COLUMNS;
}
