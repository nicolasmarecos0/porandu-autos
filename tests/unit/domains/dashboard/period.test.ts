import { describe, expect, it } from "vitest";

import {
  DASHBOARD_TIME_ZONE,
  monthLabel,
  monthWindow,
} from "@/domains/dashboard/period";

/*
 * Período del Dashboard Directivo (Hito 5, DEC-037 §4): el mes calendario de
 * Asunción que contiene `now`, como intervalo de instantes [inicio, fin).
 * Asunción es UTC-3 todo el año desde octubre de 2024; antes tenía horario
 * de verano, que empezaba a la medianoche.
 */

const window = (now: string, timeZone = DASHBOARD_TIME_ZONE) => {
  const { start, end } = monthWindow(new Date(now), timeZone);
  return { start: start.toISOString(), end: end.toISOString() };
};

describe("monthWindow: el mes de Asunción", () => {
  it("octubre de 2026 va del 1 de octubre a las 00:00 al 1 de noviembre a las 00:00 (UTC-3)", () => {
    expect(window("2026-10-14T13:30:00Z")).toEqual({
      start: "2026-10-01T03:00:00.000Z",
      end: "2026-11-01T03:00:00.000Z",
    });
  });

  it("el mes es el de Asunción, no el de UTC", () => {
    // 23:59:59.999 del 30 de septiembre en Asunción: ya es octubre en UTC.
    expect(window("2026-10-01T02:59:59.999Z")).toEqual({
      start: "2026-09-01T03:00:00.000Z",
      end: "2026-10-01T03:00:00.000Z",
    });
    // 00:00 del 1 de octubre en Asunción.
    expect(window("2026-10-01T03:00:00.000Z").start).toBe(
      "2026-10-01T03:00:00.000Z",
    );
  });

  it("diciembre cierra en el 1 de enero del año siguiente", () => {
    expect(window("2026-12-31T23:00:00Z")).toEqual({
      start: "2026-12-01T03:00:00.000Z",
      end: "2027-01-01T03:00:00.000Z",
    });
    // 21:00 del 31 de diciembre en Asunción: el 1 de enero en UTC.
    expect(window("2027-01-01T00:00:00Z").start).toBe(
      "2026-12-01T03:00:00.000Z",
    );
  });

  it("si la medianoche del día 1 no existió (inicio del horario de verano), el mes empieza en el cambio", () => {
    // 1 oct 2023: a las 00:00 (UTC-4) los relojes pasaron a las 01:00 (UTC-3).
    expect(window("2023-10-15T12:00:00Z")).toEqual({
      start: "2023-10-01T04:00:00.000Z",
      end: "2023-11-01T03:00:00.000Z",
    });
    expect(window("2023-09-15T12:00:00Z")).toEqual({
      start: "2023-09-01T04:00:00.000Z",
      end: "2023-10-01T04:00:00.000Z",
    });
  });

  it("un cambio de horario dentro del mes no corre sus bordes", () => {
    // 24 mar 2024: fin del horario de verano (UTC-3 → UTC-4).
    expect(window("2024-03-10T12:00:00Z")).toEqual({
      start: "2024-03-01T03:00:00.000Z",
      end: "2024-04-01T04:00:00.000Z",
    });
  });

  it("respeta la zona que recibe", () => {
    expect(window("2026-10-14T13:30:00Z", "UTC")).toEqual({
      start: "2026-10-01T00:00:00.000Z",
      end: "2026-11-01T00:00:00.000Z",
    });
  });

  it("un `now` inválido falla en vez de inventar un mes", () => {
    expect(() => monthWindow(new Date("nope"), DASHBOARD_TIME_ZONE)).toThrow(
      RangeError,
    );
  });
});

describe("monthLabel", () => {
  it("nombra el mes de Asunción en es-PY", () => {
    expect(
      monthLabel(new Date("2026-10-14T13:30:00Z"), DASHBOARD_TIME_ZONE),
    ).toBe("octubre de 2026");
    expect(
      monthLabel(new Date("2026-10-01T02:59:59.999Z"), DASHBOARD_TIME_ZONE),
    ).toBe("septiembre de 2026");
  });
});
