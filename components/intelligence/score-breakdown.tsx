import { cn } from "@/components/ui/cn";
import {
  SUB_SCORE_LABELS,
  type ScoreComposition,
  type ScoreExplanation,
  type ScoreSet,
} from "@/domains/scoring/types";

/** Puntos con signo tipográfico: "−40". */
export function formatPoints(points: number): string {
  return points < 0 ? `−${Math.abs(points)}` : `+${points}`;
}

/**
 * Desglose explicable del Porandú Score (DEC-004, DEC-005, DEC-035). Los
 * pesos vienen de la composición recibida, que desde Hito 3 es la del motor.
 * Con la explicación del motor, cada sub-score dice por qué vale lo que vale
 * y se listan las penalizaciones (la inactividad) o el resultado de una
 * oportunidad cerrada.
 */
export function ScoreBreakdown({
  scores,
  composition,
  explanation,
}: {
  scores: ScoreSet;
  composition: ScoreComposition;
  explanation?: ScoreExplanation;
}) {
  return (
    <div className="flex w-60 flex-col gap-1.5 py-0.5">
      <div className="flex items-baseline justify-between font-semibold">
        <span>Porandú Score</span>
        <span
          className={cn(
            "tabular-nums",
            scores.porandu === null && "font-normal italic",
          )}
        >
          {scores.porandu ?? "sin dato"}
        </span>
      </div>
      {explanation?.outcome ? (
        <p className="text-caption text-text-inverse">{explanation.outcome}</p>
      ) : null}
      {composition.map((part) => {
        const value = scores[part.key];
        return (
          <div key={part.key} className="text-caption">
            <div className="flex items-baseline justify-between text-text-inverse-muted">
              <span>
                {SUB_SCORE_LABELS[part.key]} · {Math.round(part.weight * 100)}%
              </span>
              <span
                className={cn(
                  "tabular-nums",
                  value === null ? "italic" : "text-text-inverse",
                )}
              >
                {value ?? "sin dato"}
              </span>
            </div>
            {explanation ? (
              <p className="text-text-inverse-muted/80">
                {explanation.factors[part.key]}
              </p>
            ) : null}
          </div>
        );
      })}
      {explanation?.penalties.map((penalty) => (
        <div
          key={penalty.kind}
          className="flex items-baseline justify-between gap-3 text-caption text-text-inverse"
        >
          <span>{penalty.label}</span>
          <span className="font-semibold tabular-nums">
            {formatPoints(penalty.points)}
          </span>
        </div>
      ))}
      <div className="border-t border-border-inverse pt-1.5 text-caption text-text-inverse-muted">
        Cobertura {Math.round(scores.coverage * 100)}%
        {scores.coverage < 1 ? " · el dato faltante no penaliza" : null}
      </div>
    </div>
  );
}
