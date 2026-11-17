import type { ComponentType } from "react";
import {
  BoltIcon,
  BrandGlyphIcon,
  DocumentIcon,
  GearIcon,
  KeyIcon,
  NoteIcon,
  OpportunitiesIcon,
  PersonIcon,
  PhoneIcon,
  StockIcon,
  TrendUpIcon,
  type IconProps,
} from "@/components/ui/icons";
import { cn } from "@/components/ui/cn";

/*
 * "El Núcleo Porandú" (login, DEC-057): ilustración de marca, no un dato.
 * Las fuentes que Porandú ya tiene (prospectos, bitácora, reglas del motor,
 * stock y demanda) convergen en el núcleo, que entrega lo que el vendedor
 * usa en el salón (Porandú Score, contacto, señales, cotización y cierre).
 * Ningún canal ni integración que el producto no tenga (DEC-055 §7).
 *
 * Geometría fija de 400 × 344 px: las tarjetas (48 px) se reparten con
 * `justify-between`, así sus centros caen en ROW_Y y las curvas del SVG
 * (mismo sistema de coordenadas) llegan a cada una.
 *
 * Motion: los datos viajan por las curvas con SMIL (sin JS) y el núcleo
 * late. Con reduced motion se ocultan y quedan puntos fijos sobre las
 * curvas. Los halos son círculos translúcidos: sin blur ni neón (DEC-013).
 */

const WIDTH = 400;
const HEIGHT = 344;
const CARD = 48;
const ROW_Y = [24, 98, 172, 246, 320] as const;
const CORE = { x: WIDTH / 2, y: HEIGHT / 2 } as const;
/** Borde visible del núcleo: radio de 48 px más el anillo de 8 px. */
const CORE_EDGE = 56;
const GAP = 6;

type Point = Readonly<{ x: number; y: number }>;
type Curve = Readonly<{ from: Point; c1: Point; c2: Point; to: Point }>;

/** De la tarjeta de la fila `row` (izquierda) al núcleo. */
function inboundCurve(row: number): Curve {
  const y = ROW_Y[row]!;
  const from = { x: CARD + GAP, y };
  const to = { x: CORE.x - CORE_EDGE, y: CORE.y };
  const bend = (from.x + to.x) / 2;
  return { from, c1: { x: bend, y }, c2: { x: bend, y: CORE.y }, to };
}

/** Del núcleo a la tarjeta de la fila `row` (derecha). */
function outboundCurve(row: number): Curve {
  const y = ROW_Y[row]!;
  const from = { x: CORE.x + CORE_EDGE, y: CORE.y };
  const to = { x: WIDTH - CARD - GAP, y };
  const bend = (from.x + to.x) / 2;
  return { from, c1: { x: bend, y: CORE.y }, c2: { x: bend, y }, to };
}

function pathData({ from, c1, c2, to }: Curve): string {
  return `M${from.x} ${from.y}C${c1.x} ${c1.y} ${c2.x} ${c2.y} ${to.x} ${to.y}`;
}

/** Punto de la curva en `t` ∈ [0, 1] (Bézier cúbica). */
function pointAt({ from, c1, c2, to }: Curve, t: number): Point {
  const u = 1 - t;
  const a = u * u * u;
  const b = 3 * u * u * t;
  const c = 3 * u * t * t;
  const d = t * t * t;
  return {
    x: a * from.x + b * c1.x + c * c2.x + d * to.x,
    y: a * from.y + b * c1.y + c * c2.y + d * to.y,
  };
}

type Tone = "brand" | "info" | "accent";

const DOT_TONES: Record<Tone, string> = {
  brand: "fill-brand",
  info: "fill-info-bright",
  accent: "fill-accent",
};

type Pulse = Readonly<{
  curve: Curve;
  tone: Tone;
  /** Segundos por recorrido. */
  duration: number;
  /** Desfase negativo: cada pulso arranca en otro punto de su curva. */
  offset: number;
  /** Posición del punto fijo con reduced motion. */
  rest: number;
}>;

/** Datos en tránsito: entran al núcleo y salen como inteligencia. */
const PULSES: readonly Pulse[] = [
  {
    curve: inboundCurve(0),
    tone: "brand",
    duration: 3.4,
    offset: 0.6,
    rest: 0.55,
  },
  {
    curve: inboundCurve(2),
    tone: "accent",
    duration: 2.6,
    offset: 1.4,
    rest: 0.6,
  },
  {
    curve: inboundCurve(3),
    tone: "info",
    duration: 3.8,
    offset: 2.5,
    rest: 0.45,
  },
  {
    curve: outboundCurve(1),
    tone: "brand",
    duration: 3.2,
    offset: 0.2,
    rest: 0.4,
  },
  {
    curve: outboundCurve(4),
    tone: "info",
    duration: 3.6,
    offset: 1.9,
    rest: 0.6,
  },
];

type Node = Readonly<{
  label: string;
  Icon: ComponentType<IconProps>;
  /** Color del ícono: siempre el tono AA de texto, nunca un `*-bright`. */
  tone: string;
}>;

export const CORE_SOURCES: readonly Node[] = [
  { label: "Prospectos", Icon: PersonIcon, tone: "text-brand" },
  { label: "Historial y notas", Icon: NoteIcon, tone: "text-navy" },
  { label: "Reglas del motor", Icon: GearIcon, tone: "text-brand" },
  { label: "Stock y unidades", Icon: StockIcon, tone: "text-navy" },
  { label: "Tendencias de demanda", Icon: TrendUpIcon, tone: "text-brand" },
];

export const CORE_OUTPUTS: readonly Node[] = [
  {
    label: "Porandú Score y prioridad",
    Icon: OpportunitiesIcon,
    tone: "text-accent-strong",
  },
  { label: "Contacto en el salón", Icon: PhoneIcon, tone: "text-brand" },
  { label: "Señales fuertes de compra", Icon: BoltIcon, tone: "text-success" },
  { label: "Cotización en PDF", Icon: DocumentIcon, tone: "text-brand" },
  { label: "Cierre y match de unidad", Icon: KeyIcon, tone: "text-navy" },
];

export function CoreDiagram({ className }: { className?: string }) {
  const curves = [
    ...ROW_Y.map((_, row) => inboundCurve(row)),
    ...ROW_Y.map((_, row) => outboundCurve(row)),
  ];

  return (
    <div
      className={cn("relative shrink-0", className)}
      style={{ width: WIDTH, height: HEIGHT }}
    >
      <svg
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        width={WIDTH}
        height={HEIGHT}
        fill="none"
        aria-hidden="true"
        focusable="false"
        className="absolute inset-0"
      >
        <g
          className="stroke-navy/30"
          strokeWidth={1.5}
          strokeDasharray="4 5"
          strokeLinecap="round"
        >
          {curves.map((curve) => (
            <path key={pathData(curve)} d={pathData(curve)} />
          ))}
        </g>

        {/* En tránsito: SMIL, sin JS. Se oculta con reduced motion. */}
        <g className="motion-reduce:hidden">
          {PULSES.map((pulse) => (
            <g key={pathData(pulse.curve)} opacity={0}>
              <Dot tone={pulse.tone} x={0} y={0} />
              <animateMotion
                path={pathData(pulse.curve)}
                dur={`${pulse.duration}s`}
                begin={`-${pulse.offset}s`}
                repeatCount="indefinite"
                calcMode="spline"
                keyPoints="0;1"
                keyTimes="0;1"
                keySplines="0.45 0 0.25 1"
              />
              <animate
                attributeName="opacity"
                values="0;1;1;0"
                keyTimes="0;0.15;0.8;1"
                dur={`${pulse.duration}s`}
                begin={`-${pulse.offset}s`}
                repeatCount="indefinite"
              />
            </g>
          ))}
        </g>

        {/* Reduced motion: los mismos datos, quietos sobre sus curvas. */}
        <g className="hidden motion-reduce:inline">
          {PULSES.map((pulse) => {
            const { x, y } = pointAt(pulse.curve, pulse.rest);
            return (
              <Dot key={pathData(pulse.curve)} tone={pulse.tone} x={x} y={y} />
            );
          })}
        </g>
      </svg>

      <NodeColumn label="Fuentes de Porandú" nodes={CORE_SOURCES} side="left" />
      <NodeColumn
        label="Inteligencia para el salón"
        nodes={CORE_OUTPUTS}
        side="right"
      />

      <div className="absolute top-1/2 left-1/2 flex -translate-x-1/2 -translate-y-1/2 flex-col items-center">
        <div className="relative flex size-24 items-center justify-center rounded-full bg-linear-to-br from-navy-hover to-navy text-text-inverse shadow-lg ring-8 ring-brand/15">
          <span
            aria-hidden="true"
            className="absolute inset-0 animate-core-pulse rounded-full border-2 border-brand/60 motion-reduce:hidden"
          />
          <BrandGlyphIcon width={44} height={44} />
        </div>
      </div>
      <p className="absolute top-[calc(50%+4.25rem)] left-1/2 -translate-x-1/2 text-overline whitespace-nowrap text-navy uppercase">
        Núcleo Porandú
      </p>
    </div>
  );
}

function Dot({ tone, x, y }: { tone: Tone; x: number; y: number }) {
  return (
    <>
      <circle cx={x} cy={y} r={8} className={DOT_TONES[tone]} opacity={0.18} />
      <circle
        cx={x}
        cy={y}
        r={4}
        className={cn(DOT_TONES[tone], "stroke-surface-1")}
        strokeWidth={1.5}
      />
    </>
  );
}

function NodeColumn({
  label,
  nodes,
  side,
}: {
  label: string;
  nodes: readonly Node[];
  side: "left" | "right";
}) {
  return (
    <ul
      aria-label={label}
      className={cn(
        "absolute inset-y-0 flex flex-col justify-between",
        side === "left" ? "left-0" : "right-0",
      )}
    >
      {nodes.map(({ label: name, Icon, tone }) => (
        <li key={name} className="group relative">
          <span className="flex size-12 items-center justify-center rounded-xl border border-border-subtle bg-surface-1 shadow-md transition-transform duration-200 ease-out-strong group-hover:-translate-y-0.5 motion-reduce:transition-none">
            <Icon width={22} height={22} className={tone} />
          </span>
          {/* Rótulo: arriba de la tarjeta, en el hueco entre filas, para no
              tapar el núcleo. Visible al pasar el mouse; siempre en el DOM
              para los lectores de pantalla. */}
          <span
            className={cn(
              "pointer-events-none absolute bottom-full z-10 mb-1 rounded-md bg-surface-inverse-raised px-2 py-0.5 text-label whitespace-nowrap text-text-inverse opacity-0 shadow-md transition-opacity duration-150 group-hover:opacity-100",
              side === "left" ? "left-0" : "right-0",
            )}
          >
            {name}
          </span>
        </li>
      ))}
    </ul>
  );
}
