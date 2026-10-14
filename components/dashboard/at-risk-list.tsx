import Link from "next/link";
import { StageBadge } from "@/components/opportunities/stage-badge";
import { Avatar } from "@/components/ui/avatar";
import { Panel, PanelHeader } from "@/components/ui/panel";
import type { ExecutiveDashboard } from "@/domains/dashboard/metrics";
import { formatCount, inactivityLabel } from "@/domains/dashboard/presentation";

/**
 * Oportunidades en riesgo (Hito 5, DEC-037 §9): las abiertas Inactivas, de
 * la más vieja a la más reciente, cada una con enlace a su detalle. Muestra a
 * lo sumo las que trae el dashboard y dice cuántas hay; la lista completa
 * está en la cola de /opportunities.
 */
export function AtRiskList({
  atRisk,
}: {
  atRisk: ExecutiveDashboard["atRisk"];
}) {
  const { items, total } = atRisk;
  return (
    <section aria-labelledby="at-risk-heading">
      <Panel>
        <PanelHeader>
          <h2 id="at-risk-heading" className="text-heading text-text-primary">
            Oportunidades en riesgo
          </h2>
          <span className="ml-auto text-caption text-text-muted tabular-nums">
            {formatCount(total)}
          </span>
        </PanelHeader>
        {items.length === 0 ? (
          <p className="px-4 py-6 text-label font-normal text-text-muted">
            Ninguna oportunidad abierta lleva más de 5 días sin actividad del
            cliente.
          </p>
        ) : (
          <ol>
            {items.map((item) => (
              <li
                key={item.id}
                className="border-b border-border-subtle last:border-b-0"
              >
                <Link
                  href={`/opportunities/${item.id}`}
                  className="flex items-center gap-3 px-4 py-3 transition-colors duration-150 ease-out-strong hover:bg-surface-2 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-focus-ring"
                >
                  <Avatar initials={item.initials} />
                  <span className="flex min-w-0 flex-1 flex-col gap-1">
                    <span className="truncate text-label font-semibold text-text-primary">
                      {item.contactName}
                    </span>
                    <span className="text-caption text-danger">
                      {inactivityLabel(item.daysInactive)}
                    </span>
                  </span>
                  <StageBadge stage={item.stage} />
                </Link>
              </li>
            ))}
          </ol>
        )}
        {total > items.length ? (
          <p className="border-t border-border-subtle px-4 py-2.5 text-caption text-text-muted">
            Mostrando {formatCount(items.length)} de {formatCount(total)}.{" "}
            <Link
              href="/opportunities"
              className="rounded-sm text-brand hover:text-brand-strong hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring"
            >
              Ver todas en la cola
            </Link>
          </p>
        ) : null}
      </Panel>
    </section>
  );
}
