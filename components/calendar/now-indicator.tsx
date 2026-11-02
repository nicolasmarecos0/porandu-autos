"use client";

import { useEffect, useState } from "react";

import { CALENDAR_TIME_ZONE } from "@/domains/calendar/test-drives";
import { timeGridNow, type TimeGridRange } from "@/domains/calendar/time-grid";

import { percent } from "./time-grid-style";

/*
 * Línea "ahora" de la grilla horaria (DEC-045 §3): sobre la columna del día
 * de hoy, a la altura de la hora de Asunción. Arranca con el `now` del
 * request (el HTML del servidor y el del navegador coinciden) y se mueve
 * sola cada minuto y al volver a la pestaña; si pasa la medianoche, salta a
 * la columna del día siguiente o desaparece si la semana ya terminó. Es
 * solo visual: no revalida la agenda ni cambia lo que se puede hacer.
 */

const TICK_MS = 60_000;

export function NowIndicator({
  dates,
  range,
  nowIso,
}: {
  /** `YYYY-MM-DD` de los días de la grilla, de lunes a domingo. */
  dates: readonly string[];
  range: TimeGridRange;
  nowIso: string;
}) {
  const [now, setNow] = useState(() => new Date(nowIso));

  useEffect(() => {
    const tick = () => setNow(new Date());
    const timer = window.setInterval(tick, TICK_MS);
    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") tick();
    };
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, []);

  const position = timeGridNow(now, dates, range, CALENDAR_TIME_ZONE);
  if (!position || dates.length === 0) return null;

  return (
    <div
      aria-hidden="true"
      data-now-indicator=""
      className="pointer-events-none absolute z-20 flex -translate-y-1/2 items-center"
      style={{
        top: percent(position.offset),
        left: percent(position.dayIndex / dates.length),
        width: percent(1 / dates.length),
      }}
    >
      <span className="-ml-1 size-2 shrink-0 rounded-full bg-brand ring-2 ring-surface-1" />
      <span className="h-0.5 flex-1 bg-brand" />
    </div>
  );
}
