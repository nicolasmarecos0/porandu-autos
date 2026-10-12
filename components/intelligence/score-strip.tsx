import { cn } from "@/components/ui/cn";
import { Tooltip } from "@/components/ui/tooltip";
import {
  intentBand,
  type ScoreComposition,
  type ScoreExplanation,
  type ScorePenalty,
  type ScoreSet,
  type ScoreValue,
  type SubScoreKey,
} from "@/domains/scoring/types";
import { PoranduRing, RingKey } from "./porandu-ring";
import { formatPoints, ScoreBreakdown } from "./score-breakdown";

/** Nombre corto de cada penalización, para el tile del Porandú. */
const PENALTY_LABELS: Record<ScorePenalty["kind"], string> = {
  inactivity: "Inactividad",
};

/**
 * Lectura de Vehicle Fit y Deal Readiness: el motivo que da el motor
 * (DEC-035). Sin explicación (fixtures de B1) solo se distingue "sin dato".
 */
function reading(
  value: ScoreValue,
  explanation: ScoreExplanation | undefined,
  key: Exclude<SubScoreKey, "intent">,
): string {
  if (value === null) return "Sin dato";
  return explanation?.factors[key] ?? "";
}

/**
 * Strip de scores: franja grafito con el Porandú Score elevado en color de
 * marca (con su anillo) y Intent, Vehicle Fit y Deal Readiness con su lectura.
 * Si el motor restó puntos (inactividad), el tile del Porandú lo dice: el
 * anillo dibuja los sub-scores y el número ya trae el descuento.
 */
export function ScoreStrip({
  scores,
  composition,
  explanation,
}: {
  scores: ScoreSet;
  composition: ScoreComposition;
  explanation?: ScoreExplanation;
}) {
  const tiles: {
    part: SubScoreKey;
    label: string;
    value: number | null;
    note: string;
  }[] = [
    {
      part: "intent",
      label: "Intent",
      value: scores.intent,
      note: intentBand(scores.intent),
    },
    {
      part: "fit",
      label: "Vehicle Fit",
      value: scores.fit,
      note: reading(scores.fit, explanation, "fit"),
    },
    {
      part: "deal",
      label: "Deal",
      value: scores.deal,
      note: reading(scores.deal, explanation, "deal"),
    },
  ];

  return (
    <div className="grid h-24 shrink-0 grid-cols-[1.55fr_repeat(3,minmax(0,1fr))] rounded-lg bg-surface-inverse text-text-inverse shadow-card">
      <Tooltip
        content={
          <ScoreBreakdown
            scores={scores}
            composition={composition}
            explanation={explanation}
          />
        }
      >
        <div className="relative z-[1] -my-2 flex items-center justify-center gap-3.5 rounded-lg bg-brand px-4 shadow-lg">
          <PoranduRing
            scores={scores}
            composition={composition}
            size={68}
            stroke={6}
            tone="onBrand"
          >
            <span className="text-[1.375rem] leading-none font-semibold tracking-tight tabular-nums">
              {scores.porandu ?? "—"}
            </span>
          </PoranduRing>
          <span className="flex flex-col gap-0.5">
            <span className="text-overline uppercase">Porandú</span>
            <span className="text-caption whitespace-nowrap text-brand-inverse">
              Cobertura {Math.round(scores.coverage * 100)}%
            </span>
            {explanation?.penalties.map((penalty) => (
              <span
                key={penalty.kind}
                className="text-caption font-semibold whitespace-nowrap"
              >
                {PENALTY_LABELS[penalty.kind]} {formatPoints(penalty.points)}
              </span>
            ))}
          </span>
        </div>
      </Tooltip>
      {tiles.map((tile, index) => (
        <Tooltip
          key={tile.part}
          content={
            tile.value === null
              ? `${tile.label}: sin dato · no penaliza`
              : `${tile.label} ${tile.value}${tile.note ? ` · ${tile.note}` : ""}`
          }
        >
          <div
            className={cn(
              "flex flex-col items-center justify-center gap-1",
              index > 0 && "border-l border-border-inverse",
            )}
          >
            <span className="flex items-center gap-1.5 text-overline text-text-inverse-muted uppercase">
              <RingKey part={tile.part} composition={composition} />
              {tile.label}
            </span>
            <span
              className={cn(
                "text-metric tabular-nums",
                tile.value === null && "text-text-inverse-muted",
              )}
            >
              {tile.value ?? "—"}
            </span>
            <span className="max-w-full truncate px-2 text-caption text-text-inverse-muted">
              {tile.value === null ? "Sin dato" : tile.note}
            </span>
          </div>
        </Tooltip>
      ))}
    </div>
  );
}
