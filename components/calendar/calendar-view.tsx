import Link from "next/link";
import { cn } from "@/components/ui/cn";
import { CalendarIcon, ChevronRightIcon } from "@/components/ui/icons";
import { testDrivesLabel, type AgendaDay } from "@/domains/calendar/agenda";
import {
  TEST_DRIVE_STATUS_LABELS,
  TEST_DRIVE_STATUSES,
} from "@/domains/calendar/test-drives";
import { WEEK_PARAM } from "@/domains/calendar/week";
import type { CalendarAgenda } from "@/db/queries/calendar";

import { ScheduleTestDriveDrawer } from "./schedule-test-drive-drawer";
import { TestDriveCard } from "./test-drive-card";
import { TEST_DRIVE_DOT, TEST_DRIVE_TEXT } from "./test-drive-status";

/*
 * Agenda semanal de pruebas de manejo (Hito 9, DEC-041 §4). Server
 * Component: recibe el ViewModel del loader (requireTenant() →
 * withTenant() → RLS) y solo las tarjetas y el drawer de alta son de
 * cliente.
 *
 * Layout: en desktop ancho, siete columnas (lunes a domingo); en tablet,
 * dos; en teléfono, una lista de días. La semana viaja en la URL
 * (`?w=YYYY-MM-DD`), así que se puede compartir, volver atrás y recargar.
 */

const weekHref = (key: string) => `/calendar?${WEEK_PARAM}=${key}`;

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

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="shrink-0 border-b border-border-subtle bg-surface-1 px-gutter pt-3 pb-4">
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

        <div className="mt-3 flex flex-wrap items-center justify-between gap-x-6 gap-y-3">
          <nav aria-label="Semana" className="flex items-center gap-2">
            <Link
              href={weekHref(week.previousKey)}
              className={navLinkClassName}
              aria-label="Semana anterior"
              scroll={false}
            >
              <ChevronRightIcon
                aria-hidden="true"
                className="size-4 rotate-180"
              />
            </Link>
            <Link
              href={weekHref(week.todayKey)}
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
              href={weekHref(week.nextKey)}
              className={navLinkClassName}
              aria-label="Semana siguiente"
              scroll={false}
            >
              <ChevronRightIcon aria-hidden="true" className="size-4" />
            </Link>
            <p
              aria-live="polite"
              className="ml-1 flex items-center gap-1.5 text-heading text-text-primary capitalize tabular-nums"
            >
              <CalendarIcon
                aria-hidden="true"
                className="size-4.5 text-text-muted"
              />
              {week.label}
            </p>
          </nav>

          {total > 0 ? (
            <dl className="flex flex-wrap gap-x-6 gap-y-1">
              {TEST_DRIVE_STATUSES.filter((status) => counts[status] > 0).map(
                (status) => (
                  // dt primero en el DOM; el número se ve primero.
                  <div
                    key={status}
                    className="flex flex-row-reverse items-baseline justify-end gap-1.5"
                  >
                    <dt className="flex items-center gap-1.5 text-label text-text-secondary">
                      <span
                        aria-hidden="true"
                        className={cn(
                          "size-2 rounded-full",
                          TEST_DRIVE_DOT[status],
                        )}
                      />
                      {TEST_DRIVE_STATUS_LABELS[status]}
                    </dt>
                    <dd
                      className={cn(
                        "text-heading tabular-nums",
                        TEST_DRIVE_TEXT[status],
                      )}
                    >
                      {counts[status]}
                    </dd>
                  </div>
                ),
              )}
            </dl>
          ) : null}
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto p-gutter">
        {total === 0 ? <EmptyWeek /> : null}
        <ol
          aria-label={`Días de la semana del ${week.label}`}
          className="grid grid-cols-1 gap-section md:grid-cols-2 xl:grid-cols-7"
        >
          {days.map((day) => (
            <DayColumn key={day.date} day={day} />
          ))}
        </ol>
      </div>
    </div>
  );
}

function DayColumn({ day }: { day: AgendaDay }) {
  const headingId = `day-${day.date}`;
  return (
    <li
      aria-labelledby={headingId}
      className={cn(
        "flex min-w-0 flex-col rounded-lg border bg-surface-2/60",
        day.isToday
          ? "border-brand-border ring-1 ring-brand-border"
          : "border-border-subtle",
        // En teléfono, los días ya pasados y vacíos no ocupan lugar.
        day.isPast && day.items.length === 0 && "max-md:hidden",
      )}
    >
      <h2
        id={headingId}
        className={cn(
          "flex items-center gap-2 rounded-t-lg border-b px-3 py-2",
          day.isToday
            ? "border-brand-border bg-brand-soft"
            : "border-border-subtle bg-surface-1",
        )}
      >
        <span className="sr-only">{day.longLabel}</span>
        <span
          aria-hidden="true"
          className={cn(
            "text-overline uppercase",
            day.isToday ? "text-brand-strong" : "text-text-muted",
          )}
        >
          {day.weekdayShort}
        </span>
        <span
          aria-hidden="true"
          className={cn(
            "text-heading tabular-nums",
            day.isToday
              ? "text-brand-strong"
              : day.isPast
                ? "text-text-muted"
                : "text-text-primary",
          )}
        >
          {day.dayOfMonth}
        </span>
        {day.isToday ? (
          <span className="ml-auto rounded-full bg-brand px-2 py-0.5 text-caption text-brand-contrast">
            Hoy
          </span>
        ) : day.items.length > 0 ? (
          <span className="ml-auto text-caption text-text-muted tabular-nums">
            {day.items.length}
          </span>
        ) : null}
      </h2>
      {day.items.length > 0 ? (
        <ul className="flex flex-col gap-2 p-2">
          {day.items.map((item) => (
            <li key={item.id}>
              <TestDriveCard item={item} />
            </li>
          ))}
        </ul>
      ) : (
        <p className="px-3 py-4 text-caption text-text-muted xl:py-6 xl:text-center">
          Sin pruebas
        </p>
      )}
    </li>
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
