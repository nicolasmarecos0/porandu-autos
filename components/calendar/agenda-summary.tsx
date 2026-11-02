import { cn } from "@/components/ui/cn";
import {
  AGENDA_STATUS_GROUPS,
  distributionLabel,
  groupBreakdown,
  groupCount,
  type AgendaCounts,
  type AgendaStatusGroupId,
} from "@/domains/calendar/agenda";
import { TEST_DRIVE_STATUSES } from "@/domains/calendar/test-drives";

import { TEST_DRIVE_EDGE, TestDriveStatusGlyph } from "./test-drive-status";

/*
 * Resumen de la semana (DEC-045 §5): el medidor segmentado de la
 * distribución por estado (como el de Stock) y los cuatro grupos de
 * lectura con la regla de los test drives del Dashboard (DEC-043 §5): Por
 * realizar (agendadas + confirmadas, con su desglose), Realizadas, No
 * asistió y Canceladas. Siempre los cuatro y en el mismo orden, con el 0
 * atenuado, para que la franja no salte de una semana a otra. Server
 * Component.
 */

const GROUP_TEXT: Readonly<Record<AgendaStatusGroupId, string>> = {
  pending: "text-brand-strong",
  completed: "text-success",
  no_show: "text-warning",
  cancelled: "text-text-muted",
};

export function AgendaSummary({
  counts,
  className,
}: {
  counts: AgendaCounts;
  className?: string;
}) {
  return (
    <div className={cn("flex min-w-0 flex-col gap-2", className)}>
      <div
        role="img"
        aria-label={`Distribución de la semana: ${distributionLabel(counts)}`}
        className="flex h-1.5 w-full gap-0.5 overflow-hidden rounded-full bg-surface-3"
      >
        {TEST_DRIVE_STATUSES.filter((status) => counts[status] > 0).map(
          (status) => (
            <span
              key={status}
              className={cn("h-full", TEST_DRIVE_EDGE[status])}
              style={{ flexGrow: counts[status] }}
            />
          ),
        )}
      </div>
      <dl className="flex flex-wrap gap-x-6 gap-y-1">
        {AGENDA_STATUS_GROUPS.map((group) => {
          const count = groupCount(counts, group);
          return (
            // dt primero en el DOM; el número se ve primero.
            <div
              key={group.id}
              className="flex flex-row-reverse items-baseline justify-end gap-1.5"
            >
              <dt className="flex items-center gap-1.5 text-label text-text-secondary">
                <span
                  className={cn(
                    "flex items-center gap-0.5",
                    count === 0 ? "text-text-muted" : GROUP_TEXT[group.id],
                  )}
                >
                  {group.statuses.map((status) => (
                    <TestDriveStatusGlyph key={status} status={status} />
                  ))}
                </span>
                {group.label}
                {group.statuses.length > 1 && count > 0 ? (
                  <span className="text-caption text-text-muted tabular-nums max-sm:sr-only">
                    ({groupBreakdown(counts, group)})
                  </span>
                ) : null}
              </dt>
              <dd
                className={cn(
                  "text-heading tabular-nums",
                  count === 0 ? "text-text-muted" : GROUP_TEXT[group.id],
                )}
              >
                {count}
              </dd>
            </div>
          );
        })}
      </dl>
    </div>
  );
}
