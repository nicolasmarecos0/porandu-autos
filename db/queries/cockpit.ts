import "server-only";

import { and, desc, eq, gt, gte, inArray, lt, lte, ne, sql } from "drizzle-orm";

import { OPEN_TEST_DRIVE_STATUSES } from "@/domains/calendar/test-drives";
import {
  cockpitFeed,
  type CockpitFeed,
  type CockpitNoteRow,
  type CockpitQuoteRow,
  type CockpitTestDriveRow,
  type FeedSource,
} from "@/domains/cockpit/feed";
import {
  cockpitWindow,
  RECENT_EVENT_LIMIT,
  UPCOMING_TEST_DRIVE_LIMIT,
} from "@/domains/cockpit/window";
import { requireTenant } from "@/lib/tenant/session";

import {
  contacts,
  opportunities,
  opportunityNotes,
  quotes,
  testDrives,
  vehicles,
} from "../schema";
import {
  withTenant,
  type ScopedTransaction,
  type TenantContext,
} from "../tenant";
import { selectUnreadConversations } from "./conversation-reads";

/*
 * Feed del Cockpit (Hito 15, DEC-047). Solo lee:
 *
 *   request → requireTenant() → TenantContext → withTenant() → cinco
 *   lecturas acotadas en la misma transacción, filtradas por la organización
 *   activa → RLS → domains/cockpit/feed.ts (mezcla y orden) → ViewModel
 *
 * Por qué cinco lecturas y no un UNION ALL (DEC-047 §2): cada fuente tiene
 * su forma (un chat sin leer es un agregado por conversación con la regla
 * del leído por miembro; una cotización, una fila con su oportunidad y su
 * unidad), su índice y su orden (las próximas pruebas van de la más cercana
 * a la más lejana; el resto, de la más nueva a la más vieja). Un UNION ALL
 * obligaría a una proyección común de columnas nulas o jsonb, sin tipos de
 * Drizzle, y la base igual tendría que cortar cada rama con su propio LIMIT
 * para no ordenar todo. Acá cada lectura usa su índice y corta en su tope, y
 * el dominio mezcla a lo sumo 4 × RECENT_EVENT_LIMIT filas en memoria.
 *
 *   1. Chats sin leer de quien mira (selectUnreadConversations(), con la
 *      regla de DEC-044 §2) · índice parcial de messages
 *      (organization_id, conversation_id, created_at) y la PK de
 *      conversation_reads.
 *   2. Próximas pruebas: abiertas, con la franja en curso o por venir hasta
 *      el fin de mañana, de la más cercana a la más lejana · índice
 *      test_drives (organization_id, scheduled_at).
 *   3. Pruebas vencidas: abiertas, con la franja terminada, de los últimos
 *      siete días · el mismo índice.
 *   4. Cotizaciones movidas en los últimos siete días (alta o cambio de
 *      estado: `updated_at`, que fija el trigger) · filtro por organización.
 *   5. Notas de otros miembros de los últimos siete días · filtro por
 *      organización.
 *
 * Cada lectura reciente ordena por (instante al milisegundo desc, id desc) y
 * corta en RECENT_EVENT_LIMIT: es el orden del dominio, que así mezcla
 * exacto. Cada una trae su total (`count(*) over ()`, antes del LIMIT) para
 * la franja y para decir cuánto no se muestra.
 *
 * Cada tabla unida lo hace por las dos columnas de su FK compuesta
 * (organization_id, id): una fila nunca se cruza con otra organización,
 * aunque RLS ya lo impide.
 *
 * Leer no cambia nada: no marca conversaciones como vistas, no toca
 * `last_activity_at` ni estados. Sin caché compartida entre requests
 * (DEC-043 §6): la página es dinámica (lee cookies) y cada request lee el
 * último dato confirmado.
 */

const OPEN_TEST_DRIVES = [...OPEN_TEST_DRIVE_STATUSES];

/** Las columnas de una prueba de manejo con su cliente y su unidad. */
function testDriveColumns() {
  return {
    id: testDrives.id,
    status: testDrives.status,
    scheduledAt: testDrives.scheduledAt,
    opportunityId: testDrives.opportunityId,
    contactName: contacts.name,
    vehicleBrand: vehicles.brand,
    vehicleModel: vehicles.model,
    vehicleYear: vehicles.year,
    total: sql<number>`count(*) over ()`.mapWith(Number),
  };
}

type TestDriveRange = Readonly<{
  /** Límite inferior; `inclusive: false` lo excluye. */
  from: Date;
  fromInclusive: boolean;
  /** Límite superior; `inclusive: true` lo incluye. */
  until: Date;
  untilInclusive: boolean;
  order: "asc" | "desc";
  limit: number;
}>;

/** Pruebas abiertas de la organización activa en un rango de `scheduled_at`. */
async function selectOpenTestDrives(
  tx: ScopedTransaction,
  ctx: TenantContext,
  range: TestDriveRange,
): Promise<FeedSource<CockpitTestDriveRow>> {
  const rows = await tx
    .select(testDriveColumns())
    .from(testDrives)
    .innerJoin(
      opportunities,
      and(
        eq(opportunities.organizationId, testDrives.organizationId),
        eq(opportunities.id, testDrives.opportunityId),
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
        eq(vehicles.organizationId, testDrives.organizationId),
        eq(vehicles.id, testDrives.vehicleId),
      ),
    )
    .where(
      and(
        eq(testDrives.organizationId, ctx.organizationId),
        inArray(testDrives.status, OPEN_TEST_DRIVES),
        range.fromInclusive
          ? gte(testDrives.scheduledAt, range.from)
          : gt(testDrives.scheduledAt, range.from),
        range.untilInclusive
          ? lte(testDrives.scheduledAt, range.until)
          : lt(testDrives.scheduledAt, range.until),
      ),
    )
    .orderBy(
      range.order === "asc"
        ? sql`date_trunc('milliseconds', ${testDrives.scheduledAt}) ASC`
        : sql`date_trunc('milliseconds', ${testDrives.scheduledAt}) DESC`,
      range.order === "asc" ? testDrives.id : desc(testDrives.id),
    )
    .limit(range.limit);

  return {
    rows,
    total: rows[0]?.total ?? 0,
  };
}

/** Cotizaciones de la organización activa movidas desde `from`. */
async function selectRecentQuotes(
  tx: ScopedTransaction,
  ctx: TenantContext,
  from: Date,
): Promise<FeedSource<CockpitQuoteRow>> {
  const rows = await tx
    .select({
      id: quotes.id,
      number: quotes.number,
      status: quotes.status,
      validUntil: quotes.validUntil,
      currency: quotes.currency,
      totalPrice: quotes.totalPrice,
      updatedAt: quotes.updatedAt,
      opportunityId: quotes.opportunityId,
      opportunityStage: opportunities.stage,
      contactName: contacts.name,
      vehicleBrand: vehicles.brand,
      vehicleModel: vehicles.model,
      vehicleYear: vehicles.year,
      total: sql<number>`count(*) over ()`.mapWith(Number),
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
    .where(
      and(
        eq(quotes.organizationId, ctx.organizationId),
        gte(quotes.updatedAt, from),
      ),
    )
    .orderBy(
      sql`date_trunc('milliseconds', ${quotes.updatedAt}) DESC`,
      desc(quotes.id),
    )
    .limit(RECENT_EVENT_LIMIT);

  return {
    rows,
    total: rows[0]?.total ?? 0,
  };
}

/** Notas de la bitácora de otros miembros registradas desde `from`. */
async function selectTeamNotes(
  tx: ScopedTransaction,
  ctx: TenantContext,
  from: Date,
): Promise<FeedSource<CockpitNoteRow>> {
  const rows = await tx
    .select({
      id: opportunityNotes.id,
      opportunityId: opportunityNotes.opportunityId,
      contactName: contacts.name,
      body: opportunityNotes.body,
      recordedAt: opportunityNotes.recordedAt,
      total: sql<number>`count(*) over ()`.mapWith(Number),
    })
    .from(opportunityNotes)
    .innerJoin(
      opportunities,
      and(
        eq(opportunities.organizationId, opportunityNotes.organizationId),
        eq(opportunities.id, opportunityNotes.opportunityId),
      ),
    )
    .innerJoin(
      contacts,
      and(
        eq(contacts.organizationId, opportunities.organizationId),
        eq(contacts.id, opportunities.contactId),
      ),
    )
    .where(
      and(
        eq(opportunityNotes.organizationId, ctx.organizationId),
        gte(opportunityNotes.recordedAt, from),
        // Las propias no son novedad para quien mira.
        ne(opportunityNotes.recordedBy, ctx.userId),
      ),
    )
    .orderBy(
      sql`date_trunc('milliseconds', ${opportunityNotes.recordedAt}) DESC`,
      desc(opportunityNotes.id),
    )
    .limit(RECENT_EVENT_LIMIT);

  return {
    rows,
    total: rows[0]?.total ?? 0,
  };
}

/**
 * Loader de /cockpit. `now` es el instante de la request: fija la ventana
 * (domains/cockpit/window.ts) y rotula "Hoy", "Ayer" y "Mañana".
 */
export async function getCockpitFeed(
  now: Date = new Date(),
): Promise<CockpitFeed> {
  const ctx = await requireTenant();
  const window = cockpitWindow(now);

  return withTenant(ctx, async (tx) => {
    const unreadConversations = await selectUnreadConversations(
      tx,
      ctx,
      RECENT_EVENT_LIMIT,
    );
    // Franja en curso o por venir: después de la frontera (exclusiva),
    // hasta el fin de mañana (exclusivo).
    const upcomingTestDrives = await selectOpenTestDrives(tx, ctx, {
      from: window.upcomingFrom,
      fromInclusive: false,
      until: window.upcomingUntil,
      untilInclusive: false,
      order: "asc",
      limit: UPCOMING_TEST_DRIVE_LIMIT,
    });
    // Franja terminada: desde el inicio de la ventana reciente hasta la
    // frontera, inclusive. Las dos lecturas no se pisan ni dejan huecos.
    const overdueTestDrives = await selectOpenTestDrives(tx, ctx, {
      from: window.recentFrom,
      fromInclusive: true,
      until: window.upcomingFrom,
      untilInclusive: true,
      order: "desc",
      limit: RECENT_EVENT_LIMIT,
    });
    const recentQuotes = await selectRecentQuotes(tx, ctx, window.recentFrom);
    const notes = await selectTeamNotes(tx, ctx, window.recentFrom);

    return cockpitFeed(
      {
        unreadConversations,
        upcomingTestDrives,
        overdueTestDrives,
        quotes: recentQuotes,
        notes,
      },
      window,
    );
  });
}
