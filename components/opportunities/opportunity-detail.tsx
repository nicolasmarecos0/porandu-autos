import Link from "next/link";
import { PageHeader } from "@/components/shell/page-header";
import { WorkspaceLayout } from "@/components/shell/workspace-layout";
import { Badge } from "@/components/ui/badge";
import { ChevronRightIcon } from "@/components/ui/icons";
import { Panel, PanelHeader } from "@/components/ui/panel";
import { OpportunityMatches } from "@/components/vehicle-rail/vehicle-rail";
import {
  NO_DATA,
  type DemandDetail,
  type DemandFactDetail,
  type DemandHistoryItem,
  type DemandSummary,
} from "@/domains/demand/presentation";
import type { CurrentStatus } from "@/domains/demand/resolver";
import type { MatchRail } from "@/domains/match/presentation";
import { stageLabel } from "@/domains/opportunities/labels";
import type { Stage } from "@/domains/opportunities/types";

import { OpportunityDemandEdit } from "./opportunity-demand-edit";

/*
 * /opportunities/[id] (H1.4, DEC-030 §10, dentro de DEC-017): responde, para
 * cada fact, "¿Por qué Porandú cree que este cliente busca esto?", y qué
 * unidad del stock ofrecerle (Match v0, H1.5, DEC-031 §5).
 *
 *   ┌ contacto · etapa ──────────────────────────── Volver · Editar ┐
 *   │ Lo que busca                          │ Matches en stock       │
 *   │  Vehículo   Toyota Hilux [Confirmado] │  Top Match        (100)│
 *   │             Cargado al crear…         │  Alternativa       (70)│
 *   │             ▸ Historial (2)           │                        │
 *   └───────────────────────────────────────┴────────────────────────┘
 *
 * Server Component: el historial, las notas y los autores ("Vos" u "Otro
 * miembro") se arman en el servidor y nunca llegan ids de usuario. Los
 * matches llegan calculados por el loader. Al navegador solo viajan el drawer
 * "Editar", con el mismo resumen que la card "Busca", y los tooltips del
 * puntaje. Sin cola, scores, Why Now ni NBA (DEC-017).
 */

const STATUS_TONE: Readonly<
  Record<Exclude<CurrentStatus, "unknown">, "success" | "warning">
> = {
  confirmed: "success",
  corrected: "success",
  detected: "warning",
};

function History({
  label,
  items,
}: {
  label: string;
  items: readonly DemandHistoryItem[];
}) {
  return (
    <details className="group mt-2">
      <summary className="-mx-1 inline-flex cursor-pointer list-none items-center gap-1 rounded-sm px-1 text-caption text-brand hover:text-brand-strong focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring [&::-webkit-details-marker]:hidden">
        <ChevronRightIcon className="size-3.5 transition-transform duration-150 ease-out-strong group-open:rotate-90 motion-reduce:transition-none" />
        Historial ({items.length})
      </summary>
      <ol
        aria-label={`Historial: ${label}`}
        className="mt-2 flex flex-col gap-2 border-l-2 border-border-subtle pl-3"
      >
        {items.map((item) => (
          <li key={item.factId} className="flex flex-col gap-0.5 text-caption">
            <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
              <span className="text-label text-text-primary tabular-nums">
                {item.display}
              </span>
              <Badge>{item.label}</Badge>
            </span>
            <span className="text-text-muted">
              {item.author} · {item.at}
            </span>
            {item.note ? (
              <span className="text-text-secondary">{item.note}</span>
            ) : null}
          </li>
        ))}
      </ol>
    </details>
  );
}

function FactRow({ fact }: { fact: DemandFactDetail }) {
  return (
    <li className="grid grid-cols-1 gap-x-4 gap-y-1 px-4 py-3 sm:grid-cols-[8rem_1fr]">
      <h3 className="text-label text-text-muted">{fact.label}</h3>
      <div className="min-w-0">
        <p className="flex flex-wrap items-center gap-2 text-body text-text-primary tabular-nums">
          {fact.display ?? <span className="text-text-muted">{NO_DATA}</span>}
          {fact.statusLabel && fact.status !== "unknown" ? (
            <Badge tone={STATUS_TONE[fact.status]}>{fact.statusLabel}</Badge>
          ) : null}
        </p>
        <ul className="mt-1 flex flex-col gap-0.5 text-caption text-text-secondary">
          {fact.explanation.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
        {fact.history.length > 0 ? (
          <History label={fact.label} items={fact.history} />
        ) : null}
      </div>
    </li>
  );
}

const backLinkClassName =
  "inline-flex h-8 shrink-0 items-center justify-center rounded-md border border-border-default bg-surface-1 px-3 text-label font-semibold text-text-primary transition-[background-color,border-color] duration-150 ease-out-strong hover:border-border-strong hover:bg-surface-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring";

type OpportunityDetailViewProps = Readonly<{
  id: string;
  contactName: string;
  stage: Stage;
  demand: DemandDetail;
  /** Lo que necesita el drawer "Editar": el mismo resumen de la card. */
  summary: DemandSummary;
  /** Top Match y alternativa del stock disponible, o por qué no hay. */
  matches: MatchRail;
}>;

export function OpportunityDetailView({
  id,
  contactName,
  stage,
  demand,
  summary,
  matches,
}: OpportunityDetailViewProps) {
  return (
    <WorkspaceLayout
      header={
        <PageHeader
          title={contactName}
          status={<Badge tone="brand">{stageLabel(stage)}</Badge>}
          actions={
            <>
              <Link href="/opportunities" className={backLinkClassName}>
                Volver a Oportunidades
              </Link>
              <OpportunityDemandEdit opportunityId={id} summary={summary} />
            </>
          }
        />
      }
      aside={<OpportunityMatches rail={matches} />}
    >
      <section aria-labelledby="demand-heading" className="max-w-3xl">
        <Panel>
          <PanelHeader>
            <h2 id="demand-heading" className="text-heading text-text-primary">
              Lo que busca
            </h2>
          </PanelHeader>
          {demand.legacy ? (
            <p className="border-b border-border-subtle px-4 py-3 text-label text-text-secondary">
              Dato anterior (sin estructurar): {demand.legacy}
            </p>
          ) : null}
          {demand.empty ? (
            <p className="px-4 py-6 text-body text-text-secondary">
              Todavía no sabemos qué busca. Cargalo con «Editar».
            </p>
          ) : (
            <ul className="divide-y divide-border-subtle">
              {demand.facts.map((fact) => (
                <FactRow key={fact.fact} fact={fact} />
              ))}
            </ul>
          )}
        </Panel>
      </section>
    </WorkspaceLayout>
  );
}
