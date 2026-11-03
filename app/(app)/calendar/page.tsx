import type { Metadata } from "next";
import { CalendarView } from "@/components/calendar/calendar-view";
import { SCHEDULE_VEHICLE_PARAM } from "@/components/calendar/links";
import { getNavItem } from "@/components/shell/navigation";
import { getCalendarAgenda } from "@/db/queries/calendar";
import { WEEK_PARAM } from "@/domains/calendar/week";

const { label } = getNavItem("calendar");

export const metadata: Metadata = { title: label };

/*
 * Agenda de pruebas de manejo (Hito 9, DEC-041 §4): la semana (`?w=`) sale
 * de PostgreSQL por el loader tenant-scoped: requireTenant() →
 * withTenant() → RLS. La página no conoce Drizzle. Agendar y cambiar el
 * estado son Server Actions (lib/calendar/actions.ts). `?schedule=<unidad>`
 * (atajo del catálogo, propuesta DEC-049) abre "Agendar prueba" con esa
 * unidad elegida, si se puede probar.
 */
export default async function CalendarPage({
  searchParams,
}: PageProps<"/calendar">) {
  const params = await searchParams;
  const week = params[WEEK_PARAM];
  const schedule = params[SCHEDULE_VEHICLE_PARAM];
  const agenda = await getCalendarAgenda(
    typeof week === "string" ? week : undefined,
  );
  return (
    <CalendarView
      title={label}
      agenda={agenda}
      scheduleVehicleId={typeof schedule === "string" ? schedule : undefined}
    />
  );
}
