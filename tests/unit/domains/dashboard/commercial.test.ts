import { describe, expect, it } from "vitest";

import {
  buildConversion,
  buildPendingQuotes,
  buildWeekTestDrives,
} from "@/domains/dashboard/commercial";

/*
 * KPIs comerciales del Dashboard Directivo (propuesta DEC-043 §3–§5): la
 * base cuenta y el dominio arma la vista, sin inventar ceros (DEC-005).
 */

describe("buildConversion: ventas cerradas y tasa de conversión", () => {
  it("ganadas sobre cerradas, con un decimal", () => {
    expect(buildConversion(2, 1)).toEqual({
      won: 2,
      lost: 1,
      closed: 3,
      rate: 66.7,
    });
  });

  it("sin cierres en el rango no hay tasa: Sin dato, nunca 0 %", () => {
    expect(buildConversion(0, 0).rate).toBeNull();
  });

  it("solo perdidas es 0 %: hubo cierres y ninguno se ganó", () => {
    expect(buildConversion(0, 4).rate).toBe(0);
  });

  it.each([-1, 1.5, Number.NaN])("conteo inválido (%s)", (value) => {
    expect(() => buildConversion(value, 0)).toThrow(RangeError);
    expect(() => buildConversion(0, value)).toThrow(RangeError);
  });
});

describe("buildPendingQuotes", () => {
  it("pendientes = vigentes por aprobar + por enviar + esperando respuesta", () => {
    expect(
      buildPendingQuotes({
        awaitingApproval: 2,
        readyToSend: 1,
        awaitingResponse: 4,
        expired: 3,
      }),
    ).toEqual({
      total: 7,
      awaitingApproval: 2,
      readyToSend: 1,
      awaitingResponse: 4,
      expired: 3,
    });
  });

  it("las vencidas no suman al total", () => {
    expect(
      buildPendingQuotes({
        awaitingApproval: 0,
        readyToSend: 0,
        awaitingResponse: 0,
        expired: 5,
      }).total,
    ).toBe(0);
  });

  it("rechaza un conteo inválido", () => {
    expect(() =>
      buildPendingQuotes({
        awaitingApproval: -1,
        readyToSend: 0,
        awaitingResponse: 0,
        expired: 0,
      }),
    ).toThrow(RangeError);
  });
});

describe("buildWeekTestDrives", () => {
  const week = { key: "2026-10-26", label: "26 oct – 1 nov 2026" };

  it("agendadas = por realizar + realizadas + no asistió; las canceladas aparte", () => {
    expect(
      buildWeekTestDrives(
        { pending: 3, completed: 4, noShow: 1, cancelled: 2 },
        week,
      ),
    ).toEqual({
      weekKey: "2026-10-26",
      weekLabel: "26 oct – 1 nov 2026",
      scheduled: 8,
      pending: 3,
      completed: 4,
      noShow: 1,
      cancelled: 2,
    });
  });

  it("rechaza un conteo inválido", () => {
    expect(() =>
      buildWeekTestDrives(
        { pending: 0, completed: Number.NaN, noShow: 0, cancelled: 0 },
        week,
      ),
    ).toThrow(RangeError);
  });
});
