import "server-only";

import { and, asc, count, desc, eq, inArray, sql } from "drizzle-orm";

import { QUOTABLE_STAGES } from "@/domains/quotes/statuses";
import {
  CATALOG_STATUSES,
  quotableStage,
  toCatalogVehicle,
  type CatalogVehicle,
  type QuoteCustomerOption,
} from "@/domains/vehicles/catalog";
import { requireTenant } from "@/lib/tenant/session";

import { contacts, opportunities, vehicles } from "../schema";
import { withTenant, type ScopedTransaction } from "../tenant";
import { toStockVehicle } from "./vehicles";

/*
 * Catálogo visual del stock (propuesta DEC-049). Solo lee:
 *
 *   request → requireTenant() → TenantContext → withTenant() → tres
 *   lecturas acotadas en la misma transacción, filtradas por la
 *   organización activa → RLS → ViewModel del catálogo
 *
 *   1. Conteo por estado de todas las unidades de la organización: el
 *      total del catálogo (disponibles, reservadas y vendidas) y cuántas
 *      están en preparación, que no se muestran pero se nombran
 *      (DEC-025 §8).
 *   2. Las unidades del catálogo, a lo sumo CATALOG_VEHICLE_LIMIT: primero
 *      las que siguen en stock y después las vendidas, cada grupo del
 *      ingreso más reciente al más viejo (DEC-025 §7), a igual ingreso por
 *      id. Si una organización supera el tope, lo que queda afuera son las
 *      vendidas más viejas, nunca el stock que se puede mostrar.
 *   3. Los clientes a los que se puede cotizar (DEC-042 §1): las
 *      oportunidades En calificación o En negociación con su contacto (por
 *      las dos columnas de la FK compuesta), de la actividad más reciente a
 *      la más vieja, a lo sumo QUOTE_CUSTOMER_LIMIT. Son solo opciones del
 *      atajo "Cotizar": la cotización la crea createQuote() en la
 *      oportunidad, que vuelve a validar todo.
 *
 * Cada lectura filtra por `organization_id` además de RLS (ADR-001 §2: con
 * varias memberships activas, RLS deja ver todas y el filtro deja solo la
 * activa). Los filtros del catálogo (estado, marca y búsqueda) no van a la
 * base: los aplica domains/vehicles/catalog.ts sobre estas unidades, en el
 * servidor para el primer render y en el navegador en cada cambio.
 *
 * Leer no cambia nada: ni estados, ni `updated_at`, ni `last_activity_at`.
 * Sin caché compartida entre requests (DEC-043 §6). Sin fixtures: el
 * catálogo, como la Stock List, solo sale de PostgreSQL (DEC-025 §12).
 */

/** Tope de unidades del catálogo por request (defensivo: el lote es chico). */
export const CATALOG_VEHICLE_LIMIT = 1000;

/** Tope de clientes del atajo "Cotizar", como los selects de la agenda. */
export const QUOTE_CUSTOMER_LIMIT = 200;

export type StockCatalog = Readonly<{
  /** Unidades del catálogo, en el orden del loader. */
  vehicles: readonly CatalogVehicle[];
  /** Unidades del catálogo en la base, antes del tope. */
  total: number;
  /** Unidades en preparación: no se muestran en el catálogo. */
  inPreparation: number;
  /** Oportunidades a las que se les puede cotizar una unidad. */
  quoteCustomers: readonly QuoteCustomerOption[];
}>;

/** 1. Unidades por estado de la organización activa. */
async function selectStatusCounts(
  tx: ScopedTransaction,
  organizationId: string,
): Promise<Readonly<{ total: number; inPreparation: number }>> {
  const rows = await tx
    .select({ status: vehicles.status, count: count() })
    .from(vehicles)
    .where(eq(vehicles.organizationId, organizationId))
    .groupBy(vehicles.status);
  let total = 0;
  let inPreparation = 0;
  for (const row of rows) {
    if (row.status === "in_preparation") inPreparation += row.count;
    else total += row.count;
  }
  return { total, inPreparation };
}

/** 2. Las unidades del catálogo, con el tope. */
async function selectCatalogVehicles(
  tx: ScopedTransaction,
  organizationId: string,
): Promise<CatalogVehicle[]> {
  const rows = await tx
    .select({
      id: vehicles.id,
      brand: vehicles.brand,
      model: vehicles.model,
      version: vehicles.version,
      year: vehicles.year,
      km: vehicles.km,
      price: vehicles.price,
      currency: vehicles.currency,
      status: vehicles.status,
    })
    .from(vehicles)
    .where(
      and(
        eq(vehicles.organizationId, organizationId),
        inArray(vehicles.status, [...CATALOG_STATUSES]),
      ),
    )
    // `false` va antes que `true`: el stock primero, las vendidas al final.
    .orderBy(
      sql`${vehicles.status} = 'sold'`,
      desc(vehicles.createdAt),
      asc(vehicles.id),
    )
    .limit(CATALOG_VEHICLE_LIMIT);
  return rows.flatMap((row) => {
    const vehicle = toCatalogVehicle(toStockVehicle(row));
    return vehicle ? [vehicle] : [];
  });
}

/** 3. Las oportunidades a las que se les puede cotizar. */
async function selectQuoteCustomers(
  tx: ScopedTransaction,
  organizationId: string,
): Promise<QuoteCustomerOption[]> {
  const rows = await tx
    .select({
      opportunityId: opportunities.id,
      contactName: contacts.name,
      stage: opportunities.stage,
    })
    .from(opportunities)
    .innerJoin(
      contacts,
      and(
        eq(contacts.organizationId, opportunities.organizationId),
        eq(contacts.id, opportunities.contactId),
      ),
    )
    .where(
      and(
        eq(opportunities.organizationId, organizationId),
        inArray(opportunities.stage, [...QUOTABLE_STAGES]),
      ),
    )
    .orderBy(desc(opportunities.lastActivityAt), desc(opportunities.id))
    .limit(QUOTE_CUSTOMER_LIMIT);
  return rows.flatMap(({ opportunityId, contactName, stage }) => {
    const quotable = quotableStage(stage);
    return quotable ? [{ opportunityId, contactName, stage: quotable }] : [];
  });
}

/** Loader de /stock/catalog. */
export async function getStockCatalog(): Promise<StockCatalog> {
  const ctx = await requireTenant();
  return withTenant(ctx, async (tx) => {
    const { organizationId } = ctx;
    const counts = await selectStatusCounts(tx, organizationId);
    const catalog = await selectCatalogVehicles(tx, organizationId);
    const quoteCustomers = await selectQuoteCustomers(tx, organizationId);
    return {
      vehicles: catalog,
      total: counts.total,
      inPreparation: counts.inPreparation,
      quoteCustomers,
    };
  });
}
