import Link from "next/link";

import { cn } from "@/components/ui/cn";
import {
  CalendarIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
} from "@/components/ui/icons";
import type { CalendarAgenda } from "@/db/queries/calendar";
import { focusedDay, testDrivesLabel } from "@/domains/calendar/agenda";
import type { CalendarWeek } from "@/domains/calendar/week";

import { AgendaSummary } from "./agenda-summary";
import { DayAgenda } from "./day-agenda";
import { DayStrip } from "./day-strip";
import { calendarHref } from "./links";
import { ScheduleTestDriveDrawer } from "./schedule-test-drive-drawer";
import { WeekGrid } from "./week-grid";

/*
 * Agenda ejecutiva de pruebas de manejo (Hito 9, DEC-041; Hito 13, DEC-045).
 * Server Component: recibe el ViewModel del loader (requireTenant() →
 * withTenant() → RLS) y solo los bloques, las tarjetas, la línea "ahora" y
 * el drawer de alta son de cliente.
 *
 *   ┌ Agenda · 12 pruebas esta semana ─────────────── [+ Agendar prueba] ┐
 *   │ [‹] [Hoy] [›]  2 – 8 nov 2026    ▬▬▬▬▬▬▬▬▬▬▬▬ (distribución)       │
 *   │                 6 ○● Por realizar · 3 ✓ Realizadas · 1 ⚠ No asistió │
 *   ├─────────────────────────────────────────────────────────────────────┤
 *   │ desde lg: grilla horaria de la semana (WeekGrid)                    │
 *   │ debajo:   tira de días (DayStrip) + agenda del día en foco          │
 *   └─────────────────────────────────────────────────────────────────────┘
 *
 * La semana y el día en foco viajan en la URL (`?w=YYYY-MM-DD`), así que se
 * puede compartir, volver atrás y recargar. Anterior y siguiente saltan al
 * mismo día de la otra semana; "Hoy", a hoy. Las dos presentaciones salen
 * del mismo HTML y las elige el CSS: cambiar el ancho no recarga nada.
 */

const navLinkClassName =
  "inline-flex h-8 items-center justify-center gap-1 rounded-md border border-border-default bg-surface-1 px-2.5 text-label font-semibold text-text-primary transition-[transform,background-color,border-color] duration-150 ease-out-strong hover:border-border-strong hover:bg-surface-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring active:scale-[0.97] motion-reduce:active:scale-100";

export function CalendarView({
  title,
  agenda,
}: {
  title: string;
  agenda: CalendarAgenda;
}) {
  const { week, days, counts, total } = agenda;
  const focus = focusedDay(days);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="shrink-0 border-b border-border-subtle bg-surface-1 px-gutter pt-3 pb-3.5">
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-3">
          <div className="flex min-w-0 items-baseline gap-2">
            <h1 className="text-title text-text-primary">{title}</h1>
            <span className="text-label text-text-muted tabular-nums max-sm:hidden">
              · {testDrivesLabel(total)} esta semana
            </span>
          </div>
          <ScheduleTestDriveDrawer
            opportunities={agenda.opportunities}
            vehicles={agenda.vehicles}
            nowIso={agenda.nowIso}
          />
        </div>

        <div className="mt-3 flex flex-wrap items-center justify-between gap-x-8 gap-y-3">
          <WeekNav week={week} />
          {total > 0 ? (
            <AgendaSummary counts={counts} className="w-full sm:w-auto" />
          ) : null}
        </div>
      </header>

      <DayStrip days={days} className="lg:hidden" />

      <div className="min-h-0 flex-1 overflow-y-auto p-gutter">
        <DayAgenda day={focus} weekTotal={total} className="lg:hidden" />
        <div className="max-lg:hidden">
          {total === 0 ? <EmptyWeek /> : null}
          <WeekGrid days={days} nowIso={agenda.nowIso} />
        </div>
      </div>
    </div>
  );
}

function WeekNav({ week }: { week: CalendarWeek }) {
  return (
    <nav aria-label="Semana" className="flex min-w-0 items-center gap-2">
      <Link
        href={calendarHref(week.previousKey)}
        className={navLinkClassName}
        aria-label="Semana anterior"
        scroll={false}
      >
        <ChevronLeftIcon aria-hidden="true" className="size-4" />
      </Link>
      <Link
        href={calendarHref(week.todayKey)}
        className={cn(
          navLinkClassName,
          week.isCurrent &&
            "border-brand-border bg-brand-soft text-brand-strong",
        )}
        aria-current={week.isCurrent ? "date" : undefined}
        scroll={false}
      >
        Hoy
      </Link>
      <Link
        href={calendarHref(week.nextKey)}
        className={navLinkClassName}
        aria-label="Semana siguiente"
        scroll={false}
      >
        <ChevronRightIcon aria-hidden="true" className="size-4" />
      </Link>
      <p
        aria-live="polite"
        className="ml-1 flex min-w-0 items-center gap-1.5 text-body font-semibold text-text-primary capitalize tabular-nums sm:text-heading"
      >
        <CalendarIcon
          aria-hidden="true"
          className="size-4.5 shrink-0 text-text-muted max-sm:hidden"
        />
        <span className="truncate">{week.label}</span>
      </p>
    </nav>
  );
}

function EmptyWeek() {
  return (
    <div className="mb-section flex items-center gap-3 rounded-lg border border-dashed border-border-default bg-surface-1 px-4 py-3">
      <span className="flex size-9 shrink-0 items-center justify-center rounded-md bg-brand-soft text-brand-strong">
        <CalendarIcon aria-hidden="true" className="size-4.5" />
      </span>
      <div className="min-w-0">
        <p className="text-label text-text-primary">
          No hay pruebas de manejo esta semana.
        </p>
        <p className="text-caption text-text-muted">
          Agendá una con &quot;Agendar prueba&quot; o mirá otra semana.
        </p>
      </div>
    </div>
  );
}
