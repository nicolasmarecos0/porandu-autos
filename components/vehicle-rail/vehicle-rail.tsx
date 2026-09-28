import type { ReactNode } from "react";
import { MatchRing } from "@/components/intelligence/porandu-ring";
import { cn } from "@/components/ui/cn";
import { CheckIcon } from "@/components/ui/icons";
import type { Opportunity } from "@/domains/opportunities/types";
import { VehicleVisual } from "./vehicle-visual";

/*
 * Vehicle Rail: vehículo buscado, Top Match (resaltado), alternativa y
 * trade-in. Tarjetas apiladas con pares clave-valor, como la columna derecha
 * de la referencia.
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
  const { interest, topMatch: match, alternative, tradeIn } = opportunity;
  return (
    <>
      <section
        aria-label="Vehículo buscado"
        className="shrink-0 rounded-lg bg-surface-1 p-4 shadow-card"
      >
        <header className="flex items-center gap-2">
          <h3 className="text-label text-text-muted">Busca</h3>
          <Pill tone="neutral">{interest.condition}</Pill>
          {tradeIn ? <Pill tone="brand">Con trade-in</Pill> : null}
        </header>
        <p className="mt-2 text-heading text-text-primary">
          {interest.quantity ? `${interest.quantity}× ` : null}
          {interest.model}
        </p>
        <p className="text-label text-text-secondary">{interest.version}</p>
        <div className="mt-3 flex items-end gap-3">
          <KeyValues
            rows={[
              ["Presupuesto", interest.budget],
              ["Pago", interest.payment.split(" · ")[0]],
            ]}
          />
          <VehicleVisual body={interest.body} className="h-20 w-34" />
        </div>
      </section>

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
          <VehicleVisual body={match.body} tone="brand" className="h-20 w-34" />
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
