/*
 * Respuesta de la Server Action markConversationRead() (Hito 12B, DEC-044
 * §2.7). El historial no la muestra: marcar visto no es crítico. No expone
 * la base: ni SQLSTATE, ni constraints, ni datos de otra organización.
 */
export type MarkConversationReadState =
  /** El cursor avanzó hasta el mensaje: /conversations se revalidó. */
  | Readonly<{ status: "marked" }>
  /** Ya estaba en ese mensaje o más adelante: no se escribió nada. */
  | Readonly<{ status: "unchanged" }>
  /**
   * Pedido inválido, o conversación cerrada, de otra organización o con un
   * mensaje ajeno, sin distinguir: no se escribió nada.
   */
  | Readonly<{ status: "ignored" }>
  /** Falla inesperada: no se escribió nada y se reintenta más adelante. */
  | Readonly<{ status: "failed" }>;
