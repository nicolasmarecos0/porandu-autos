import type { ReactNode } from "react";
import { cn } from "@/components/ui/cn";

/** Tono de un indicador: el color acompaña al texto, nunca lo reemplaza. */
export type KpiTone = "neutral" | "warning" | "danger";

const VALUE_TONES: Readonly<Record<KpiTone, string>> = {
  neutral: "text-text-primary",
  warning: "text-warning",
  danger: "text-danger",
};

/*
 * Filete lateral como pseudo-elemento: dentro de una `dl`, el `div` que
 * agrupa un par solo puede contener `dt` y `dd`.
 */
const EDGE_TONES: Readonly<Record<KpiTone, string>> = {
  neutral: "",
  warning:
    "before:absolute before:inset-y-0 before:left-0 before:w-1 before:bg-warning",
  danger:
    "before:absolute before:inset-y-0 before:left-0 before:w-1 before:bg-danger",
};

type KpiCardProps = {
  /** Rótulo del indicador ("Oportunidades activas"). */
  label: string;
  /** Valor ya formateado en es-PY ("1.234", "66,7%"). */
  value: string;
  /** Contexto que explica el número. */
  hint: string;
  /** Un valor sin dato se atenúa (DEC-005): no es un cero. */
  muted?: boolean;
  tone?: KpiTone;
  /** Visual que acompaña al valor (p. ej. el medidor del win rate). */
  children?: ReactNode;
};

/**
 * Tarjeta de indicador del Dashboard Directivo (Hito 5, DEC-037 §12): un
 * par `dt`/`dd` dentro de la `dl` de su bloque. Rótulo, valor y contexto; un
 * tono de advertencia o peligro suma un filete lateral y colorea el valor.
 */
export function KpiCard({
  label,
  value,
  hint,
  muted = false,
  tone = "neutral",
  children,
}: KpiCardProps) {
  return (
    <div
      className={cn(
        "relative flex min-h-28 flex-col gap-1 overflow-hidden rounded-lg border border-border-subtle bg-surface-1 px-4 py-3 shadow-card",
        EDGE_TONES[tone],
      )}
    >
      <dt className="text-label text-text-secondary">{label}</dt>
      <dd
        className={cn(
          "text-metric tabular-nums",
          muted ? "text-text-muted" : VALUE_TONES[tone],
        )}
      >
        {value}
      </dd>
      <dd className="mt-auto flex flex-col gap-2 text-caption text-text-muted">
        {children}
        <span>{hint}</span>
      </dd>
    </div>
  );
}

/**
 * Medidor de una proporción (0 a 100): relleno de marca sobre una pista de
 * la misma rampa. Decorativo: el valor ya está escrito en la tarjeta.
 */
export function RatioMeter({ percent }: { percent: number }) {
  const width = Math.min(100, Math.max(0, percent));
  return (
    <span
      aria-hidden="true"
      className="block h-1.5 w-full overflow-hidden rounded-full bg-brand-soft"
    >
      <span
        className="block h-full rounded-full bg-brand"
        style={{ width: `${width}%` }}
      />
    </span>
  );
}
