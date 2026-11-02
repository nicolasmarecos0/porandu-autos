import { cn } from "@/components/ui/cn";
import { testDrivesLabel, type AgendaDay } from "@/domains/calendar/agenda";
import { weekTimeGrid, type TimeGridDay } from "@/domains/calendar/time-grid";

import { NowIndicator } from "./now-indicator";
import { TestDriveBlock } from "./test-drive-block";
import { blockStyle, percent } from "./time-grid-style";

/*
 * Grilla horaria de la semana (DEC-045 §3), desde `lg`:
 *
 *   ┌───────┬─────────┬─────────┬─────────┬── … ──┬─────────┐
 *   │       │  LUN 2  │  MAR 3  │ (MIÉ 4) │       │  DOM 8  │ ← fijo
 *   ├───────┼─────────┼─────────┼─────────┼── … ──┼─────────┤
 *   │ 08:00 │         │         │         │       │         │
 *   │ 09:00 │▌○ 09:30 │         │         │       │         │
 *   │       │▌Juan P. │         │●━━━━━━━━│ ← ahora
 *   │ 10:00 │▌Hilux   │         │▌✓▌● 10:30 (dos carriles)  │
 *   └───────┴─────────┴─────────┴─────────┴── … ──┴─────────┘
 *
 * Un eje de horas de Asunción común a los siete días (08:00 a 20:00,
 * extendido si una prueba cae afuera) y cada prueba como un bloque con el
 * alto de la franja de 60 minutos; los que se pisan se reparten el ancho.
 *
 * Server Component: solo los bloques (abren el detalle) y la línea "ahora"
 * son de cliente. Para el lector de pantalla cada día es una sección con su
 * título y sus pruebas en orden de hora; el eje y los encabezados visuales
 * se ocultan, porque cada bloque dice su hora.
 */

/** Alto de una hora de la grilla, en rem: la franja entra en tres líneas. */
const HOUR_HEIGHT_REM = 3.75;

export function WeekGrid({
  days,
  nowIso,
  className,
}: {
  days: readonly AgendaDay[];
  /** `now` del request (ISO): arranque de la línea "ahora". */
  nowIso: string;
  className?: string;
}) {
  const grid = weekTimeGrid(days);
  const height = `${(grid.range.endHour - grid.range.startHour) * HOUR_HEIGHT_REM}rem`;

  return (
    <div
      className={cn(
        "rounded-lg border border-border-subtle bg-surface-1 shadow-card",
        className,
      )}
    >
      {/* El eje de horas mide 3.5rem en las dos filas: las columnas alinean. */}
      <div
        aria-hidden="true"
        className="sticky top-0 z-30 grid grid-cols-[3.5rem_repeat(7,minmax(0,1fr))] rounded-t-lg border-b border-border-subtle bg-surface-1"
      >
        <div />
        {grid.days.map((day) => (
          <DayHeader key={day.date} day={day} />
        ))}
      </div>

      <div className="grid grid-cols-[3.5rem_minmax(0,1fr)]" style={{ height }}>
        <div aria-hidden="true" className="relative">
          {grid.hours.map((mark) => (
            <span
              key={mark.hour}
              className={cn(
                "absolute right-2 text-caption text-text-muted tabular-nums",
                mark.offset > 0 && "-translate-y-1/2",
              )}
              style={{
                top: mark.offset > 0 ? percent(mark.offset) : "0.25rem",
              }}
            >
              {mark.label}
            </span>
          ))}
        </div>

        <div className="relative grid grid-cols-7">
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-0"
          >
            {grid.hours.slice(1).map((mark) => (
              <span
                key={mark.hour}
                className="absolute inset-x-0 border-t border-border-subtle"
                style={{ top: percent(mark.offset) }}
              />
            ))}
          </div>
          {grid.days.map((day) => (
            <DayColumn key={day.date} day={day} />
          ))}
          <NowIndicator
            dates={grid.days.map((day) => day.date)}
            range={grid.range}
            nowIso={nowIso}
          />
        </div>
      </div>
    </div>
  );
}

function DayHeader({ day }: { day: TimeGridDay }) {
  const count = day.items.length;
  return (
    <div
      className={cn(
        "flex flex-col items-center gap-0.5 border-l border-border-subtle px-1 pt-2 pb-1.5",
        day.isToday && "bg-brand-soft",
      )}
    >
      <span
        className={cn(
          "text-overline uppercase",
          day.isToday ? "text-brand-strong" : "text-text-muted",
        )}
      >
        {day.weekdayShort}
      </span>
      <span
        className={cn(
          "flex size-8 items-center justify-center rounded-full text-heading tabular-nums",
          day.isToday
            ? "bg-brand text-brand-contrast"
            : day.isPast
              ? "text-text-muted"
              : "text-text-primary",
        )}
      >
        {day.dayOfMonth}
      </span>
      <span className="h-3.5 truncate text-caption text-text-muted tabular-nums">
        {count > 0 ? testDrivesLabel(count) : ""}
      </span>
    </div>
  );
}

function DayColumn({ day }: { day: TimeGridDay }) {
  const headingId = `grid-day-${day.date}`;
  return (
    <section
      aria-labelledby={headingId}
      className={cn(
        "relative border-l border-border-subtle",
        day.isToday ? "bg-brand-soft/40" : day.isPast && "bg-surface-2/60",
      )}
    >
      <h2 id={headingId} className="sr-only">
        {day.longLabel}
        {day.isToday ? ", hoy" : ""}: {testDrivesLabel(day.blocks.length)}
      </h2>
      {day.blocks.length > 0 ? (
        <ol className="absolute inset-0">
          {day.blocks.map(({ item, placement }) => (
            <li
              key={item.id}
              className="absolute"
              style={blockStyle(placement)}
            >
              <TestDriveBlock item={item} />
            </li>
          ))}
        </ol>
      ) : null}
    </section>
  );
}
