import { handleQuotePdf } from "@/lib/quotes/pdf-download";

/*
 * GET /api/quotes/[quoteId]/pdf (Hito 14, DEC-046 §5): descarga del
 * presupuesto de una cotización aprobada. Solo compone: el tenant, la regla
 * de exportación, el documento y el PDF viven en lib/quotes/pdf-download.ts.
 */

// La conexión de runtime (postgres) y pdf-lib necesitan Node.
export const runtime = "nodejs";

export async function GET(
  _request: Request,
  context: RouteContext<"/api/quotes/[quoteId]/pdf">,
): Promise<Response> {
  const { quoteId } = await context.params;
  return handleQuotePdf(quoteId);
}
