import "server-only";

import { and, eq } from "drizzle-orm";

import { todayInAsuncion } from "@/domains/opportunities/closure";
import {
  buildQuoteDocument,
  type QuoteDocument,
  type QuoteDocumentSource,
} from "@/domains/quotes/document";
import {
  quoteCardView,
  quotesPanelData,
  type QuoteCardView,
  type QuoteRow,
} from "@/domains/quotes/presentation";
import { requireTenant } from "@/lib/tenant/session";

import {
  contacts,
  opportunities,
  organizations,
  quotes,
  vehicles,
} from "../schema";
import {
  withTenant,
  type ScopedTransaction,
  type TenantContext,
} from "../tenant";
import { stageFromDb } from "./opportunities";
import { selectOpportunityQuotes } from "./quotes";

/*
 * Lectura del presupuesto de una cotización (Hito 14, DEC-046 §5). Solo lee:
 * no hay escrituras, migraciones ni Server Actions nuevas. El PDF se arma en
 * cada pedido desde la fila de `quotes`, cuyas condiciones son inmutables
 * (DEC-042 §2): no se guarda el archivo ni un historial de descargas, porque
 * siempre se puede volver a generar igual.
 *
 *   Página /opportunities/[id]/quotes/[quoteId]:
 *     getQuoteDocumentPage() → requireTenant() → withTenant() → la
 *     cotización de esa oportunidad en la organización activa (con su
 *     cliente, su unidad y el concesionario) + las cotizaciones de la
 *     oportunidad (el maestro) → RLS → dominio → vista previa
 *
 *   GET /api/quotes/[quoteId]/pdf (lib/quotes/pdf-download.ts):
 *     resolveRequestTenant() → getQuotePdfSource(ctx) → withTenant() → la
 *     cotización en la organización activa → RLS → dominio → PDF
 *
 * - Toda lectura filtra por la organización del contexto (defensa en
 *   profundidad sobre RLS) y une cada tabla por las dos columnas de su FK
 *   compuesta (`organization_id` + id).
 * - Un id que no es UUID no llega a la base. Una cotización de otra
 *   organización (aun con membership activa en ella), de otra oportunidad o
 *   inexistente es null, sin revelar cuál.
 * - Leer no modifica nada: ni el estado de la cotización (descargar no la
 *   marca enviada, DEC-042 §6), ni `last_activity_at`, ni el stock.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** El id normalizado, o null si no es un UUID. */
export function readQuoteUuid(value: string): string | null {
  return UUID.test(value) ? value.toLowerCase() : null;
}

/** La fila de la cotización tal como la usan el panel y el documento. */
type QuoteDocumentRecord = Readonly<{
  opportunityId: string;
  row: QuoteRow;
  source: QuoteDocumentSource;
}>;

async function selectQuoteDocumentRecord(
  tx: ScopedTransaction,
  organizationId: string,
  quoteId: string,
  opportunityId: string | null,
): Promise<QuoteDocumentRecord | null> {
  const [found] = await tx
    .select({
      id: quotes.id,
      opportunityId: quotes.opportunityId,
      number: quotes.number,
      status: quotes.status,
      currency: quotes.currency,
      listPrice: quotes.listPrice,
      discountKind: quotes.discountKind,
      discountValue: quotes.discountValue,
      totalPrice: quotes.totalPrice,
      validUntil: quotes.validUntil,
      notes: quotes.notes,
      createdBy: quotes.createdBy,
      createdAt: quotes.createdAt,
      approvedBy: quotes.approvedBy,
      approvedAt: quotes.approvedAt,
      sentAt: quotes.sentAt,
      decidedAt: quotes.decidedAt,
      vehicleId: quotes.vehicleId,
      vehicleBrand: vehicles.brand,
      vehicleModel: vehicles.model,
      vehicleVersion: vehicles.version,
      vehicleYear: vehicles.year,
      vehicleKm: vehicles.km,
      vehicleStatus: vehicles.status,
      opportunityStage: opportunities.stage,
      customerName: contacts.name,
      customerCity: contacts.city,
      organizationName: organizations.name,
    })
    .from(quotes)
    .innerJoin(
      opportunities,
      and(
        eq(opportunities.organizationId, quotes.organizationId),
        eq(opportunities.id, quotes.opportunityId),
      ),
    )
    .innerJoin(
      contacts,
      and(
        eq(contacts.organizationId, opportunities.organizationId),
        eq(contacts.id, opportunities.contactId),
      ),
    )
    .innerJoin(
      vehicles,
      and(
        eq(vehicles.organizationId, quotes.organizationId),
        eq(vehicles.id, quotes.vehicleId),
      ),
    )
    .innerJoin(organizations, eq(organizations.id, quotes.organizationId))
    .where(
      and(
        eq(quotes.organizationId, organizationId),
        eq(quotes.id, quoteId),
        opportunityId === null
          ? undefined
          : eq(quotes.opportunityId, opportunityId),
      ),
    )
    .limit(1);
  if (!found) return null;

  const row: QuoteRow = {
    id: found.id,
    number: found.number,
    status: found.status,
    currency: found.currency,
    listPrice: found.listPrice,
    discountKind: found.discountKind,
    discountValue: found.discountValue,
    totalPrice: found.totalPrice,
    validUntil: found.validUntil,
    notes: found.notes,
    createdBy: found.createdBy,
    createdAt: found.createdAt,
    approvedBy: found.approvedBy,
    approvedAt: found.approvedAt,
    sentAt: found.sentAt,
    decidedAt: found.decidedAt,
    vehicleId: found.vehicleId,
    vehicleBrand: found.vehicleBrand,
    vehicleModel: found.vehicleModel,
    vehicleYear: found.vehicleYear,
    vehicleStatus: found.vehicleStatus,
  };
  const source: QuoteDocumentSource = {
    number: found.number,
    status: found.status,
    currency: found.currency,
    listPrice: found.listPrice,
    discountKind: found.discountKind,
    discountValue: found.discountValue,
    totalPrice: found.totalPrice,
    validUntil: found.validUntil,
    notes: found.notes,
    createdAt: found.createdAt,
    opportunityStage: stageFromDb[found.opportunityStage],
    organizationName: found.organizationName,
    customerName: found.customerName,
    customerCity: found.customerCity,
    vehicleBrand: found.vehicleBrand,
    vehicleModel: found.vehicleModel,
    vehicleVersion: found.vehicleVersion,
    vehicleYear: found.vehicleYear,
    vehicleKm: found.vehicleKm,
  };
  return { opportunityId: found.opportunityId, row, source };
}

/**
 * Lo que necesita el PDF de una cotización de la organización activa, o
 * null. `ctx` sale de resolveRequestTenant() en el Route Handler (DEC-040
 * §3): la misma cadena que requireTenant(), sin redirects.
 */
export async function getQuotePdfSource(
  ctx: TenantContext,
  quoteId: string,
): Promise<QuoteDocumentSource | null> {
  const id = readQuoteUuid(quoteId);
  if (!id) return null;
  const record = await withTenant(ctx, (tx) =>
    // Ya validado por withTenant(): un contexto emitido por Tenant Resolution.
    selectQuoteDocumentRecord(tx, ctx.organizationId, id, null),
  );
  return record?.source ?? null;
}

/** Lo que recibe la página del presupuesto. */
export type QuoteDocumentPage = Readonly<{
  opportunityId: string;
  /** Nombre del cliente: el encabezado y el "Volver". */
  contactName: string;
  /** La cotización, con su estado y las acciones que el que mira puede pedir. */
  quote: QuoteCardView;
  /** Las cotizaciones de la oportunidad, de la más reciente a la más vieja. */
  quotes: readonly QuoteCardView[];
  /** El presupuesto, armado igual que el PDF. */
  document: QuoteDocument;
}>;

/**
 * Loader de /opportunities/[id]/quotes/[quoteId]: null si la cotización no
 * es de esa oportunidad en la organización activa.
 */
export async function getQuoteDocumentPage(
  opportunityId: string,
  quoteId: string,
): Promise<QuoteDocumentPage | null> {
  const ctx = await requireTenant();
  const opportunity = readQuoteUuid(opportunityId);
  const id = readQuoteUuid(quoteId);
  if (!opportunity || !id) return null;

  const found = await withTenant(ctx, async (tx) => {
    const record = await selectQuoteDocumentRecord(
      tx,
      ctx.organizationId,
      id,
      opportunity,
    );
    if (!record) return null;
    const rows = await selectOpportunityQuotes(
      tx,
      ctx.organizationId,
      record.opportunityId,
    );
    return { record, rows };
  });
  if (!found) return null;

  const { record, rows } = found;
  const context = {
    viewerUserId: ctx.userId,
    viewerIsAdmin: ctx.role === "admin",
    opportunityStage: record.source.opportunityStage,
    linkedVehicleId: null,
    today: todayInAsuncion(new Date()),
  };
  return {
    opportunityId: record.opportunityId,
    contactName: record.source.customerName,
    quote: quoteCardView(record.row, context),
    quotes: quotesPanelData(rows, [], context).quotes,
    document: buildQuoteDocument(record.source),
  };
}
