import type { Stage } from "@/domains/opportunities/stages";

import { isQuotableStage, isQuoteExpired, type QuoteStatus } from "./statuses";

/*
 * ¿Se puede descargar el presupuesto en PDF? (Hito 14, DEC-046 §2). Módulo
 * puro y apto para el navegador: la UI lo usa para ofrecer o explicar el
 * botón "Descargar PDF", y el servidor (GET /api/quotes/[quoteId]/pdf) lo
 * vuelve a decidir sobre la fila que lee en la base antes de generar nada.
 *
 * El PDF es la forma de entregarle el presupuesto al cliente, así que exige
 * lo mismo que entregarlo (DEC-042 §2):
 *
 *   draft ─────────────── no: falta la aprobación humana (DEC-003, CLAUDE.md §2)
 *   approved | sent ───── sí, mientras esté vigente y su oportunidad abierta
 *   accepted ──────────── sí: es el registro de lo que aceptó el cliente
 *   rejected | withdrawn ─ no: ya no vale como oferta
 *
 * - "Vigente" es `valid_until` no anterior al día de Asunción (último día
 *   inclusive, DEC-042 §4). "Abierta" es `qualifying` o `negotiating`: las
 *   etapas en las que una cotización se aprueba o se envía.
 * - Una aceptada se descarga aunque haya pasado su validez o se haya cerrado
 *   la oportunidad: la validez se exigió al aceptarla y el documento queda
 *   como constancia de las condiciones aceptadas.
 * - Descargar no cambia nada: no marca la cotización como enviada ("Enviada"
 *   lo sigue marcando el vendedor, DEC-042 §6) ni le manda nada al cliente.
 */

/** Estados cuyo presupuesto se puede descargar (con las condiciones de arriba). */
export const EXPORTABLE_QUOTE_STATUSES = [
  "approved",
  "sent",
  "accepted",
] as const satisfies readonly QuoteStatus[];

/** Por qué no se descarga el PDF de una cotización. */
export const QUOTE_EXPORT_BLOCKS = [
  /** Todavía no pasó por la aprobación humana. */
  "draft",
  /** Abierta, pero pasó su `valid_until`. */
  "expired",
  /** Abierta, pero su oportunidad ya no está en calificación ni negociación. */
  "opportunity_closed",
  /** El cliente la rechazó. */
  "rejected",
  /** El equipo la anuló. */
  "withdrawn",
] as const;

export type QuoteExportBlock = (typeof QUOTE_EXPORT_BLOCKS)[number];

export type QuoteExportability =
  | Readonly<{ exportable: true }>
  | Readonly<{ exportable: false; reason: QuoteExportBlock }>;

/** Lo que decide si se descarga: el estado guardado, la validez y la etapa. */
export type QuoteExportTarget = Readonly<{
  status: QuoteStatus;
  /** Último día de validez, "AAAA-MM-DD". */
  validUntil: string;
  /** Etapa actual de su oportunidad. */
  opportunityStage: Stage;
}>;

export function isQuoteExportBlock(value: unknown): value is QuoteExportBlock {
  return (
    typeof value === "string" &&
    (QUOTE_EXPORT_BLOCKS as readonly string[]).includes(value)
  );
}

/**
 * Decide, sin tocar nada, si el PDF de la cotización se descarga en el día
 * `today` de Asunción ("AAAA-MM-DD").
 */
export function quoteExportability(
  target: QuoteExportTarget,
  today: string,
): QuoteExportability {
  switch (target.status) {
    case "draft":
    case "rejected":
    case "withdrawn":
      return { exportable: false, reason: target.status };
    case "accepted":
      return { exportable: true };
    case "approved":
    case "sent":
      if (isQuoteExpired(target.validUntil, today)) {
        return { exportable: false, reason: "expired" };
      }
      if (!isQuotableStage(target.opportunityStage)) {
        return { exportable: false, reason: "opportunity_closed" };
      }
      return { exportable: true };
  }
}

/** Copy (es-PY) de por qué no se descarga, junto al botón o en su lugar. */
export const QUOTE_EXPORT_BLOCK_LABELS: Readonly<
  Record<QuoteExportBlock, string>
> = {
  draft:
    "Aprobala para descargar el PDF: un borrador no se entrega al cliente.",
  expired:
    "Está vencida: el PDF ya no se descarga. Para ofrecerla otra vez, creá una cotización nueva.",
  opportunity_closed:
    "La oportunidad ya no está abierta: el PDF de esta cotización ya no se descarga.",
  rejected: "El cliente la rechazó: el PDF ya no se descarga.",
  withdrawn: "Está anulada: el PDF ya no se descarga.",
};

/** Sello de la vista previa de un presupuesto que no se puede entregar. */
export const QUOTE_PREVIEW_STAMPS: Readonly<Record<QuoteExportBlock, string>> =
  {
    draft: "Borrador",
    expired: "Vencida",
    opportunity_closed: "Oportunidad cerrada",
    rejected: "Rechazada",
    withdrawn: "Anulada",
  };
