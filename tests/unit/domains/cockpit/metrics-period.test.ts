import { describe, expect, it } from "vitest";

import {
  DEFAULT_METRICS_PERIOD,
  METRICS_PERIOD_NOTICE_LABELS,
  METRICS_PERIODS,
  METRICS_TIME_ZONE,
  metricsPeriod,
  metricsPeriodSearch,
  PERIOD_PARAM,
  resolveMetricsPeriod,
} from "@/domains/cockpit/metrics-period";
import { presetRange } from "@/domains/dashboard/range";

/*
 * Período de las Métricas del salón (propuesta DEC-050 §3): una ventana de
 * días de calendario de Asunción que termina hoy, elegida en la URL. Puro,
 * con `now` y la zona explícitos.
 */

const ZONE = METRICS_TIME_ZONE;
/** 14:30 del martes 3 de noviembre de 2026 en Asunción (UTC−3). */
const NOW = new Date("2026-11-03T17:30:00Z");

describe("metricsPeriod(): ventanas que terminan hoy", () => {
  it("los últimos 30 días: hoy y los 29 anteriores, del primer instante del primer día al de mañana", () => {
    expect(metricsPeriod("30d", NOW, ZONE)).toStrictEqual({
      kind: "30d",
      start: new Date("2026-10-05T03:00:00.000Z"),
      end: new Date("2026-11-04T03:00:00.000Z"),
      from: "2026-10-05",
      to: "2026-11-03",
      days: 30,
      label: "Últimos 30 días: 5 oct – 3 nov 2026",
      isDefault: true,
    });
  });

  it("los últimos 30 días son la misma ventana que «Últimos 30 días» del Dashboard (DEC-043 §2)", () => {
    const dashboard = presetRange("last_30_days", NOW, ZONE);
    const metrics = metricsPeriod("30d", NOW, ZONE);
    expect(metrics.start).toStrictEqual(dashboard.start);
    expect(metrics.end).toStrictEqual(dashboard.end);
  });

  it("los últimos 7 y 90 días", () => {
    expect(metricsPeriod("7d", NOW, ZONE)).toMatchObject({
      start: new Date("2026-10-28T03:00:00.000Z"),
      end: new Date("2026-11-04T03:00:00.000Z"),
      from: "2026-10-28",
      days: 7,
      label: "Últimos 7 días: 28 oct – 3 nov 2026",
      isDefault: false,
    });
    expect(metricsPeriod("90d", NOW, ZONE)).toMatchObject({
      start: new Date("2026-08-06T03:00:00.000Z"),
      from: "2026-08-06",
      days: 90,
      label: "Últimos 90 días: 6 ago – 3 nov 2026",
    });
  });

  it("todo el historial: sin piso, hasta el fin de hoy", () => {
    expect(metricsPeriod("all", NOW, ZONE)).toStrictEqual({
      kind: "all",
      start: null,
      end: new Date("2026-11-04T03:00:00.000Z"),
      from: null,
      to: "2026-11-03",
      days: null,
      label: "Todo el historial: hasta el 3 nov 2026",
      isDefault: false,
    });
  });

  it("hoy es el día de Asunción: a las 23:30 del 3 de noviembre (ya 4 en UTC) el período termina el 3", () => {
    const period = metricsPeriod("7d", new Date("2026-11-04T02:30:00Z"), ZONE);
    expect(period.to).toBe("2026-11-03");
    expect(period.end).toStrictEqual(new Date("2026-11-04T03:00:00.000Z"));
  });

  it("con cambio de horario, cada día empieza en su primer instante de Asunción", () => {
    // 1 oct 2023: Asunción pasó de UTC−4 a UTC−3 a la medianoche.
    const period = metricsPeriod("7d", new Date("2023-10-03T15:00:00Z"), ZONE);
    expect(period.from).toBe("2023-09-27");
    expect(period.start).toStrictEqual(new Date("2023-09-27T04:00:00.000Z"));
    expect(period.end).toStrictEqual(new Date("2023-10-04T03:00:00.000Z"));
    expect(period.days).toBe(7);
  });

  it("un `now` inválido falla en vez de inventar un período", () => {
    expect(() => metricsPeriod("30d", new Date(Number.NaN), ZONE)).toThrow(
      RangeError,
    );
  });
});

describe("resolveMetricsPeriod(): la URL es input no confiable", () => {
  it("sin parámetro, el período por defecto sin aviso", () => {
    const { period, notice } = resolveMetricsPeriod({}, NOW, ZONE);
    expect(period.kind).toBe(DEFAULT_METRICS_PERIOD);
    expect(period.isDefault).toBe(true);
    expect(notice).toBeNull();
  });

  it.each(METRICS_PERIODS)("acepta %s", (kind) => {
    const { period, notice } = resolveMetricsPeriod(
      { [PERIOD_PARAM]: kind },
      NOW,
      ZONE,
    );
    expect(period.kind).toBe(kind);
    expect(notice).toBeNull();
  });

  it.each(["1y", "", "30D", "30", "custom", "all "])(
    "un valor desconocido (%j) cae a los últimos 30 días con un aviso",
    (value) => {
      const { period, notice } = resolveMetricsPeriod(
        { [PERIOD_PARAM]: value },
        NOW,
        ZONE,
      );
      expect(period.kind).toBe("30d");
      expect(notice).toBe("invalid_period");
      expect(METRICS_PERIOD_NOTICE_LABELS[notice!]).toBe(
        "El período pedido no es válido. Se muestran los últimos 30 días.",
      );
    },
  );

  it("un valor repetido se trata como ausente, como el rango del Dashboard", () => {
    const { period, notice } = resolveMetricsPeriod(
      { [PERIOD_PARAM]: ["7d", "90d"] },
      NOW,
      ZONE,
    );
    expect(period.kind).toBe("30d");
    expect(notice).toBeNull();
  });

  it("ignora otros parámetros", () => {
    const { period } = resolveMetricsPeriod(
      { range: "year", [PERIOD_PARAM]: "7d" },
      NOW,
      ZONE,
    );
    expect(period.kind).toBe("7d");
  });

  it("un `now` inválido falla antes de leer la URL", () => {
    expect(() => resolveMetricsPeriod({}, new Date(Number.NaN), ZONE)).toThrow(
      RangeError,
    );
  });
});

describe("metricsPeriodSearch(): la URL canónica de cada período", () => {
  it("el default no lleva parámetro; el resto, `?period=`", () => {
    expect(metricsPeriodSearch("30d")).toBe("");
    expect(metricsPeriodSearch("7d")).toBe("?period=7d");
    expect(metricsPeriodSearch("90d")).toBe("?period=90d");
    expect(metricsPeriodSearch("all")).toBe("?period=all");
  });

  it.each(METRICS_PERIODS)(
    "es la inversa de resolveMetricsPeriod() (%s)",
    (kind) => {
      const params = Object.fromEntries(
        new URLSearchParams(metricsPeriodSearch(kind)),
      );
      expect(resolveMetricsPeriod(params, NOW, ZONE)).toStrictEqual({
        period: metricsPeriod(kind, NOW, ZONE),
        notice: null,
      });
    },
  );
});
