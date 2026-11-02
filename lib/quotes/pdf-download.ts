import "server-only";

import { getQuotePdfSource } from "@/db/queries/quote-document";
import type { QuoteDocumentSource } from "@/domains/quotes/document";
import { buildQuoteDocument } from "@/domains/quotes/document";
import {
  quoteExportability,
  type QuoteExportBlock,
} from "@/domains/quotes/exportability";
import { todayInAsuncion } from "@/domains/opportunities/closure";
import { resolveRequestTenant } from "@/lib/tenant/session";

import { renderQuotePdf } from "./pdf";

/*
 * GET /api/quotes/[quoteId]/pdf (Hito 14, DEC-046 §5): la única puerta de
 * la descarga del presupuesto en PDF.
 *
 *   resolveRequestTenant() (sin usuario 401, sin organización resuelta 403)
 *   → getQuotePdfSource(): la cotización en la organización activa, con su
 *   cliente, su unidad y el concesionario (404) → quoteExportability() con
 *   el día de Asunción del pedido (409) → buildQuoteDocument() →
 *   renderQuotePdf() → 200 application/pdf
 *
 * 1. Cualquier membership activa descarga cualquier cotización de su
 *    organización (DEC-023: sin responsable asignado), como la ve en
 *    /opportunities/[id].
 * 2. La regla de la aprobación humana (CLAUDE.md §2, DEC-042 §2) la decide
 *    el servidor sobre la fila de la base, no la UI: un borrador, una
 *    vencida, una anulada o rechazada, o una de una oportunidad cerrada
 *    responde 409 con el motivo y no se genera nada.
 * 3. Solo lee: no marca la cotización como enviada ni le manda nada al
 *    cliente (DEC-042 §6). Por eso es un GET y no necesita revalidar.
 * 4. El PDF se genera en el servidor con lo que dice la base: lo que se
 *    entrega no depende de lo que mostró el navegador.
 * 5. `Cache-Control: private, no-store`: un presupuesto tiene datos del
 *    cliente y no queda en ninguna caché compartida. El nombre del archivo
 *    es ASCII (buildQuoteDocument()), así que va entre comillas sin escapar.
 * 6. Los logs registran solo el tipo de error y el SQLSTATE: nunca ids,
 *    montos, nombres ni el contenido.
 */

export type QuotePdfError =
  "unauthenticated" | "forbidden" | "not_found" | "not_exportable" | "failed";

/** Cuerpo de una respuesta de error (JSON). */
export type QuotePdfErrorBody =
  | Readonly<{ error: Exclude<QuotePdfError, "not_exportable"> }>
  | Readonly<{ error: "not_exportable"; reason: QuoteExportBlock }>;

function failure(status: number, body: QuotePdfErrorBody): Response {
  return Response.json(body, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

/*
 * Solo el tipo de error y el SQLSTATE: el mensaje de Drizzle incluye la
 * query y sus parámetros.
 */
function logFailure(stage: "read" | "render", error: unknown): void {
  const { name, cause } =
    error instanceof Error ? error : { name: undefined, cause: undefined };
  const code =
    typeof cause === "object" && cause !== null && "code" in cause
      ? cause.code
      : undefined;
  console.error(`[quotes] pdf ${stage} failed`, { name, code });
}

export async function handleQuotePdf(quoteId: string): Promise<Response> {
  const tenant = await resolveRequestTenant();
  if (tenant.kind === "unauthenticated") {
    return failure(401, { error: "unauthenticated" });
  }
  if (tenant.kind !== "resolved") return failure(403, { error: "forbidden" });

  let source: QuoteDocumentSource | null;
  try {
    source = await getQuotePdfSource(tenant.context, quoteId);
  } catch (error) {
    logFailure("read", error);
    return failure(500, { error: "failed" });
  }
  if (!source) return failure(404, { error: "not_found" });

  // "Hoy" de Asunción, fijado al recibir el pedido: decide la validez.
  const exportability = quoteExportability(source, todayInAsuncion(new Date()));
  if (!exportability.exportable) {
    return failure(409, {
      error: "not_exportable",
      reason: exportability.reason,
    });
  }

  const document = buildQuoteDocument(source);
  let bytes: Uint8Array;
  try {
    bytes = await renderQuotePdf(document);
  } catch (error) {
    logFailure("render", error);
    return failure(500, { error: "failed" });
  }

  return new Response(new Uint8Array(bytes), {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${document.fileName}"`,
      "Content-Length": String(bytes.byteLength),
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
