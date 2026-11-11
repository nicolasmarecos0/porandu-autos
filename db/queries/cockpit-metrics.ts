import "server-only";

import {
  and,
  asc,
  eq,
  gt,
  gte,
  inArray,
  lt,
  lte,
  ne,
  sql,
  type SQL,
} from "drizzle-orm";

import { OPEN_TEST_DRIVE_STATUSES } from "@/domains/calendar/test-drives";
import {
  buildCockpitMetrics,
  FUNNEL_STAGES,
  overdueTestDriveCutoff,
  QUOTE_VALUE_STATUSES,
  type ClosureGroupRow,
  type CockpitMetrics,
  type OpenOpportunityCounts,
  type QuoteValueRow,
  type StockGroupRow,
  type TestDriveOutcomeCounts,
} from "@/domains/cockpit/metrics";
import {
  METRICS_TIME_ZONE,
  resolveMetricsPeriod,
  type MetricsPeriod,
  type MetricsSearchParams,
} from "@/domains/cockpit/metrics-period";
import { QUOTABLE_STAGES } from "@/domains/quotes/statuses";
import { recencyCutoffs, type RecencyCutoffs } from "@/domains/scoring/engine";
import { can } from "@/lib/auth/roles";
import { requireTenant } from "@/lib/tenant/session";

import { opportunities, quotes, testDrives, vehicles } from "../schema";
import { withTenant, type ScopedTransaction } from "../tenant";
import { statusFromDb } from "./vehicles";

/*
 * Métricas del salón desde PostgreSQL (propuesta DEC-050): la vista
 * ejecutiva de la sección Cockpit. Solo lee, en tiempo real (DEC-037 §3):
 * se agrega en la base en cada request, sobre las tablas transaccionales,
 * sin tablas de métricas, snapshots ni jobs.
 *
 *   request → resolveMetricsPeriod() → requireTenant() → TenantContext →
 *   withTenant() → cinco lecturas agregadas en la misma transacción, todas
 *   con filtro explícito por organización → RLS → domains/cockpit/metrics.ts
 *   → ViewModel
 *
 *   1. Oportunidades abiertas por etapa y su recencia (estado de hoy): una
 *      fila de `count(*) FILTER`, con los cortes de recencyCutoffs().
 *   2. Cierres del período por etapa y motivo de pérdida: `GROUP BY`, a lo
 *      sumo 7 grupos, con la suma de alta → cierre de cada grupo. Usa el
 *      índice parcial de cierres de 0017.
 *   3. Cotizaciones en juego hoy por moneda y estado: `SUM(total_price)`,
 *      a lo sumo 4 grupos, unidas a su oportunidad por organización e id.
 *   4. Pruebas de manejo del período por resultado: una fila de
 *      `count(*) FILTER`, con la frontera de vencidas del Cockpit · índice
 *      test_drives (organization_id, scheduled_at).
 *   5. Stock por estado y moneda: `SUM(price)` y la suma de la antigüedad,
 *      a lo sumo 12 grupos.
 *
 * - requireTenant() valida en cada request la organización activa contra
 *   las memberships activas del usuario (DEC-021). El layout de (app) es
 *   solo un gate de UX: este loader pide su propio contexto.
 * - Cada lectura filtra por `ctx.organizationId` (defensa en profundidad,
 *   ADR-001 §2): con varias memberships activas, RLS deja ver todas sus
 *   organizaciones y el filtro deja solo la activa. El join de las
 *   cotizaciones iguala organización e id, como la FK compuesta.
 * - Los instantes se ligan con operadores de columna (`gte`, `lt`, `lte`,
 *   `gt`) para que viajen como timestamptz: un Date crudo dentro de sql``
 *   no se serializa con este driver. El de la antigüedad viaja como texto
 *   con su cast, como la ingesta de WhatsApp.
 * - Dinero: `SUM` de `numeric` es exacto y vuelve como texto; cada moneda es
 *   su propio grupo, así que nada se mezcla (DEC-025 §5). El dominio opera
 *   en centavos.
 * - Caché (DEC-043 §6): ninguna compartida entre requests.
 *
 * Solo lectura: no escribe nada, ni `last_activity_at`, ni `updated_at`, ni
 * estados.
 */

const countAll = () => sql<number>`count(*)`.mapWith(Number);

const countWhere = (condition: SQL | undefined) =>
  sql<number>`count(*) filter (where ${condition})`.mapWith(Number);

/**
 * Suma de `to − from` en segundos enteros, sin negativos: un reloj
 * desfasado cuenta 0, como la recencia (DEC-035 §2).
 */
const sumSeconds = (to: SQL, from: SQL) =>
  sql<number>`coalesce(sum(greatest(floor(extract(epoch from (${to} - ${from}))), 0)), 0)::bigint`.mapWith(
    Number,
  );

/**
 * Oportunidades abiertas hoy, por etapa, y cuántas están Enfriándose o
 * Inactivas (DEC-035 §2). Los cortes salen de recencyCutoffs(): el umbral no
 * se repite en SQL (DEC-037 §8).
 */
async function selectOpenOpportunityCounts(
  tx: ScopedTransaction,
  organizationId: string,
  cutoffs: RecencyCutoffs,
): Promise<OpenOpportunityCounts> {
  const [row] = await tx
    .select({
      fresh: countWhere(eq(opportunities.stage, "new")),
      qualifying: countWhere(eq(opportunities.stage, "qualifying")),
      negotiating: countWhere(eq(opportunities.stage, "negotiating")),
      warning: countWhere(
        and(
          lt(opportunities.lastActivityAt, cutoffs.warningBefore),
          gte(opportunities.lastActivityAt, cutoffs.staleBefore),
        ),
      ),
      stale: countWhere(lt(opportunities.lastActivityAt, cutoffs.staleBefore)),
    })
    .from(opportunities)
    .where(
      and(
        eq(opportunities.organizationId, organizationId),
        inArray(opportunities.stage, [...FUNNEL_STAGES]),
      ),
    );
  return {
    byStage: {
      new: row?.fresh ?? 0,
      qualifying: row?.qualifying ?? 0,
      negotiating: row?.negotiating ?? 0,
    },
    warning: row?.warning ?? 0,
    stale: row?.stale ?? 0,
  };
}

/**
 * Cierres del período, por etapa y motivo de pérdida. La fecha de cierre de
 * una oportunidad `won` o `lost` es su `updated_at` (DEC-037 §5); "Todo" no
 * tiene piso.
 */
async function selectClosureGroups(
  tx: ScopedTransaction,
  organizationId: string,
  period: Pick<MetricsPeriod, "start" | "end">,
): Promise<ClosureGroupRow[]> {
  const rows = await tx
    .select({
      stage: opportunities.stage,
      lossReason: opportunities.lossReason,
      count: countAll(),
      cycleSeconds: sumSeconds(
        sql`${opportunities.updatedAt}`,
        sql`${opportunities.createdAt}`,
      ),
    })
    .from(opportunities)
    .where(
      and(
        eq(opportunities.organizationId, organizationId),
        inArray(opportunities.stage, ["won", "lost"]),
        period.start === null
          ? undefined
          : gte(opportunities.updatedAt, period.start),
        lt(opportunities.updatedAt, period.end),
      ),
    )
    .groupBy(opportunities.stage, opportunities.lossReason)
    .orderBy(asc(opportunities.stage), asc(opportunities.lossReason));
  return rows.map(({ stage, lossReason, count, cycleSeconds }) => {
    if (stage !== "won" && stage !== "lost") {
      throw new Error("cockpit-metrics: unexpected closure stage");
    }
    return { stage, lossReason, count, cycleSeconds };
  });
}

/**
 * Cotizaciones en juego hoy (estado actual, no del período): aprobadas o
 * enviadas, vigentes (`valid_until` no anterior al día de Asunción,
 * DEC-042 §4) y de oportunidades cotizables (DEC-043 §4), por moneda.
 */
async function selectQuoteValue(
  tx: ScopedTransaction,
  organizationId: string,
  today: string,
): Promise<QuoteValueRow[]> {
  const rows = await tx
    .select({
      currency: quotes.currency,
      status: quotes.status,
      count: countAll(),
      amount: sql<string>`sum(${quotes.totalPrice})`,
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
        inArray(quotes.status, [...QUOTE_VALUE_STATUSES]),
        gte(quotes.validUntil, today),
        inArray(opportunities.stage, [...QUOTABLE_STAGES]),
      ),
    )
    .groupBy(quotes.currency, quotes.status)
    .orderBy(asc(quotes.currency), asc(quotes.status));
  return rows.map(({ currency, status, count, amount }) => {
    if (status !== "approved" && status !== "sent") {
      throw new Error("cockpit-metrics: unexpected quote status");
    }
    return { currency, status, count, amount };
  });
}

/**
 * Pruebas de manejo agendadas en el período, por resultado. Una abierta
 * agendada en `overdueBefore` o antes terminó su franja (vencida); una
 * posterior todavía está en horario.
 */
async function selectTestDriveOutcomes(
  tx: ScopedTransaction,
  organizationId: string,
  period: Pick<MetricsPeriod, "start" | "end">,
  overdueBefore: Date,
): Promise<TestDriveOutcomeCounts> {
  const open = inArray(testDrives.status, [...OPEN_TEST_DRIVE_STATUSES]);
  const [row] = await tx
    .select({
      completed: countWhere(eq(testDrives.status, "completed")),
      noShow: countWhere(eq(testDrives.status, "no_show")),
      cancelled: countWhere(eq(testDrives.status, "cancelled")),
      overdue: countWhere(
        and(open, lte(testDrives.scheduledAt, overdueBefore)),
      ),
      upcoming: countWhere(
        and(open, gt(testDrives.scheduledAt, overdueBefore)),
      ),
    })
    .from(testDrives)
    .where(
      and(
        eq(testDrives.organizationId, organizationId),
        period.start === null
          ? undefined
          : gte(testDrives.scheduledAt, period.start),
        lt(testDrives.scheduledAt, period.end),
      ),
    );
  return {
    completed: row?.completed ?? 0,
    noShow: row?.noShow ?? 0,
    cancelled: row?.cancelled ?? 0,
    overdue: row?.overdue ?? 0,
    upcoming: row?.upcoming ?? 0,
  };
}

/**
 * Stock de hoy por estado (`vehicles.status`, como la Stock List y el
 * Catálogo) y moneda del precio publicado, con la suma exacta del precio y
 * de la antigüedad desde el ingreso a Porandú (`created_at`, DEC-025 §7).
 */
async function selectStockGroups(
  tx: ScopedTransaction,
  organizationId: string,
  now: Date,
): Promise<StockGroupRow[]> {
  const rows = await tx
    .select({
      status: vehicles.status,
      currency: vehicles.currency,
      units: countAll(),
      amount: sql<string | null>`sum(${vehicles.price})`,
      ageSeconds: sumSeconds(
        sql`${now.toISOString()}::timestamptz`,
        sql`${vehicles.createdAt}`,
      ),
    })
    .from(vehicles)
    // Una unidad entregada (DEC-053) salió del salón: no es stock de hoy.
    .where(
      and(
        eq(vehicles.organizationId, organizationId),
        ne(vehicles.status, "delivered"),
      ),
    )
    .groupBy(vehicles.status, vehicles.currency)
    .orderBy(asc(vehicles.status), asc(vehicles.currency));
  return rows.map((row) => ({
    status: statusFromDb[row.status],
    currency: row.currency,
    units: row.units,
    amount: row.amount,
    ageSeconds: row.ageSeconds,
  }));
}

/**
 * Lo que recibe la página: las métricas, o `restricted` si el rol de la
 * membership activa no tiene `metrics.view` (Hito 22, DEC-054 §5).
 */
export type CockpitMetricsResult =
  | Readonly<{ kind: "ready"; metrics: CockpitMetrics }>
  | Readonly<{ kind: "restricted" }>;

/**
 * Loader de /cockpit/metrics: las Métricas del salón de la organización
 * activa para el período que piden los `searchParams` (input no confiable:
 * un período inválido cae a los últimos 30 días con un aviso, nunca a un
 * error). `now` es el instante de la request: fija el período, el día de la
 * vigencia de las cotizaciones, los cortes de recencia, la frontera de las
 * pruebas vencidas y la antigüedad del stock.
 */
export async function getCockpitMetrics(
  params: MetricsSearchParams = {},
  now: Date = new Date(),
): Promise<CockpitMetricsResult> {
  const { period, notice } = resolveMetricsPeriod(
    params,
    now,
    METRICS_TIME_ZONE,
  );
  const ctx = await requireTenant();
  // La vista directiva es de la gerencia (Hito 22, DEC-054 §5): un seller
  // no la lee, ni agregada. Se decide antes de abrir la transacción.
  if (!can(ctx.role, "metrics.view")) return { kind: "restricted" };
  const cutoffs = recencyCutoffs(now);
  const overdueBefore = overdueTestDriveCutoff(now);

  const reads = await withTenant(ctx, async (tx) => {
    const { organizationId } = ctx;
    // En serie: una transacción es una sola conexión.
    const openCounts = await selectOpenOpportunityCounts(
      tx,
      organizationId,
      cutoffs,
    );
    const closures = await selectClosureGroups(tx, organizationId, period);
    // `period.to` es hoy en Asunción: el último día de validez, inclusive.
    const quoteValue = await selectQuoteValue(tx, organizationId, period.to);
    const testDriveOutcomes = await selectTestDriveOutcomes(
      tx,
      organizationId,
      period,
      overdueBefore,
    );
    const stock = await selectStockGroups(tx, organizationId, now);
    return {
      opportunities: openCounts,
      closures,
      quotes: quoteValue,
      testDrives: testDriveOutcomes,
      stock,
    };
  });

  return {
    kind: "ready",
    metrics: buildCockpitMetrics({ period, notice, now, ...reads }),
  };
}
