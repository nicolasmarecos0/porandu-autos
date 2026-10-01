import { cn } from "@/components/ui/cn";
import {
  SUB_SCORE_LABELS,
  type ScoreComposition,
  type ScoreSet,
} from "@/domains/scoring/types";

/**
 * Desglose explicable del Porandú Score (DEC-004, DEC-005). Los pesos que se
 * muestran vienen de la composición recibida, no de una fórmula del dominio.
 */
export function ScoreBreakdown({
  scores,
  composition,
}: {
  scores: ScoreSet;
  composition: ScoreComposition;
}) {
  return (
    <div className="flex w-56 flex-col gap-1.5 py-0.5">
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
      {composition.map((part) => {
        const value = scores[part.key];
        return (
          <div
            key={part.key}
            className="flex items-baseline justify-between text-caption text-text-inverse-muted"
          >
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
        );
      })}
      <div className="border-t border-border-inverse pt-1.5 text-caption text-text-inverse-muted">
        Cobertura {Math.round(scores.coverage * 100)}%
        {scores.coverage < 1 ? " · el dato faltante no penaliza" : null}
      </div>
    </div>
  );
}
