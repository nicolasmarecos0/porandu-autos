"use client";

import Link from "next/link";
import { useState, type ReactNode } from "react";
import { cn } from "@/components/ui/cn";
import type { DemandFact } from "@/domains/demand/facts";
import {
  NO_DATA,
  UNDEFINED_VEHICLE,
  type DemandFactSummary,
  type DemandSummary,
} from "@/domains/demand/presentation";

import { DemandEditDrawer, type DemandSaved } from "./demand-edit-drawer";

/*
 * Card "Busca" (H1.4, DEC-030 §10): lo que busca el cliente según Current
 * Truth, en la columna derecha de /opportunities. Edición en el drawer "Lo
 * que busca"; el historial y la explicación viven en /opportunities/[id].
 *
 * - Título: el vehículo. El legado de H1.1/H1.2 aparece solo si nunca se
 *   cargó un vehículo, marcado "Dato anterior".
 * - Sin dato se dice; un dato quitado, "Sin dato (Quitado)".
 * - Los valores humanos no llevan marca; "Detectado" (H2a+), advertencia.
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

function FactValue({ fact }: { fact: DemandFactSummary }) {
  if (fact.display === null) {
    return (
      <span className="text-text-muted">
        {NO_DATA}
        {fact.unknownReason === "withdrawn" ? " (Quitado)" : null}
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1.5">
      {fact.display}
      {fact.status === "detected" ? (
        <Pill tone="warning">Detectado</Pill>
      ) : null}
    </span>
  );
}

/** Filas de la card, en el orden de las preguntas. */
const ROWS: readonly [DemandFact, string][] = [
  ["year_range", "Año"],
  ["budget_max", "Presupuesto"],
  ["purchase_type", "Pago"],
  ["down_payment", "Entrega inicial"],
  ["trade_in_intent", "Usado"],
];

type DemandCardProps = {
  opportunityId: string;
  demand: DemandSummary;
};

export function DemandCard({ opportunityId, demand }: DemandCardProps) {
  const [saved, setSaved] = useState<DemandSaved | null>(null);
  const { vehicle, facts } = demand;
  const vehicleFact = facts.desired_vehicle;
  return (
    <section
      aria-label="Lo que busca"
      className="shrink-0 rounded-lg bg-surface-1 p-4 shadow-card"
    >
      <header className="flex items-center gap-2">
        <h3 className="text-label text-text-muted">Busca</h3>
        {facts.trade_in_intent.input.tradeIn === "yes" ? (
          <Pill tone="brand">Con trade-in</Pill>
        ) : null}
        <span className="ml-auto flex items-center gap-2">
          <Link
            href={`/opportunities/${opportunityId}`}
            className="rounded-sm text-caption text-brand hover:text-brand-strong hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring"
          >
            Ver historial
          </Link>
          <DemandEditDrawer
            opportunityId={opportunityId}
            summary={demand}
            onSaved={setSaved}
          />
        </span>
      </header>
      <p className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-heading text-text-primary">
        {vehicle ? vehicle.title : UNDEFINED_VEHICLE}
        {vehicle?.source === "legacy" ? (
          <Pill tone="neutral">Dato anterior</Pill>
        ) : null}
        {vehicle?.source === "demand" && vehicleFact.status === "detected" ? (
          <Pill tone="warning">Detectado</Pill>
        ) : null}
        {!vehicle && vehicleFact.unknownReason === "withdrawn" ? (
          <span className="text-label text-text-muted">(Quitado)</span>
        ) : null}
      </p>
      <dl className="mt-3 grid grid-cols-[6.5rem_1fr] gap-x-2 gap-y-1 text-label">
        {ROWS.map(([fact, label]) => (
          <div key={fact} className="contents">
            <dt className="text-text-muted">{label}</dt>
            <dd className="text-text-primary tabular-nums">
              <FactValue fact={facts[fact]} />
            </dd>
          </div>
        ))}
      </dl>
      <div role="status" className={saved ? "mt-2" : "sr-only"}>
        {saved ? (
          <p className="text-caption text-success">
            {saved.status === "saved"
              ? "Guardado."
              : "No había cambios para guardar."}
          </p>
        ) : null}
      </div>
    </section>
  );
}
