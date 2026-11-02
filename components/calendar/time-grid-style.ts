import type { CSSProperties } from "react";

import type { TimeGridPlacement } from "@/domains/calendar/time-grid";

/*
 * Geometría de la grilla horaria (DEC-045 §3) en CSS. Sin "use client": la
 * usan la grilla (Server Component) y la línea "ahora" (cliente).
 */

/** Una fracción (0 a 1) como porcentaje CSS, con hasta cuatro decimales. */
export function percent(fraction: number): string {
  return `${Number((fraction * 100).toFixed(4))}%`;
}

/**
 * Posición absoluta de un bloque en la columna de su día, con un respiro
 * de 1px arriba y abajo y de 2px a los lados, para que dos bloques
 * seguidos o vecinos nunca se toquen.
 */
export function blockStyle({
  top,
  height,
  lane,
  lanes,
}: TimeGridPlacement): CSSProperties {
  return {
    top: `calc(${percent(top)} + 1px)`,
    height: `calc(${percent(height)} - 2px)`,
    left: `calc(${percent(lane / lanes)} + 2px)`,
    width: `calc(${percent(1 / lanes)} - 4px)`,
  };
}
