import { cn } from "@/components/ui/cn";
import { CalendarIcon } from "@/components/ui/icons";
import { testDrivesLabel, type AgendaDay } from "@/domains/calendar/agenda";

import { TestDriveCard } from "./test-drive-card";

/*
 * Agenda del día en foco (DEC-045 §4): debajo de `lg`, las pruebas del día
 * elegido en la tira, de la más temprana a la más tardía, con la tarjeta
 * completa de DEC-041 §4 (hora, cliente con enlace a su oportunidad,
 * unidad, estado, aviso de superposición, quién la agendó y el menú de
 * estados con su confirmación). Server Component: solo las tarjetas son de
 * cliente.
 */
export function DayAgenda({
  day,
  weekTotal,
  className,
}: {
  day: AgendaDay;
  /** Pruebas de toda la semana: elige el estado vacío. */
  weekTotal: number;
  className?: string;
}) {
  const headingId = `focus-day-${day.date}`;
  const count = day.items.length;
  return (
    <section
      aria-labelledby={headingId}
      className={cn("mx-auto flex w-full max-w-2xl flex-col gap-3", className)}
    >
      {/* Al tocar otro día cambia el título: se anuncia. */}
      <header
        aria-live="polite"
        className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5"
      >
        <h2
          id={headingId}
          className="text-heading text-text-primary first-letter:uppercase"
        >
          {day.longLabel}
        </h2>
        <p className="text-label text-text-muted tabular-nums">
          {day.isToday ? "Hoy · " : ""}
          {testDrivesLabel(count)}
        </p>
      </header>

      {count > 0 ? (
        <ol className="flex flex-col gap-2">
          {day.items.map((item) => (
            <li key={item.id}>
              <TestDriveCard item={item} />
            </li>
          ))}
        </ol>
      ) : (
        <div className="flex items-center gap-3 rounded-lg border border-dashed border-border-default bg-surface-1 px-4 py-3">
          <span className="flex size-9 shrink-0 items-center justify-center rounded-md bg-brand-soft text-brand-strong">
            <CalendarIcon aria-hidden="true" className="size-4.5" />
          </span>
          {weekTotal === 0 ? (
            <div className="min-w-0">
              <p className="text-label text-text-primary">
                No hay pruebas de manejo esta semana.
              </p>
              <p className="text-caption text-text-muted">
                Agendá una con &quot;Agendar prueba&quot; o mirá otra semana.
              </p>
            </div>
          ) : (
            <div className="min-w-0">
              <p className="text-label text-text-primary">
                Sin pruebas este día.
              </p>
              <p className="text-caption text-text-muted">
                Elegí otro día de la semana arriba.
              </p>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
