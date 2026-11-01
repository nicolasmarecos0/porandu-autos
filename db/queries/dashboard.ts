import "server-only";

import { and, asc, eq, gte, inArray, isNotNull, lt, sql } from "drizzle-orm";
import { cache } from "react";

import { CALENDAR_TIME_ZONE } from "@/domains/calendar/test-drives";
import { calendarWeek } from "@/domains/calendar/week";
import { isoDate, zonedDate } from "@/domains/calendar/zoned-time";
import {
  buildConversion,
  buildPendingQuotes,
  buildWeekTestDrives,
} from "@/domains/dashboard/commercial";
import {
  AT_RISK_LIST_LIMIT,
  buildExecutiveDashboard,
  OPEN_STAGES,
  type AtRiskRows,
  type ExecutiveDashboard,
  type InventoryCounts,
  type OpportunityCounts,
} from "@/domains/dashboard/metrics";
import { DASHBOARD_TIME_ZONE } from "@/domains/dashboard/period";
import {
  rangeKey,
  resolveDashboardRange,
  type DashboardRange,
  type DashboardRangeResolution,
  type RangeSearchParams,
} from "@/domains/dashboard/range";
import { recencyCutoffs, type RecencyCutoffs } from "@/domains/scoring/engine";
import { requireTenant } from "@/lib/tenant/session";

import { contacts, opportunities, vehicles } from "../schema";
import { withTenant, type ScopedTransaction } from "../tenant";
import {
  selectClosedCounts,
  selectPendingQuoteCounts,
  selectWeekTestDriveCounts,
} from "./dashboard-commercial";
import { stageFromDb } from "./opportunities";

/*
 * Dashboard Directivo desde PostgreSQL (Hito 5, DEC-037; rango y KPIs
 * comerciales, DEC-043). Métricas en tiempo real: se agregan en la base en
 * cada request, sobre las tablas transaccionales. No hay tablas de métricas,
 * snapshots, vistas materializadas ni jobs, así que no hay nada que pueda
 * desincronizarse.
 *
 *   request → resolveDashboardRange() → requireTenant() → TenantContext →
 *   withTenant() → seis lecturas con filtro explícito por organización →
 *   RLS → dominio → ViewModel
 *
 * - requireTenant() valida en cada request la organización activa contra
 *   las memberships activas del usuario (DEC-021). El layout de (app) es solo
 *   un gate de UX: este loader pide su propio contexto.
 * - Las seis lecturas (DEC-043 §7) corren en serie en la misma transacción
 *   withTenant(), como `authenticated`: RLS deja ver solo organizaciones con
 *   membership activa. Cada una filtra por `ctx.organizationId` (defensa en
 *   profundidad, ADR-001 §2): con varias memberships activas, RLS deja ver
 *   todas sus organizaciones y el filtro deja solo la activa. Los joins
 *   (contactos y el agregado de vínculos de cada unidad) también igualan la
 *   organización.
 * - El rango (DEC-043 §2), la semana (DEC-041 §4) y los cortes de recencia
 *   (DEC-037 §8) los calcula el dominio con `now`; la base solo compara
 *   instantes, con límites exclusivos (`<`). Se ligan con operadores de
 *   columna (`gte`, `lt`) para que Drizzle los serialice como timestamptz:
 *   un Date crudo dentro de sql`` no se serializa con este driver.
 * - Caché (DEC-043 §6): ninguna compartida entre requests. Solo se memoriza
 *   dentro de una request (ver getExecutiveDashboard()).
 *
 * Solo lectura: no escribe nada, ni `last_activity_at`, ni `updated_at`, ni
 * el estado de las unidades, cotizaciones o pruebas de manejo.
 */

/**
 * Estado de hoy de las oportunidades (DEC-037 §8): activas, Enfriándose e
 * Inactivas. Una sola fila de COUNT(*) FILTER. Los cierres del rango los
 * cuenta selectClosedCounts() con su índice parcial.
 */
async function selectOpportunityCounts(
  tx: ScopedTransaction,
  organizationId: string,
  cutoffs: RecencyCutoffs,
): Promise<OpportunityCounts> {
  const open = inArray(opportunities.stage, [...OPEN_STAGES]);
  const [row] = await tx
    .select({
      open: sql<number>`count(*) filter (where ${open})`.mapWith(Number),
      warning: sql<number>`count(*) filter (where ${and(
        open,
        lt(opportunities.lastActivityAt, cutoffs.warningBefore),
        gte(opportunities.lastActivityAt, cutoffs.staleBefore),
      )})`.mapWith(Number),
      stale: sql<number>`count(*) filter (where ${and(
        open,
        lt(opportunities.lastActivityAt, cutoffs.staleBefore),
      )})`.mapWith(Number),
    })
    .from(opportunities)
    .where(eq(opportunities.organizationId, organizationId));
  return {
    open: row?.open ?? 0,
    warning: row?.warning ?? 0,
    stale: row?.stale ?? 0,
  };
}

/**
 * Inventario (DEC-037 §7): cada unidad de la organización con los vínculos
 * de sus oportunidades, agregados por unidad. Vendida si alguna oportunidad
 * vinculada está `won`; reservada si no y alguna está `negotiating`; en
 * stock el resto. `vehicles.status` no se consulta. En stock y reservadas
 * son estado de hoy; las vendidas son las cerradas en el rango (DEC-043 §2).
 */
async function selectInventoryCounts(
  tx: ScopedTransaction,
  organizationId: string,
  range: Pick<DashboardRange, "start" | "end">,
): Promise<InventoryCounts> {
  const links = tx
    .select({
      organizationId: opportunities.organizationId,
      vehicleId: opportunities.vehicleId,
      sold: sql<boolean>`bool_or(${eq(opportunities.stage, "won")})`.as("sold"),
      // Una oportunidad cerrada no vuelve a cambiar `updated_at`: es su
      // fecha de cierre (DEC-037 §5).
      soldInRange: sql<boolean>`bool_or(${and(
        eq(opportunities.stage, "won"),
        gte(opportunities.updatedAt, range.start),
        lt(opportunities.updatedAt, range.end),
      )})`.as("sold_in_range"),
      reserved:
        sql<boolean>`bool_or(${eq(opportunities.stage, "negotiating")})`.as(
          "reserved",
        ),
    })
    .from(opportunities)
    .where(
      and(
        eq(opportunities.organizationId, organizationId),
        isNotNull(opportunities.vehicleId),
      ),
    )
    .groupBy(opportunities.organizationId, opportunities.vehicleId)
    .as("vehicle_links");
  // El join iguala organización y unidad, como la FK compuesta. Sin
  // vínculos, el LEFT JOIN deja NULL: `is not true` lo cuenta en stock.
  const [row] = await tx
    .select({
      inStock:
        sql<number>`count(*) filter (where ${links.sold} is not true and ${links.reserved} is not true)`.mapWith(
          Number,
        ),
      reserved:
        sql<number>`count(*) filter (where ${links.sold} is not true and ${links.reserved})`.mapWith(
          Number,
        ),
      soldInRange:
        sql<number>`count(*) filter (where ${links.soldInRange})`.mapWith(
          Number,
        ),
    })
    .from(vehicles)
    .leftJoin(
      links,
      and(
        eq(links.organizationId, vehicles.organizationId),
        eq(links.vehicleId, vehicles.id),
      ),
    )
    .where(eq(vehicles.organizationId, organizationId));
  return {
    inStock: row?.inStock ?? 0,
    reserved: row?.reserved ?? 0,
    soldInRange: row?.soldInRange ?? 0,
  };
}

/**
 * Oportunidades en riesgo (DEC-037 §9): las abiertas Inactivas, de la más
 * vieja a la más reciente, con el total en la misma lectura (`count(*) over
 * ()`, antes del LIMIT). Solo el contacto, la etapa y la recencia.
 */
async function selectAtRiskOpportunities(
  tx: ScopedTransaction,
  organizationId: string,
  cutoffs: RecencyCutoffs,
): Promise<AtRiskRows> {
  const rows = await tx
    .select({
      id: opportunities.id,
      contactName: contacts.name,
      stage: opportunities.stage,
      lastActivityAt: opportunities.lastActivityAt,
      total: sql<number>`count(*) over ()`.mapWith(Number),
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
        inArray(opportunities.stage, [...OPEN_STAGES]),
        lt(opportunities.lastActivityAt, cutoffs.staleBefore),
      ),
    )
    .orderBy(asc(opportunities.lastActivityAt), asc(opportunities.id))
    .limit(AT_RISK_LIST_LIMIT);
  return {
    rows: rows.map((row) => ({
      id: row.id,
      contactName: row.contactName,
      stage: stageFromDb[row.stage],
      lastActivityAt: row.lastActivityAt,
    })),
    total: rows[0]?.total ?? 0,
  };
}

/**
 * Una lectura completa del dashboard: el contexto, las seis lecturas en una
 * sola transacción y el ViewModel.
 */
async function loadExecutiveDashboard(
  { range, notice }: DashboardRangeResolution,
  now: Date,
): Promise<ExecutiveDashboard> {
  const ctx = await requireTenant();
  const cutoffs = recencyCutoffs(now);
  // Hoy en Asunción: la vigencia de una cotización incluye su último día
  // (DEC-042 §4).
  const today = isoDate(zonedDate(now, DASHBOARD_TIME_ZONE));
  // La semana de hoy, con la misma función y zona que /calendar (DEC-041
  // §4): la tarjeta enlaza a esa misma semana.
  const week = calendarWeek(undefined, now, CALENDAR_TIME_ZONE);

  const reads = await withTenant(ctx, async (tx) => {
    const { organizationId } = ctx;
    // En serie: una transacción es una sola conexión.
    const closed = await selectClosedCounts(tx, organizationId, range);
    const quotes = await selectPendingQuoteCounts(tx, organizationId, today);
    const testDrives = await selectWeekTestDriveCounts(
      tx,
      organizationId,
      week,
    );
    const opportunityCounts = await selectOpportunityCounts(
      tx,
      organizationId,
      cutoffs,
    );
    const inventoryCounts = await selectInventoryCounts(
      tx,
      organizationId,
      range,
    );
    const atRisk = await selectAtRiskOpportunities(tx, organizationId, cutoffs);
    return {
      closed,
      quotes,
      testDrives,
      opportunityCounts,
      inventoryCounts,
      atRisk,
    };
  });

  return buildExecutiveDashboard({
    range,
    notice,
    today,
    conversion: buildConversion(reads.closed.won, reads.closed.lost),
    pendingQuotes: buildPendingQuotes(reads.quotes),
    weekTestDrives: buildWeekTestDrives(reads.testDrives, week),
    opportunities: reads.opportunityCounts,
    inventory: reads.inventoryCounts,
    atRisk: reads.atRisk,
    now,
  });
}

/*
 * Memoización por request (DEC-043 §6). `cache()` de React guarda un valor
 * por request de Server Components y lo descarta al terminarla: no es una
 * caché compartida entre requests, usuarios ni organizaciones. Como compara
 * argumentos por identidad, las claves son primitivas:
 *
 * - requestNow(): el instante de la request, el mismo para todo lo que lo
 *   pida en ella (sin él, dos llamadas con un milisegundo de diferencia
 *   serían dos lecturas).
 * - requestDashboards(): un Map por request, con clave `rangeKey()` + el
 *   aviso + el instante. Dos Server Components que piden el mismo rango
 *   comparten una sola transacción.
 *
 * Fuera de un render (tests, Server Actions) `cache()` no memoriza: cada
 * llamada vuelve a leer.
 */
const requestNow = cache((): Date => new Date());

const requestDashboards = cache(
  (): Map<string, Promise<ExecutiveDashboard>> => new Map(),
);

/**
 * Loader de /intelligence: el Dashboard Directivo de la organización activa
 * para el rango que piden los `searchParams` (input no confiable: un rango
 * inválido cae al mes en curso con un aviso, nunca a un error).
 */
export async function getExecutiveDashboard(
  params: RangeSearchParams = {},
  now: Date = requestNow(),
): Promise<ExecutiveDashboard> {
  const resolution = resolveDashboardRange(params, now, DASHBOARD_TIME_ZONE);
  const key = `${rangeKey(resolution.range)}|${resolution.notice ?? ""}|${now.getTime()}`;
  const dashboards = requestDashboards();
  const memoized = dashboards.get(key);
  if (memoized) return memoized;
  const pending = loadExecutiveDashboard(resolution, now);
  dashboards.set(key, pending);
  return pending;
}
