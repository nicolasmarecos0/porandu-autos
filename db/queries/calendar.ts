import "server-only";

import { and, asc, desc, eq, gte, inArray, lt } from "drizzle-orm";

import {
  agendaCounts,
  agendaDays,
  vehicleLabel,
  type AgendaCounts,
  type AgendaDay,
  type ScheduleOpportunityOption,
  type ScheduleVehicleOption,
} from "@/domains/calendar/agenda";
import { CALENDAR_TIME_ZONE } from "@/domains/calendar/test-drives";
import { calendarWeek, type CalendarWeek } from "@/domains/calendar/week";
import { requireTenant } from "@/lib/tenant/session";

import { contacts, opportunities, testDrives, vehicles } from "../schema";
import { withTenant } from "../tenant";

/*
 * Agenda semanal de /calendar (Hito 9, DEC-041 §4). Solo lee:
 *
 *   request → requireTenant() → TenantContext → withTenant() → las pruebas
 *   de manejo de la semana y las opciones del alta, filtradas por la
 *   organización activa → RLS → domains/calendar/ → ViewModel
 *
 * - La semana: de lunes a domingo en la hora de Asunción (calendarWeek()),
 *   como [inicio, fin) contra `scheduled_at`, servida por el índice
 *   (organization_id, scheduled_at). A lo sumo WEEK_TEST_DRIVE_LIMIT
 *   pruebas.
 * - Opciones del alta: las oportunidades abiertas (new, qualifying,
 *   negotiating), de la actividad más reciente a la más vieja, y las
 *   unidades disponibles o reservadas. A lo sumo SCHEDULE_OPTION_LIMIT de
 *   cada una. Son solo opciones: la Server Action vuelve a validar todo.
 * - Todo en la misma transacción. Leer no cambia nada.
 */

/** Tope de pruebas de una semana. */
export const WEEK_TEST_DRIVE_LIMIT = 500;

/** Tope de opciones de cada select del alta. */
export const SCHEDULE_OPTION_LIMIT = 200;

/** Etapas de una oportunidad abierta: se le puede agendar una prueba. */
export const SCHEDULABLE_STAGES = ["new", "qualifying", "negotiating"] as const;

/** Estados de una unidad que se puede probar. */
export const TESTABLE_VEHICLE_STATUSES = ["available", "reserved"] as const;

export type CalendarAgenda = Readonly<{
  week: CalendarWeek;
  days: readonly AgendaDay[];
  counts: AgendaCounts;
  total: number;
  opportunities: readonly ScheduleOpportunityOption[];
  vehicles: readonly ScheduleVehicleOption[];
  /** `now` del request, para que la UI no dependa del reloj del navegador. */
  nowIso: string;
}>;

/** Loader de /calendar. `weekParam` es el `?w=` de la URL, sin validar. */
export async function getCalendarAgenda(
  weekParam: string | undefined,
): Promise<CalendarAgenda> {
  const ctx = await requireTenant();
  const now = new Date();
  const week = calendarWeek(weekParam, now, CALENDAR_TIME_ZONE);

  return withTenant(ctx, async (tx) => {
    const { organizationId } = ctx;

    const rows = await tx
      .select({
        id: testDrives.id,
        status: testDrives.status,
        scheduledAt: testDrives.scheduledAt,
        opportunityId: testDrives.opportunityId,
        contactName: contacts.name,
        vehicleId: testDrives.vehicleId,
        vehicleBrand: vehicles.brand,
        vehicleModel: vehicles.model,
        vehicleYear: vehicles.year,
        createdBy: testDrives.createdBy,
      })
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
          eq(testDrives.organizationId, organizationId),
          gte(testDrives.scheduledAt, week.start),
          lt(testDrives.scheduledAt, week.end),
        ),
      )
      .orderBy(asc(testDrives.scheduledAt), asc(testDrives.id))
      .limit(WEEK_TEST_DRIVE_LIMIT);

    const openOpportunities = await tx
      .select({ id: opportunities.id, contactName: contacts.name })
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
          inArray(opportunities.stage, [...SCHEDULABLE_STAGES]),
        ),
      )
      .orderBy(desc(opportunities.lastActivityAt), desc(opportunities.id))
      .limit(SCHEDULE_OPTION_LIMIT);

    const testableVehicles = await tx
      .select({
        id: vehicles.id,
        brand: vehicles.brand,
        model: vehicles.model,
        year: vehicles.year,
      })
      .from(vehicles)
      .where(
        and(
          eq(vehicles.organizationId, organizationId),
          inArray(vehicles.status, [...TESTABLE_VEHICLE_STATUSES]),
        ),
      )
      .orderBy(
        asc(vehicles.brand),
        asc(vehicles.model),
        desc(vehicles.year),
        asc(vehicles.id),
      )
      .limit(SCHEDULE_OPTION_LIMIT);

    return {
      week,
      days: agendaDays(week, rows, ctx.userId, now),
      counts: agendaCounts(rows),
      total: rows.length,
      opportunities: openOpportunities,
      vehicles: testableVehicles.map((vehicle) => ({
        id: vehicle.id,
        label: vehicleLabel(vehicle.brand, vehicle.model, vehicle.year),
      })),
      nowIso: now.toISOString(),
    };
  });
}
