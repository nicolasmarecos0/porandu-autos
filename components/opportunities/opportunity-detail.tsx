import Link from "next/link";
import { PageHeader } from "@/components/shell/page-header";
import { WorkspaceLayout } from "@/components/shell/workspace-layout";
import { Badge } from "@/components/ui/badge";
import { CheckIcon, ChevronRightIcon } from "@/components/ui/icons";
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
import type { MatchCard, MatchRail } from "@/domains/match/presentation";
import type { ActivityEntry } from "@/domains/conversations/timeline";
import type { ClosureSummary } from "@/domains/opportunities/closure";
import type { Stage } from "@/domains/opportunities/stages";
import type { LinkedVehicleCard } from "@/domains/opportunities/vehicle-link";

import { ClosureSummaryCard } from "./closure-summary";
import { LinkedVehicle } from "./linked-vehicle";
import { OpportunityActivity } from "./opportunity-activity";
import { OpportunityDemandEdit } from "./opportunity-demand-edit";
import { OpportunityStagePanel } from "./opportunity-stage-panel";
import { StageBadge } from "./stage-badge";
import { VehicleLinkButton, VehicleLinkProvider } from "./vehicle-link";

/*
 * /opportunities/[id] (H1.4, DEC-030 §10, dentro de DEC-017): responde, para
 * cada fact, "¿Por qué Porandú cree que este cliente busca esto?", qué
 * unidad del stock ofrecerle (Match v0, H1.5, DEC-031 §5) y, desde Hito 2
 * (DEC-033), qué pasó en la negociación y qué unidad se negocia, y cómo se
 * cerró (DEC-034). Desde el Hito 4 (DEC-036), las notas y los mensajes
 * registrados conviven en el muro "Actividad".
 *
 *   ┌ contacto · etapa ──────────────────────────── Volver · Editar ┐
 *   │ Etapa                                 │ Unidad en negociación  │
 *   │ Cierre (solo Ganada o Perdida)        │                        │
 *   │ Actividad [Nota | Mensaje] [Registrar]│  Toyota Hilux  [Quitar]│
 *   │  (Mensaje recibido) WhatsApp · Vos …  │ Matches en stock       │
 *   │  (Nota) Otro miembro · 11 oct …       │                        │
 *   │ Lo que busca                          │  Top Match        (100)│
 *   │  Vehículo   Toyota Hilux [Confirmado] │   [Vinculada]          │
 *   │             ▸ Historial (2)           │  Alternativa       (70)│
 *   │                                       │   [Vincular a la neg.] │
 *   └───────────────────────────────────────┴────────────────────────┘
 *
 * Server Component: el historial, el muro de actividad y los autores ("Vos"
 * u "Otro miembro") se arman en el servidor y nunca llegan ids de usuario.
 * Los matches llegan calculados por el loader. Al navegador solo viajan el
 * drawer "Editar", con el mismo resumen que la card "Busca", el panel de
 * etapa (H1.6, DEC-032: etapa actual y acciones permitidas, con la
 * confirmación del cierre y sus metadatos, DEC-034), los formularios de
 * notas y mensajes (con su selector), los botones de vinculación (solo En
 * negociación) y los tooltips del puntaje. La tarjeta "Cierre" es de solo
 * lectura. Sin cola, scores, Why Now ni NBA (DEC-017).
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
  /** Resumen del cierre (DEC-034): solo con `won` o `lost`. */
  closure: ClosureSummary | null;
  demand: DemandDetail;
  /** Lo que necesita el drawer "Editar": el mismo resumen de la card. */
  summary: DemandSummary;
  /** Top Match y alternativa del stock disponible, o por qué no hay. */
  matches: MatchRail;
  /** Unidad vinculada a la negociación (Hito 2) y si se puede cambiar. */
  vehicleLink: Readonly<{
    canChange: boolean;
    linked: LinkedVehicleCard | null;
  }>;
  /** Notas y mensajes en un solo muro, del registro más reciente al más viejo. */
  activity: readonly ActivityEntry[];
}>;

/** Copy de la marca de la tarjeta de match que ya es la unidad vinculada. */
const LINKED_MARK = "Vinculada a la negociación";

/**
 * Rail derecho: la unidad vinculada arriba y los matches, cuyas tarjetas
 * ofrecen vincularse solo si la etapa lo admite (DEC-033 §2, DEC-034 §4).
 */
function VehicleColumn({
  id,
  stage,
  matches,
  vehicleLink,
}: Pick<
  OpportunityDetailViewProps,
  "id" | "stage" | "matches" | "vehicleLink"
>) {
  const { canChange, linked } = vehicleLink;
  const cardFooter = (card: MatchCard) => {
    if (card.vehicleId === linked?.vehicleId) {
      return (
        <Badge tone="brand">
          <CheckIcon className="size-3" strokeWidth={2.25} />
          {LINKED_MARK}
        </Badge>
      );
    }
    return canChange ? (
      <VehicleLinkButton vehicleId={card.vehicleId} vehicleName={card.name} />
    ) : null;
  };
  const hint =
    stage === "new" || stage === "qualifying"
      ? "Vas a poder vincular una de estas unidades cuando la oportunidad esté En negociación."
      : undefined;

  const column = (
    <>
      <LinkedVehicle stage={stage} linked={linked} canChange={canChange} />
      <OpportunityMatches rail={matches} cardFooter={cardFooter} hint={hint} />
    </>
  );
  return canChange ? (
    <VehicleLinkProvider opportunityId={id}>{column}</VehicleLinkProvider>
  ) : (
    column
  );
}

export function OpportunityDetailView({
  id,
  contactName,
  stage,
  closure,
  demand,
  summary,
  matches,
  vehicleLink,
  activity,
}: OpportunityDetailViewProps) {
  const { linked } = vehicleLink;
  return (
    <WorkspaceLayout
      header={
        <PageHeader
          title={contactName}
          status={<StageBadge stage={stage} />}
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
      aside={
        <VehicleColumn
          id={id}
          stage={stage}
          matches={matches}
          vehicleLink={vehicleLink}
        />
      }
    >
      <OpportunityStagePanel
        opportunityId={id}
        stage={stage}
        saleVehicle={
          linked ? { name: linked.name, detail: linked.detail } : null
        }
      />
      {closure ? (
        <ClosureSummaryCard
          closure={closure}
          vehicleName={linked?.name ?? null}
        />
      ) : null}
      <OpportunityActivity opportunityId={id} activity={activity} />
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
