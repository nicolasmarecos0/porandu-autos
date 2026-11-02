import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { QuoteDocumentView } from "@/components/quotes/quote-document-view";
import { getQuoteDocumentPage } from "@/db/queries/quote-document";
import { QUOTE_DOCUMENT_HEADING } from "@/domains/quotes/document";

export const metadata: Metadata = { title: QUOTE_DOCUMENT_HEADING };

/*
 * Presupuesto de una cotización (Hito 14, DEC-046 §6): la vista previa de
 * lo que se entrega al cliente, con sus acciones y la descarga del PDF.
 * Loader tenant-scoped: requireTenant() → withTenant() → RLS. Un id
 * inválido, una cotización de otra oportunidad, de otra organización o
 * inexistente da notFound(), sin distinguir cuál.
 */
export default async function QuoteDocumentPage({
  params,
}: PageProps<"/opportunities/[id]/quotes/[quoteId]">) {
  const { id, quoteId } = await params;
  const page = await getQuoteDocumentPage(id, quoteId);
  if (!page) notFound();
  return <QuoteDocumentView {...page} />;
}
