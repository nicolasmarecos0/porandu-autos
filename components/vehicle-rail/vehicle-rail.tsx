import type { ReactNode } from "react";
import { MatchRing } from "@/components/intelligence/porandu-ring";
import { cn } from "@/components/ui/cn";
import { CheckIcon } from "@/components/ui/icons";
import { TooltipProvider } from "@/components/ui/tooltip";
import type {
  MatchCard,
  MatchRail,
  MatchRailEmptyReason,
} from "@/domains/match/presentation";
import type { Opportunity } from "@/domains/opportunities/types";
import { VehicleVisual } from "./vehicle-visual";

/*
 * Vehicle Rail: Top Match (resaltado), alternativa y trade-in. Tarjetas
 * apiladas con pares clave-valor, como la columna derecha de la referencia.
 * Lo que busca el cliente (la card "Busca") sale de la demanda estructurada
 * (H1.4, components/opportunities/demand-card.tsx).
 *
 * - `VehicleRail` es el contrato visual de B1 en /opportunities: sin fuente
 *   todavía, no se muestra con datos reales.
 * - `OpportunityMatches` muestra los matches reales de Match v0 (H1.5,
 *   DEC-031) en /opportunities/[id]: Top Match y alternativa con las razones
 *   del motor, o un "sin dato" honesto. Sin silueta: el inventario no tiene
 *   carrocería y no se inventa una.
 */

function Pill({
  tone,
  children,
}: {
  tone: "neutral" | "brand" | "warning";
  children: ReactNode;
}) {
  return (
    <span
      className={cn(
        "rounded-sm px-1.5 py-0.5 text-caption font-semibold",
        tone === "neutral" && "bg-surface-3 text-text-secondary",
        tone === "brand" && "bg-brand-soft text-brand-strong",
        tone === "warning" && "bg-warning-soft text-warning",
      )}
    >
      {children}
    </span>
  );
}

function KeyValues({ rows }: { rows: readonly [string, ReactNode][] }) {
  return (
    <dl className="grid flex-1 grid-cols-[5.5rem_1fr] gap-x-2 gap-y-1 text-label">
      {rows.map(([label, value]) => (
        <div key={label} className="contents">
          <dt className="text-text-muted">{label}</dt>
          <dd className="text-text-primary tabular-nums">{value}</dd>
        </div>
      ))}
    </dl>
  );
}

export function VehicleRail({ opportunity }: { opportunity: Opportunity }) {
  const { topMatch: match, alternative, tradeIn } = opportunity;
  return (
    <>
      {match ? (
        <section
          aria-label="Top Match"
          className="shrink-0 rounded-lg border-2 border-brand bg-brand-soft/40 p-4 shadow-card"
        >
          <header className="flex items-center gap-2">
            <h3 className="text-label font-semibold text-brand-strong">
              Top Match
            </h3>
            <CheckIcon className="size-3.5 text-brand" />
            <span className="ml-auto">
              <MatchRing value={match.match} size={38} />
            </span>
          </header>
          <p className="mt-1 text-heading text-text-primary">{match.name}</p>
          <p className="text-caption text-text-muted">{match.specs}</p>
          <div className="mt-3 flex items-end gap-3">
            <KeyValues
              rows={[
                [
                  "Precio",
                  <span key="price" className="font-semibold">
                    {match.price}
                  </span>,
                ],
                ["Año", match.year],
                ["Km", match.km],
              ]}
            />
            <VehicleVisual
              body={match.body}
              tone="brand"
              className="h-20 w-34"
            />
          </div>
          {match.installment ? (
            <p className="mt-2 text-caption text-text-secondary">
              Cuota estimada {match.installment}
            </p>
          ) : null}
          <ul className="mt-3 flex flex-col gap-0.5 border-t border-brand-border pt-2.5">
            {match.reasons.map((reason) => (
              <li
                key={reason}
                className="flex items-center gap-1.5 text-caption text-text-secondary"
              >
                <CheckIcon className="size-3 shrink-0 text-brand" />
                {reason}
              </li>
            ))}
            {match.match === null ? (
              <li className="text-caption text-text-muted">
                Match sin dato: faltan preferencias. No penaliza.
              </li>
            ) : null}
          </ul>
        </section>
      ) : null}

      {alternative ? (
        <section
          aria-label="Alternativa"
          className="shrink-0 rounded-lg border border-brand-border/70 bg-brand-soft/20 p-4 shadow-card"
        >
          <header className="flex items-center gap-2">
            <h3 className="text-label text-text-muted">Alternativa</h3>
            <span className="ml-auto">
              <MatchRing value={alternative.match} size={30} />
            </span>
          </header>
          <p className="mt-1 text-body leading-5 font-semibold text-text-primary">
            {alternative.name}
          </p>
          <div className="mt-2 flex">
            <KeyValues
              rows={[
                ["Precio", alternative.price],
                ["Año", alternative.year],
              ]}
            />
          </div>
        </section>
      ) : null}

      {tradeIn ? (
        <section
          aria-label="Trade-in"
          className="shrink-0 rounded-lg bg-surface-1 p-4 shadow-card"
        >
          <header className="flex items-center gap-2">
            <h3 className="text-label text-text-muted">Trade-in</h3>
            <span className="ml-auto">
              <Pill
                tone={tradeIn.status === "Detectado" ? "warning" : "neutral"}
              >
                {tradeIn.status}
              </Pill>
            </span>
          </header>
          <p className="mt-1.5 text-body leading-5 font-semibold text-text-primary">
            {tradeIn.vehicle}
          </p>
          <div className="mt-2 flex">
            <KeyValues
              rows={[
                ["Km", tradeIn.km],
                ["Valor", tradeIn.value ?? "Sin valor todavía"],
              ]}
            />
          </div>
        </section>
      ) : null}
    </>
  );
}

/* Matches reales (H1.5, DEC-031). */

const EMPTY_MATCHES: Readonly<Record<MatchRailEmptyReason, string>> = {
  no_demand:
    "Sin dato para buscar matches: falta saber qué vehículo, años o presupuesto busca.",
  no_stock: "No hay unidades disponibles en Stock para comparar.",
  no_match: "Ninguna unidad disponible alcanza 40 de 100 puntos de match.",
};

function MatchReasons({
  reasons,
  className,
}: {
  reasons: MatchCard["reasons"];
  className?: string;
}) {
  return (
    <ul
      aria-label="Por qué es un match"
      className={cn("flex flex-col gap-0.5", className)}
    >
      {reasons.map((reason) => (
        <li
          key={reason}
          className="flex items-center gap-1.5 text-caption text-text-secondary"
        >
          <CheckIcon className="size-3 shrink-0 text-brand" />
          {reason}
        </li>
      ))}
    </ul>
  );
}

function TopMatchCard({ match }: { match: MatchCard }) {
  return (
    <section
      aria-label="Top Match"
      className="shrink-0 rounded-lg border-2 border-brand bg-brand-soft/40 p-4 shadow-card"
    >
      <header className="flex items-center gap-2">
        <h3 className="text-label font-semibold text-brand-strong">
          Top Match
        </h3>
        <CheckIcon className="size-3.5 text-brand" />
        <span className="ml-auto">
          <MatchRing value={match.score.total} size={38} />
        </span>
      </header>
      <p className="mt-1 text-heading text-text-primary">{match.name}</p>
      <p className="text-caption text-text-muted">{match.detail}</p>
      <div className="mt-3 flex">
        <KeyValues
          rows={[
            [
              "Precio",
              <span key="price" className="font-semibold">
                {match.price ?? "Sin precio"}
              </span>,
            ],
            ["Km", match.km ?? "Sin dato"],
          ]}
        />
      </div>
      <MatchReasons
        reasons={match.reasons}
        className="mt-3 border-t border-brand-border pt-2.5"
      />
    </section>
  );
}

function AlternativeMatchCard({ match }: { match: MatchCard }) {
  return (
    <section
      aria-label="Alternativa"
      className="shrink-0 rounded-lg border border-brand-border/70 bg-brand-soft/20 p-4 shadow-card"
    >
      <header className="flex items-center gap-2">
        <h3 className="text-label text-text-muted">Alternativa</h3>
        <span className="ml-auto">
          <MatchRing value={match.score.total} size={30} />
        </span>
      </header>
      <p className="mt-1 text-body leading-5 font-semibold text-text-primary">
        {match.name}
      </p>
      <p className="text-caption text-text-muted">{match.detail}</p>
      <div className="mt-2 flex">
        <KeyValues rows={[["Precio", match.price ?? "Sin precio"]]} />
      </div>
      <MatchReasons reasons={match.reasons} className="mt-2" />
    </section>
  );
}

/**
 * Matches del stock para una oportunidad: Top Match y alternativa con sus
 * razones, o por qué no hay ("sin dato" honesto, nunca un fixture).
 */
export function OpportunityMatches({ rail }: { rail: MatchRail }) {
  return (
    <TooltipProvider delayDuration={350}>
      <section
        aria-labelledby="matches-heading"
        className="flex flex-col gap-3"
      >
        <h2 id="matches-heading" className="text-heading text-text-primary">
          Matches en stock
        </h2>
        {rail.kind === "empty" ? (
          <p className="rounded-lg border border-dashed border-border-default bg-surface-1 p-4 text-body text-text-secondary">
            {EMPTY_MATCHES[rail.reason]}
          </p>
        ) : (
          <>
            <TopMatchCard match={rail.top} />
            {rail.alternative ? (
              <AlternativeMatchCard match={rail.alternative} />
            ) : null}
          </>
        )}
      </section>
    </TooltipProvider>
  );
}
