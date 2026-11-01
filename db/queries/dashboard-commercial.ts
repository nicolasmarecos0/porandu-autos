import "server-only";

import { and, eq, gte, inArray, lt, sql, type SQL } from "drizzle-orm";

import { OPEN_TEST_DRIVE_STATUSES } from "@/domains/calendar/test-drives";
import type {
  QuoteCounts,
  TestDriveWeekCounts,
} from "@/domains/dashboard/commercial";
import type { DashboardRange } from "@/domains/dashboard/range";
import {
  OPEN_QUOTE_STATUSES,
  QUOTABLE_STAGES,
} from "@/domains/quotes/statuses";

import { opportunities, quotes, testDrives } from "../schema";
import type { ScopedTransaction } from "../tenant";

/*
 * Lecturas de los KPIs comerciales del Dashboard Directivo (propuesta
 * DEC-043). No son loaders: no piden contexto ni abren transacción. Las
 * compone getExecutiveDashboard() (db/queries/dashboard.ts) dentro de su
 * única transacción withTenant(), después de requireTenant():
 *
 *   requireTenant() → TenantContext → withTenant(ctx, tx => …) →
 *   selectClosedCounts · selectPendingQuoteCounts · selectWeekTestDriveCounts
 *
 * - Cada lectura es una sola fila de `count(*) FILTER (…)`: una pasada por
 *   las filas de la organización activa, sin traer filas a la aplicación.
 * - Cada una filtra por `organizationId` (defensa en profundidad, ADR-001
 *   §2): con varias memberships activas, RLS deja ver todas y el filtro deja
 *   solo la activa. El join a oportunidades iguala organización e id, como
 *   la FK compuesta.
 * - Los instantes se ligan con operadores de columna (`gte`, `lt`) para que
 *   viajen como timestamptz (un Date crudo dentro de sql`` no se serializa
 *   con este driver). El día de validez viaja como `YYYY-MM-DD` contra una
 *   columna `date`.
 * - Índices que usan: test_drives (organization_id, scheduled_at),
 *   quotes (organization_id, opportunity_id) y la unique
 *   opportunities (organization_id, id).
 *
 * Solo lectura: no escribe nada.
 */

const count = (condition: SQL | undefined) =>
  sql<number>`count(*) filter (where ${condition})`.mapWith(Number);

/**
 * Ventas cerradas y perdidas en el rango (DEC-037 §5: la fecha de cierre de
 * una oportunidad `won` o `lost` es su `updated_at`). Base de la tasa de
 * conversión.
 */
export async function selectClosedCounts(
  tx: ScopedTransaction,
  organizationId: string,
  range: Pick<DashboardRange, "start" | "end">,
): Promise<Readonly<{ won: number; lost: number }>> {
  const [row] = await tx
    .select({
      won: count(eq(opportunities.stage, "won")),
      lost: count(eq(opportunities.stage, "lost")),
    })
    .from(opportunities)
    .where(
      and(
        eq(opportunities.organizationId, organizationId),
        inArray(opportunities.stage, ["won", "lost"]),
        gte(opportunities.updatedAt, range.start),
        lt(opportunities.updatedAt, range.end),
      ),
    );
  return { won: row?.won ?? 0, lost: row?.lost ?? 0 };
}

/**
 * Cotizaciones abiertas hoy (estado actual, no del rango), por estado y
 * vigencia. Solo las de oportunidades cotizables (`qualifying` o
 * `negotiating`): con la oportunidad cerrada, una cotización abierta ya no
 * se puede aprobar, enviar ni aceptar (DEC-042 §2), así que no está
 * pendiente de nada.
 *
 * `today` es el día de Asunción (`YYYY-MM-DD`). Vigente = `valid_until >=
 * today` (último día de validez, inclusive, DEC-042 §4).
 */
export async function selectPendingQuoteCounts(
  tx: ScopedTransaction,
  organizationId: string,
  today: string,
): Promise<QuoteCounts> {
  const current = gte(quotes.validUntil, today);
  const [row] = await tx
    .select({
      awaitingApproval: count(and(eq(quotes.status, "draft"), current)),
      readyToSend: count(and(eq(quotes.status, "approved"), current)),
      awaitingResponse: count(and(eq(quotes.status, "sent"), current)),
      expired: count(lt(quotes.validUntil, today)),
    })
    .from(quotes)
    .innerJoin(
      opportunities,
      and(
        eq(opportunities.organizationId, quotes.organizationId),
        eq(opportunities.id, quotes.opportunityId),
      ),
    )
    .where(
      and(
        eq(quotes.organizationId, organizationId),
        inArray(quotes.status, [...OPEN_QUOTE_STATUSES]),
        inArray(opportunities.stage, [...QUOTABLE_STAGES]),
      ),
    );
  return {
    awaitingApproval: row?.awaitingApproval ?? 0,
    readyToSend: row?.readyToSend ?? 0,
    awaitingResponse: row?.awaitingResponse ?? 0,
    expired: row?.expired ?? 0,
  };
}

/**
 * Pruebas de manejo agendadas en la semana [start, end) (lunes a domingo de
 * Asunción, la misma semana que `/calendar`, DEC-041 §4), por estado.
 */
export async function selectWeekTestDriveCounts(
  tx: ScopedTransaction,
  organizationId: string,
  week: Readonly<{ start: Date; end: Date }>,
): Promise<TestDriveWeekCounts> {
  const [row] = await tx
    .select({
      pending: count(
        inArray(testDrives.status, [...OPEN_TEST_DRIVE_STATUSES]),
      ),
      completed: count(eq(testDrives.status, "completed")),
      noShow: count(eq(testDrives.status, "no_show")),
      cancelled: count(eq(testDrives.status, "cancelled")),
    })
    .from(testDrives)
    .where(
      and(
        eq(testDrives.organizationId, organizationId),
        gte(testDrives.scheduledAt, week.start),
        lt(testDrives.scheduledAt, week.end),
      ),
    );
  return {
    pending: row?.pending ?? 0,
    completed: row?.completed ?? 0,
    noShow: row?.noShow ?? 0,
    cancelled: row?.cancelled ?? 0,
  };
}
