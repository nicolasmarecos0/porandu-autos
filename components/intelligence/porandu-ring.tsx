import type { ReactNode } from "react";
import { cn } from "@/components/ui/cn";
import { Tooltip } from "@/components/ui/tooltip";
import type {
  ScoreComposition,
  ScoreSet,
  SubScoreKey,
} from "@/domains/scoring/types";

/*
 * Porandú Ring (DEC-015): el Porandú Score como glifo. Un arco por sub-score,
 * proporcional al peso que trae la composición (`ScoreComposition`) y lleno
 * según su valor. La composición es un dato de entrada, no una fórmula fija.
 * Un dato faltante se dibuja punteado y no resta (DEC-005).
 */

function arcPath(center: number, radius: number, from: number, to: number) {
  const x0 = center + radius * Math.cos(from);
  const y0 = center + radius * Math.sin(from);
  const x1 = center + radius * Math.cos(to);
  const y1 = center + radius * Math.sin(to);
  const large = to - from > Math.PI ? 1 : 0;
  return `M ${x0.toFixed(2)} ${y0.toFixed(2)} A ${radius} ${radius} 0 ${large} 1 ${x1.toFixed(2)} ${y1.toFixed(2)}`;
}

const RING_TONES = {
  onBrand: {
    track: "stroke-surface-1/20",
    fill: "stroke-surface-1",
    missing: "stroke-surface-1/50",
  },
  onLight: {
    track: "stroke-brand/15",
    fill: "stroke-brand",
    missing: "stroke-brand/45",
  },
} as const;

type PoranduRingProps = {
  scores: ScoreSet;
  composition: ScoreComposition;
  size: number;
  stroke: number;
  tone: keyof typeof RING_TONES;
  /** Contenido centrado (normalmente el valor). */
  children: ReactNode;
};

export function PoranduRing({
  scores,
  composition,
  size,
  stroke,
  tone,
  children,
}: PoranduRingProps) {
  const center = size / 2;
  const radius = (size - stroke) / 2;
  const gap = (stroke + 3) / radius;
  const colors = RING_TONES[tone];
  const segments = composition.map((part, index) => {
    const offset = composition
      .slice(0, index)
      .reduce((sum, previous) => sum + previous.weight, 0);
    const start = -Math.PI / 2 + offset * Math.PI * 2;
    const span = part.weight * Math.PI * 2;
    return {
      key: part.key,
      value: scores[part.key],
      from: start + gap / 2,
      to: start + span - gap / 2,
    };
  });

  return (
    <span
      className="relative inline-flex shrink-0 items-center justify-center"
      style={{ width: size, height: size }}
    >
      <svg
        width={size}
        height={size}
        viewBox={`0 0 ${size} ${size}`}
        aria-hidden="true"
        focusable="false"
        className="absolute inset-0"
      >
        {segments.map((segment) => (
          <g key={segment.key} fill="none" strokeWidth={stroke}>
            <path
              d={arcPath(center, radius, segment.from, segment.to)}
              className={segment.value === null ? colors.missing : colors.track}
              strokeDasharray={
                segment.value === null
                  ? `${Math.max(stroke * 0.3, 1.5)} ${Math.max(stroke * 0.45, 2)}`
                  : undefined
              }
            />
            {segment.value !== null && segment.value > 0 ? (
              <path
                d={arcPath(
                  center,
                  radius,
                  segment.from,
                  segment.from +
                    ((segment.to - segment.from) * segment.value) / 100,
                )}
                className={colors.fill}
              />
            ) : null}
          </g>
        ))}
      </svg>
      <span className="relative flex flex-col items-center">{children}</span>
    </span>
  );
}

/** Marca qué arco del anillo representa cada sub-score. */
export function RingKey({
  part,
  composition,
}: {
  part: SubScoreKey;
  composition: ScoreComposition;
}) {
  return (
    <span aria-hidden="true" className="flex h-[3px] w-6 gap-px">
      {composition.map((item) => (
        <span
          key={item.key}
          className={cn(
            "h-full rounded-full",
            item.key === part ? "bg-brand-inverse" : "bg-surface-1/20",
          )}
          style={{ width: `${item.weight * 100}%` }}
        />
      ))}
    </span>
  );
}

/** Match de un vehículo con lo que busca el prospecto: un solo arco. */
export function MatchRing({
  value,
  size,
}: {
  value: number | null;
  size: number;
}) {
  const stroke = size >= 40 ? 4 : 3;
  const center = size / 2;
  const radius = (size - stroke) / 2;
  const top = -Math.PI / 2;
  return (
    <Tooltip
      content={
        value === null
          ? "Match sin dato: faltan preferencias. No penaliza."
          : `Coincidencia con lo que busca: ${value}%`
      }
    >
      <span
        className="relative inline-flex shrink-0 items-center justify-center"
        style={{ width: size, height: size }}
      >
        <svg
          width={size}
          height={size}
          viewBox={`0 0 ${size} ${size}`}
          aria-hidden="true"
          focusable="false"
          className="absolute inset-0"
        >
          <circle
            cx={center}
            cy={center}
            r={radius}
            fill="none"
            strokeWidth={stroke}
            className={value === null ? "stroke-brand/40" : "stroke-brand/15"}
            strokeDasharray={value === null ? "2 3" : undefined}
          />
          {value !== null ? (
            <path
              d={arcPath(
                center,
                radius,
                top,
                top + (Math.PI * 2 * Math.min(value, 99.9)) / 100,
              )}
              fill="none"
              strokeWidth={stroke}
              className="stroke-brand"
            />
          ) : null}
        </svg>
        <span
          className={cn(
            "relative font-semibold text-brand-strong tabular-nums",
            size >= 40 ? "text-label" : "text-[0.625rem]",
          )}
        >
          {value === null ? "s/d" : value}
        </span>
        <span className="sr-only">
          {value === null ? "Match sin dato" : `Match ${value}%`}
        </span>
      </span>
    </Tooltip>
  );
}
