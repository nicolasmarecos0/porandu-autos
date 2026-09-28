"use client";

import { useId } from "react";
import { cn } from "@/components/ui/cn";
import type { BodyType } from "@/domains/vehicles/types";

/*
 * Vehicle Visual Resolver mínimo (B1 §3.2): silueta genérica por carrocería
 * con fallback neutro. Siempre lleva la etiqueta "Representación"; las fotos
 * reales se usan solo en Stock.
 */

type Silhouette = {
  body: string;
  windows: readonly string[];
  wheels: readonly number[];
  r: number;
  /** Línea de cintura: x inicial, x final, y. */
  belt: readonly [number, number, number];
  /** Corte de puerta: x, y inicial, y final. */
  door: readonly [number, number, number];
  head: readonly [number, number, number, number];
  tail: readonly [number, number, number, number];
  /** Altura donde empieza la moldura inferior. */
  cladding: number;
  bed?: readonly [number, number, number];
};

const silhouettes: Record<BodyType, Silhouette> = {
  suv: {
    body: "M10 46V35q0-6 6-7l11-1 10-12q2.5-2.5 6-2.5h57q4 0 7 3l11 10.5 25 3.5q8 1 9 7.5v8q0 3-3 3h-14.5a12.5 12.5 0 0 0-25 0h-57a12.5 12.5 0 0 0-25 0H13q-3 0-3-2z",
    windows: [
      "M40 26l6-9.5q1.5-1.5 3.5-1.5H70v11z",
      "M74 15h24.5q3 0 5 2l9 9H74z",
    ],
    wheels: [40, 122],
    r: 10,
    belt: [30, 116, 28],
    door: [72, 26.5, 44],
    head: [143.5, 31, 7.5, 2.8],
    tail: [10.5, 30, 2.6, 5],
    cladding: 41.5,
  },
  pickup: {
    body: "M8 46V33q0-3 3-3h53l4-14.5q1-3 4.5-3H101q4 0 7 3l10.5 11 26.5 3.5q7 1 8 7.5v7.5q0 3-3 3h-14.5a12.5 12.5 0 0 0-25 0h-59a12.5 12.5 0 0 0-25 0H11q-3 0-3-2z",
    windows: [
      "M70.5 26l2.5-9.5q.5-1.5 2.5-1.5H88v11z",
      "M92 15h8.5q3 0 5 2l8.5 9H92z",
    ],
    wheels: [39, 123],
    r: 10,
    belt: [67, 117, 28],
    door: [90, 26.5, 44],
    head: [145.5, 33, 7, 2.8],
    tail: [8.5, 32, 2.4, 6],
    cladding: 42,
    bed: [10, 62, 33.5],
  },
  sedan: {
    body: "M8 45v-8q0-4 5-5l20-2.5 16-12q3-2 7-2h37q4.5 0 8 2.5l15 10.5 27 3q9 1 10 7.5v6q0 3-3 3h-14.5a12.5 12.5 0 0 0-25 0h-59a12.5 12.5 0 0 0-25 0H11q-3 0-3-3z",
    windows: [
      "M47 28.5l8.5-9q1.5-1.5 3.5-1.5h16v10.5z",
      "M79 18h13.5q3.5 0 6 2l9.5 8.5H79z",
    ],
    wheels: [39, 123],
    r: 10,
    belt: [38, 114, 30],
    door: [77, 29, 44],
    head: [145.5, 34, 7, 2.4],
    tail: [8.5, 34, 2.8, 3.5],
    cladding: 43,
  },
  hatch: {
    body: "M16 45V31q0-4 4-5l10-9.5q3-3 7-3h51q4.5 0 8 3l13 11 26 3.5q10 1.5 11 8v6q0 3-3 3h-11.5a11.5 11.5 0 0 0-23 0h-55a11.5 11.5 0 0 0-23 0H19q-3 0-3-3z",
    windows: [
      "M31 26l6.5-8.5q1.5-1.5 3.5-1.5h21v10z",
      "M66 16h21q3.5 0 6 2.5l8.5 7.5H66z",
    ],
    wheels: [42, 120],
    r: 9.5,
    belt: [24, 106, 28],
    door: [64, 26.5, 44],
    head: [138.5, 33.5, 7, 2.4],
    tail: [16.5, 29, 2.4, 5],
    cladding: 43,
  },
};

const VISUAL_TONES = {
  neutral: {
    top: "var(--color-surface-3)",
    bottom: "var(--color-border-strong)",
    trim: "var(--color-text-muted)",
    stage: "bg-linear-to-b from-surface-1 to-surface-3",
  },
  brand: {
    top: "var(--color-brand-soft)",
    bottom: "var(--color-brand-inverse)",
    trim: "var(--color-brand-strong)",
    stage: "bg-linear-to-b from-surface-1 to-brand-soft",
  },
} as const;

type VehicleVisualProps = {
  body: BodyType;
  tone?: "neutral" | "brand";
  className?: string;
};

/**
 * Silueta genérica por carrocería (carrocería, vidrios, cintura, ópticas y
 * llantas). Siempre lleva la etiqueta "Representación": las fotos reales solo
 * se usan en Stock.
 */
export function VehicleVisual({
  body,
  tone = "neutral",
  className,
}: VehicleVisualProps) {
  const shape = silhouettes[body];
  const colors = VISUAL_TONES[tone];
  const uid = useId().replace(/[^a-zA-Z0-9_-]/g, "");
  const ids = {
    paint: `${uid}-paint`,
    glass: `${uid}-glass`,
    shadow: `${uid}-shadow`,
    clip: `${uid}-clip`,
  };
  const [beltFrom, beltTo, beltY] = shape.belt;
  const [doorX, doorFrom, doorTo] = shape.door;
  const trim = { stroke: colors.trim };

  return (
    <figure
      className={cn(
        "relative flex items-end justify-center overflow-hidden rounded-md",
        colors.stage,
        className,
      )}
    >
      <svg
        viewBox="0 0 160 62"
        className="mb-0.5 w-[88%]"
        aria-hidden="true"
        focusable="false"
      >
        <defs>
          <linearGradient id={ids.paint} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" style={{ stopColor: colors.top }} />
            <stop offset="1" style={{ stopColor: colors.bottom }} />
          </linearGradient>
          <linearGradient id={ids.glass} x1="0" y1="0" x2="1" y2="1">
            <stop
              offset="0"
              style={{
                stopColor: "var(--color-surface-inverse-raised)",
                stopOpacity: 0.85,
              }}
            />
            <stop
              offset="1"
              style={{
                stopColor: "var(--color-surface-inverse)",
                stopOpacity: 0.7,
              }}
            />
          </linearGradient>
          <radialGradient id={ids.shadow}>
            <stop
              offset="0"
              style={{
                stopColor: "var(--color-text-primary)",
                stopOpacity: 0.26,
              }}
            />
            <stop
              offset="1"
              style={{ stopColor: "var(--color-text-primary)", stopOpacity: 0 }}
            />
          </radialGradient>
          <clipPath id={ids.clip}>
            <path d={shape.body} />
          </clipPath>
        </defs>

        <ellipse
          cx="80"
          cy="57.5"
          rx="74"
          ry="4"
          fill={`url(#${ids.shadow})`}
        />
        <path d={shape.body} fill={`url(#${ids.paint})`} />
        <rect
          x="0"
          y={shape.cladding}
          width="160"
          height="10"
          clipPath={`url(#${ids.clip})`}
          style={{ fill: colors.trim, opacity: 0.3 }}
        />
        {shape.windows.map((d) => (
          <path key={d} d={d} fill={`url(#${ids.glass})`} />
        ))}
        <g fill="none" style={trim}>
          <path
            d={`M ${beltFrom} ${beltY} H ${beltTo}`}
            strokeWidth={0.6}
            opacity={0.35}
          />
          <path
            d={`M ${doorX} ${doorFrom} V ${doorTo}`}
            strokeWidth={0.5}
            opacity={0.3}
          />
          {shape.bed ? (
            <path
              d={`M ${shape.bed[0]} ${shape.bed[2]} H ${shape.bed[1]}`}
              strokeWidth={0.6}
              opacity={0.35}
            />
          ) : null}
        </g>
        <rect
          x={shape.head[0]}
          y={shape.head[1]}
          width={shape.head[2]}
          height={shape.head[3]}
          rx={1.2}
          style={{ fill: "var(--color-surface-1)" }}
        />
        <rect
          x={shape.tail[0]}
          y={shape.tail[1]}
          width={shape.tail[2]}
          height={shape.tail[3]}
          rx={1}
          style={{ fill: "var(--color-danger)", opacity: 0.6 }}
        />
        {shape.wheels.map((cx) => (
          <g key={cx}>
            <circle
              cx={cx}
              cy="48"
              r={shape.r}
              style={{ fill: "var(--color-text-primary)" }}
            />
            <circle
              cx={cx}
              cy="48"
              r={shape.r * 0.64}
              style={{ fill: "var(--color-surface-3)" }}
            />
            <g
              style={{ stroke: "var(--color-border-strong)" }}
              strokeWidth={1.1}
            >
              {[0, 1, 2, 3, 4].map((spoke) => {
                const angle = (spoke * 72 - 90) * (Math.PI / 180);
                return (
                  <path
                    key={spoke}
                    d={`M ${(cx + Math.cos(angle) * shape.r * 0.18).toFixed(2)} ${(48 + Math.sin(angle) * shape.r * 0.18).toFixed(2)} L ${(cx + Math.cos(angle) * shape.r * 0.6).toFixed(2)} ${(48 + Math.sin(angle) * shape.r * 0.6).toFixed(2)}`}
                  />
                );
              })}
            </g>
            <circle
              cx={cx}
              cy="48"
              r={shape.r * 0.2}
              style={{ fill: "var(--color-text-secondary)" }}
            />
          </g>
        ))}
      </svg>
      <figcaption className="absolute top-1.5 left-1.5 rounded-xs bg-surface-1/90 px-1.5 text-caption text-text-muted">
        Representación
      </figcaption>
    </figure>
  );
}
