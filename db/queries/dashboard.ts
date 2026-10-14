import "server-only";

import { and, asc, eq, gte, inArray, isNotNull, lt, sql } from "drizzle-orm";

import {
  AT_RISK_LIST_LIMIT,
  buildExecutiveDashboard,
  OPEN_STAGES,
  type AtRiskRows,
  type ExecutiveDashboard,
  type InventoryCounts,
  type OpportunityCounts,
} from "@/domains/dashboard/metrics";
import {
  DASHBOARD_TIME_ZONE,
  monthLabel,
  monthWindow,
  type MonthWindow,
} from "@/domains/dashboard/period";
import { recencyCutoffs, type RecencyCutoffs } from "@/domains/scoring/engine";
import { requireTenant } from "@/lib/tenant/session";

import { contacts, opportunities, vehicles } from "../schema";
import { withTenant, type ScopedTransaction } from "../tenant";
import { stageFromDb } from "./opportunities";

/*
 * Dashboard Directivo desde PostgreSQL (Hito 5, DEC-037). Métricas en tiempo
 * real: se agregan en la base en cada request, sobre las tablas
 * transaccionales. No hay tablas de métricas, snapshots, vistas
 * materializadas ni jobs, así que no hay nada que pueda desincronizarse.
 *
 *   request → requireTenant() → TenantContext → withTenant() → conteos con
 *   filtro explícito por organización → RLS → dominio → ViewModel
 *
 * - requireTenant() valida en cada request la organización activa contra
 *   las memberships activas del usuario (DEC-021). El layout de (app) es solo
 *   un gate de UX: este loader pide su propio contexto.
 * - Las tres lecturas corren en la misma transacción withTenant(), como
 *   `authenticated`: RLS deja ver solo organizaciones con membership activa.
 * - Cada una filtra por `ctx.organizationId` (defensa en profundidad, ADR-001
 *   §2): con varias memberships activas, RLS deja ver todas sus
 *   organizaciones y el filtro deja solo la activa. Los joins (contactos y
 *   el agregado de vínculos de cada unidad) también igualan la organización.
 * - El mes (DEC-037 §4) y los cortes de recencia (DEC-037 §8) los calcula el
 *   dominio con `now`; la base solo compara instantes, con límites
 *   exclusivos (`<`). Se ligan con operadores de columna (`gte`, `lt`) para
 *   que Drizzle los serialice como timestamptz: un Date crudo dentro de
 *   sql`` no se serializa con este driver.
 *
 * Solo lectura: no escribe nada, ni `last_activity_at`, ni `updated_at`, ni
 * el estado de las unidades.
 */

/** Una sola fila de conteos: COUNT(*) FILTER sobre las oportunidades. */
async function selectOpportunityCounts(
  tx: ScopedTransaction,
  organizationId: string,
  month: MonthWindow,
  cutoffs: RecencyCutoffs,
): Promise<OpportunityCounts> {
  const open = inArray(opportunities.stage, [...OPEN_STAGES]);
  // Una oportunidad cerrada no vuelve a cambiar `updated_at`: es su fecha de
  // cierre (DEC-037 §5).
  const closedInMonth = (stage: "won" | "lost") =>
    and(
      eq(opportunities.stage, stage),
      gte(opportunities.updatedAt, month.start),
      lt(opportunities.updatedAt, month.end),
    );
  const [row] = await tx
    .select({
      open: sql<number>`count(*) filter (where ${open})`.mapWith(Number),
      wonInMonth:
        sql<number>`count(*) filter (where ${closedInMonth("won")})`.mapWith(
          Number,
        ),
      lostInMonth:
        sql<number>`count(*) filter (where ${closedInMonth("lost")})`.mapWith(
          Number,
        ),
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
    wonInMonth: row?.wonInMonth ?? 0,
    lostInMonth: row?.lostInMonth ?? 0,
    warning: row?.warning ?? 0,
    stale: row?.stale ?? 0,
  };
}

/**
 * Inventario (DEC-037 §7): cada unidad de la organización con los vínculos
 * de sus oportunidades, agregados por unidad. Vendida si alguna oportunidad
 * vinculada está `won`; reservada si no y alguna está `negotiating`; en
 * stock el resto. `vehicles.status` no se consulta.
 */
async function selectInventoryCounts(
  tx: ScopedTransaction,
  organizationId: string,
  month: MonthWindow,
): Promise<InventoryCounts> {
  const links = tx
    .select({
      organizationId: opportunities.organizationId,
      vehicleId: opportunities.vehicleId,
      sold: sql<boolean>`bool_or(${eq(opportunities.stage, "won")})`.as("sold"),
      soldInMonth: sql<boolean>`bool_or(${and(
        eq(opportunities.stage, "won"),
        gte(opportunities.updatedAt, month.start),
        lt(opportunities.updatedAt, month.end),
      )})`.as("sold_in_month"),
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
      soldInMonth:
        sql<number>`count(*) filter (where ${links.soldInMonth})`.mapWith(
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
    soldInMonth: row?.soldInMonth ?? 0,
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

/** Loader de /intelligence: el Dashboard Directivo de la organización activa. */
export async function getExecutiveDashboard(
  now: Date = new Date(),
): Promise<ExecutiveDashboard> {
  const ctx = await requireTenant();
  const month = monthWindow(now, DASHBOARD_TIME_ZONE);
  const cutoffs = recencyCutoffs(now);
  const { opportunityCounts, inventoryCounts, atRisk } = await withTenant(
    ctx,
    async (tx) => {
      const opportunityCounts = await selectOpportunityCounts(
        tx,
        ctx.organizationId,
        month,
        cutoffs,
      );
      const inventoryCounts = await selectInventoryCounts(
        tx,
        ctx.organizationId,
        month,
      );
      const atRisk = await selectAtRiskOpportunities(
        tx,
        ctx.organizationId,
        cutoffs,
      );
      return { opportunityCounts, inventoryCounts, atRisk };
    },
  );
  return buildExecutiveDashboard({
    periodLabel: monthLabel(now, DASHBOARD_TIME_ZONE),
    opportunities: opportunityCounts,
    inventory: inventoryCounts,
    atRisk,
    now,
  });
}
