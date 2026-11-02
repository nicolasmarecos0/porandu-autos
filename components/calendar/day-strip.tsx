import Link from "next/link";

import { cn } from "@/components/ui/cn";
import { testDrivesLabel, type AgendaDay } from "@/domains/calendar/agenda";

import { calendarHref } from "./links";

/*
 * Tira de días (DEC-045 §4): debajo de `lg`, los siete días de la semana con
 * la cantidad de pruebas de cada uno; hoy lleva un anillo y el día en foco,
 * el círculo de marca. Tocar un día lo pone en foco (`?w=<día>`): es un
 * enlace, así que funciona sin JavaScript, se puede compartir y el botón
 * atrás vuelve al día anterior. Sin animación: se toca muchas veces por
 * día. Server Component.
 */
export function DayStrip({
  days,
  className,
}: {
  days: readonly AgendaDay[];
  className?: string;
}) {
  return (
    <nav
      aria-label="Días de la semana"
      className={cn(
        "shrink-0 border-b border-border-subtle bg-surface-1 px-1.5 py-1.5 sm:px-gutter",
        className,
      )}
    >
      <ol className="mx-auto grid max-w-2xl grid-cols-7 gap-0.5 sm:gap-1">
        {days.map((day) => {
          const count = day.items.length;
          return (
            <li key={day.date}>
              <Link
                href={calendarHref(day.date)}
                scroll={false}
                aria-current={day.isFocus ? "page" : undefined}
                className="group/day flex flex-col items-center gap-0.5 rounded-md py-1 transition-colors duration-150 ease-out-strong hover:bg-surface-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring"
              >
                <span className="sr-only">
                  {day.longLabel}
                  {day.isToday ? ", hoy" : ""}: {testDrivesLabel(count)}
                </span>
                <span
                  aria-hidden="true"
                  className={cn(
                    "text-overline uppercase",
                    day.isFocus || day.isToday
                      ? "text-brand-strong"
                      : "text-text-muted",
                  )}
                >
                  {day.weekdayShort}
                </span>
                <span
                  aria-hidden="true"
                  className={cn(
                    "flex size-8 items-center justify-center rounded-full text-heading tabular-nums",
                    day.isFocus
                      ? "bg-brand text-brand-contrast"
                      : day.isToday
                        ? "text-brand-strong ring-1 ring-brand-border"
                        : day.isPast
                          ? "text-text-muted"
                          : "text-text-primary",
                  )}
                >
                  {day.dayOfMonth}
                </span>
                <span
                  aria-hidden="true"
                  className={cn(
                    "h-3.5 text-caption tabular-nums",
                    day.isFocus ? "text-brand-strong" : "text-text-muted",
                  )}
                >
                  {count > 0 ? count : ""}
                </span>
              </Link>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
