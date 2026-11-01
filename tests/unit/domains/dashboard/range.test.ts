import { describe, expect, it } from "vitest";

import { DASHBOARD_TIME_ZONE, monthWindow } from "@/domains/dashboard/period";
import {
  MAX_RANGE_DAYS,
  presetRange,
  rangeKey,
  rangeSearchParams,
  resolveDashboardRange,
  type RangeSearchParams,
} from "@/domains/dashboard/range";

/*
 * Rango de fechas del Dashboard Directivo (propuesta DEC-043 §2): días de
 * calendario de Asunción, inclusive, como intervalo de instantes [start,
 * end). Asunción es UTC-3 todo el año desde octubre de 2024, así que cada
 * día empieza a las 03:00 UTC.
 */

/** 12:00 del domingo 1 de noviembre de 2026 en Asunción. */
const NOW = new Date("2026-11-01T15:00:00Z");

const resolve = (params: RangeSearchParams, now = NOW) =>
  resolveDashboardRange(params, now, DASHBOARD_TIME_ZONE);

const instants = (params: RangeSearchParams, now = NOW) => {
  const { range } = resolve(params, now);
  return { start: range.start.toISOString(), end: range.end.toISOString() };
};

describe("resolveDashboardRange: sin parámetros", () => {
  it("es el mes en curso de Asunción, con la misma ventana que DEC-037 §4", () => {
    const { range, notice } = resolve({});

    expect(notice).toBeNull();
    expect(range).toMatchObject({
      kind: "month",
      from: "2026-11-01",
      to: "2026-11-30",
      days: 30,
      label: "Mes en curso: noviembre de 2026",
      isDefault: true,
    });
    const month = monthWindow(NOW, DASHBOARD_TIME_ZONE);
    expect(range.start).toEqual(month.start);
    expect(range.end).toEqual(month.end);
    expect(instants({})).toEqual({
      start: "2026-11-01T03:00:00.000Z",
      end: "2026-12-01T03:00:00.000Z",
    });
  });

  it("el día es el de Asunción, no el de UTC", () => {
    // 23:59:59.999 del 31 de octubre en Asunción: ya es noviembre en UTC.
    const { range } = resolve({}, new Date("2026-11-01T02:59:59.999Z"));
    expect(range.from).toBe("2026-10-01");
    expect(range.label).toBe("Mes en curso: octubre de 2026");
  });

  it("un `now` inválido es un error de programación", () => {
    expect(() => resolve({}, new Date(Number.NaN))).toThrow(RangeError);
  });
});

describe("resolveDashboardRange: presets", () => {
  it("mes anterior", () => {
    const { range, notice } = resolve({ range: "previous_month" });
    expect(notice).toBeNull();
    expect(range).toMatchObject({
      kind: "previous_month",
      from: "2026-10-01",
      to: "2026-10-31",
      days: 31,
      label: "Mes anterior: octubre de 2026",
      isDefault: false,
    });
    expect(instants({ range: "previous_month" })).toEqual({
      start: "2026-10-01T03:00:00.000Z",
      end: "2026-11-01T03:00:00.000Z",
    });
  });

  it("el mes anterior a enero es diciembre del año anterior", () => {
    const { range } = resolve(
      { range: "previous_month" },
      new Date("2027-01-10T15:00:00Z"),
    );
    expect(range.from).toBe("2026-12-01");
    expect(range.to).toBe("2026-12-31");
    expect(range.label).toBe("Mes anterior: diciembre de 2026");
  });

  it("últimos 30 días: hoy y los 29 anteriores", () => {
    const { range } = resolve({ range: "last_30_days" });
    expect(range).toMatchObject({
      from: "2026-10-03",
      to: "2026-11-01",
      days: 30,
      label: "Últimos 30 días: 3 oct – 1 nov 2026",
    });
    expect(instants({ range: "last_30_days" })).toEqual({
      start: "2026-10-03T03:00:00.000Z",
      end: "2026-11-02T03:00:00.000Z",
    });
  });

  it("últimos 30 días que cruzan el año", () => {
    const { range } = resolve(
      { range: "last_30_days" },
      new Date("2027-01-10T15:00:00Z"),
    );
    expect(range.label).toBe("Últimos 30 días: 12 dic 2026 – 10 ene 2027");
  });

  it("trimestre en curso", () => {
    const { range } = resolve({ range: "quarter" });
    expect(range).toMatchObject({
      from: "2026-10-01",
      to: "2026-12-31",
      days: 92,
      label: "Trimestre en curso: 1 oct – 31 dic 2026",
    });
  });

  it("año en curso", () => {
    const { range } = resolve({ range: "year" });
    expect(range).toMatchObject({
      from: "2026-01-01",
      to: "2026-12-31",
      days: 365,
      label: "Año en curso: 2026",
    });
    expect(instants({ range: "year" })).toEqual({
      start: "2026-01-01T03:00:00.000Z",
      end: "2027-01-01T03:00:00.000Z",
    });
  });

  it("presetRange() da lo mismo que pedirlo por la URL", () => {
    expect(presetRange("quarter", NOW, DASHBOARD_TIME_ZONE)).toEqual(
      resolve({ range: "quarter" }).range,
    );
  });
});

describe("resolveDashboardRange: personalizado", () => {
  it("de `from` a `to`, los dos días incluidos", () => {
    const { range, notice } = resolve({
      range: "custom",
      from: "2026-10-05",
      to: "2026-10-20",
    });
    expect(notice).toBeNull();
    expect(range).toMatchObject({
      kind: "custom",
      from: "2026-10-05",
      to: "2026-10-20",
      days: 16,
      label: "Personalizado: 5 – 20 oct 2026",
      isDefault: false,
    });
    expect(range.start.toISOString()).toBe("2026-10-05T03:00:00.000Z");
    expect(range.end.toISOString()).toBe("2026-10-21T03:00:00.000Z");
  });

  it("un solo día", () => {
    const { range } = resolve({
      range: "custom",
      from: "2026-10-05",
      to: "2026-10-05",
    });
    expect(range.days).toBe(1);
    expect(range.label).toBe("Personalizado: 5 oct 2026");
  });

  it("un `to` posterior a hoy se recorta a hoy", () => {
    const { range, notice } = resolve({
      range: "custom",
      from: "2026-10-15",
      to: "2026-12-31",
    });
    expect(notice).toBeNull();
    expect(range.to).toBe("2026-11-01");
    expect(range.end.toISOString()).toBe("2026-11-02T03:00:00.000Z");
  });

  it(`admite hasta ${MAX_RANGE_DAYS} días`, () => {
    const { range, notice } = resolve({
      range: "custom",
      from: "2025-11-01",
      to: "2026-11-01",
    });
    expect(notice).toBeNull();
    expect(range.days).toBe(MAX_RANGE_DAYS);
  });

  it("más largo: cae al mes en curso con aviso", () => {
    const { range, notice } = resolve({
      range: "custom",
      from: "2025-10-31",
      to: "2026-11-01",
    });
    expect(notice).toBe("range_too_long");
    expect(range.kind).toBe("month");
  });

  it.each([
    ["sin fechas", {}],
    ["sin `to`", { from: "2026-10-01" }],
    ["fecha inexistente", { from: "2026-02-30", to: "2026-03-10" }],
    ["formato inválido", { from: "01/10/2026", to: "2026-10-10" }],
    ["fuera de 2000–2100", { from: "1999-12-31", to: "2026-10-10" }],
    ["`from` posterior a `to`", { from: "2026-10-20", to: "2026-10-05" }],
    ["`from` en el futuro", { from: "2026-11-05", to: "2026-11-10" }],
  ])("%s: cae al mes en curso con aviso", (_name, dates) => {
    const { range, notice } = resolve({ range: "custom", ...dates });
    expect(notice).toBe("invalid_range");
    expect(range.kind).toBe("month");
    expect(range.isDefault).toBe(true);
  });
});

describe("resolveDashboardRange: input no confiable", () => {
  it("un rango desconocido cae al mes en curso con aviso", () => {
    const { range, notice } = resolve({ range: "all_time" });
    expect(notice).toBe("invalid_range");
    expect(range.kind).toBe("month");
  });

  it("un parámetro repetido se trata como ausente", () => {
    const { range, notice } = resolve({ range: ["year", "quarter"] });
    expect(notice).toBeNull();
    expect(range.kind).toBe("month");
  });

  it("`from` y `to` sin `range=custom` se ignoran", () => {
    const { range, notice } = resolve({ from: "2026-10-05", to: "2026-10-20" });
    expect(notice).toBeNull();
    expect(range.kind).toBe("month");
  });
});

describe("rangeSearchParams y rangeKey", () => {
  it("el default no lleva parámetros; un preset, `range`; uno personalizado, sus días", () => {
    expect(rangeSearchParams(resolve({}).range)).toEqual({});
    expect(rangeSearchParams(resolve({ range: "year" }).range)).toEqual({
      range: "year",
    });
    const custom = { range: "custom", from: "2026-10-05", to: "2026-10-20" };
    expect(rangeSearchParams(resolve(custom).range)).toEqual(custom);
  });

  it("los parámetros canónicos vuelven a dar el mismo rango", () => {
    for (const params of [
      {},
      { range: "previous_month" },
      { range: "custom", from: "2026-10-05", to: "2026-10-20" },
    ]) {
      const { range } = resolve(params);
      expect(resolve(rangeSearchParams(range)).range).toEqual(range);
    }
  });

  it("la clave es primitiva y distingue rangos", () => {
    expect(rangeKey(resolve({}).range)).toBe("month:2026-11-01:2026-11-30");
    expect(rangeKey(resolve({ range: "quarter" }).range)).toBe(
      "quarter:2026-10-01:2026-12-31",
    );
  });
});
