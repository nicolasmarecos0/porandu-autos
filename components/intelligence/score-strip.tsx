import { cn } from "@/components/ui/cn";
import { Tooltip } from "@/components/ui/tooltip";
import {
  intentBand,
  type ScoreComposition,
  type ScoreSet,
  type ScoreValue,
  type SubScoreKey,
} from "@/domains/scoring/types";
import { PoranduRing, RingKey } from "./porandu-ring";
import { ScoreBreakdown } from "./score-breakdown";

/*
 * Lecturas visuales temporales del mock de B1 para Vehicle Fit y Deal
 * Readiness. Sus umbrales no son reglas de negocio ni scoring aprobado: solo
 * la escala de Intent está definida (Visual Blueprint §3).
 */
function mockFitReading(value: ScoreValue): string {
  if (value === null) return "Sin dato";
  if (value >= 85) return "Coincidencia alta";
  if (value >= 70) return "Coincidencia media";
  return "Coincidencia baja";
}

function mockDealReading(value: ScoreValue): string {
  if (value === null) return "Sin dato";
  if (value >= 80) return "Operación viable";
  if (value >= 60) return "Faltan condiciones";
  return "Operación trabada";
}

/**
 * Strip de scores: franja grafito con el Porandú Score elevado en color de
 * marca (con su anillo) y Intent, Vehicle Fit y Deal Readiness con su lectura.
 */
export function ScoreStrip({
  scores,
  composition,
}: {
  scores: ScoreSet;
  composition: ScoreComposition;
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
      note: mockFitReading(scores.fit),
    },
    {
      part: "deal",
      label: "Deal",
      value: scores.deal,
      note: mockDealReading(scores.deal),
    },
  ];

  return (
    <div className="grid h-24 shrink-0 grid-cols-[1.55fr_repeat(3,minmax(0,1fr))] rounded-lg bg-surface-inverse text-text-inverse shadow-card">
      <Tooltip
        content={<ScoreBreakdown scores={scores} composition={composition} />}
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
              {scores.porandu}
            </span>
          </PoranduRing>
          <span className="flex flex-col gap-0.5">
            <span className="text-overline uppercase">Porandú</span>
            <span className="text-caption whitespace-nowrap text-brand-inverse">
              Cobertura {Math.round(scores.coverage * 100)}%
            </span>
          </span>
        </div>
      </Tooltip>
      {tiles.map((tile, index) => (
        <Tooltip
          key={tile.part}
          content={
            tile.value === null
              ? `${tile.label}: sin dato · no penaliza`
              : `${tile.label} ${tile.value} · ${tile.note}`
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
            <span className="text-caption text-text-inverse-muted">
              {tile.value === null ? "Sin dato" : tile.note}
            </span>
          </div>
        </Tooltip>
      ))}
    </div>
  );
}
