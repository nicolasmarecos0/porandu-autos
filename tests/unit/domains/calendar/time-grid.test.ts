import { describe, expect, it } from "vitest";

import { agendaDays, type TestDriveRow } from "@/domains/calendar/agenda";
import {
  CALENDAR_TIME_ZONE,
  TEST_DRIVE_SLOT_MINUTES,
} from "@/domains/calendar/test-drives";
import {
  placeTimeGridBlocks,
  TIME_GRID_DEFAULT_END_HOUR,
  TIME_GRID_DEFAULT_START_HOUR,
  timeGridHours,
  timeGridNow,
  timeGridRange,
  weekTimeGrid,
} from "@/domains/calendar/time-grid";
import { calendarWeek } from "@/domains/calendar/week";
import { minuteOfDay } from "@/domains/calendar/zoned-time";

/*
 * Grilla horaria de la agenda (Hito 13, DEC-045 §3), lógica pura: el eje de
 * horas de la semana, los carriles de los bloques que se tocan, la
 * ubicación de cada bloque y la línea "ahora".
 */

/** 08:00 a 20:00: el eje por defecto, 720 minutos. */
const DEFAULT_RANGE = {
  startHour: TIME_GRID_DEFAULT_START_HOUR,
  endHour: TIME_GRID_DEFAULT_END_HOUR,
};
const at = (hour: number, minute = 0) => hour * 60 + minute;
// Miércoles 4 de noviembre de 2026, 10:00 en Asunción (UTC-3).
const NOW = new Date("2026-11-04T13:00:00Z");
const USER = "11111111-1111-4111-8111-111111111111";

const row = (
  id: string,
  scheduledAt: string,
  vehicleId = `v-${id}`,
): TestDriveRow => ({
  id,
  status: "scheduled",
  scheduledAt: new Date(scheduledAt),
  opportunityId: `o-${id}`,
  contactName: `Cliente ${id}`,
  vehicleId,
  vehicleBrand: "Toyota",
  vehicleModel: "Hilux",
  vehicleYear: 2022,
  createdBy: USER,
});

describe("minuto del día", () => {
  it("es la hora de pared de Asunción, sin segundos", () => {
    expect(
      minuteOfDay(new Date("2026-11-04T12:30:59Z"), CALENDAR_TIME_ZONE),
    ).toBe(at(9, 30));
    // 23:59 del domingo 8 en Asunción y la medianoche del lunes 9.
    expect(
      minuteOfDay(new Date("2026-11-09T02:59:00Z"), CALENDAR_TIME_ZONE),
    ).toBe(at(23, 59));
    expect(
      minuteOfDay(new Date("2026-11-09T03:00:00Z"), CALENDAR_TIME_ZONE),
    ).toBe(0);
  });
});

describe("eje de horas", () => {
  it("sin pruebas es de 08:00 a 20:00, con la franja de 60 minutos", () => {
    expect(TEST_DRIVE_SLOT_MINUTES).toBe(60);
    expect(timeGridRange([])).toEqual({ startHour: 8, endHour: 20 });
    expect(timeGridRange([at(8), at(18, 59), at(19)])).toEqual({
      startHour: 8,
      endHour: 20,
    });
  });

  it("se extiende hasta la hora de la más temprana y el fin de la franja de la más tardía", () => {
    expect(timeGridRange([at(6, 30), at(12)])).toEqual({
      startHour: 6,
      endHour: 20,
    });
    expect(timeGridRange([at(19, 30)])).toEqual({
      startHour: 8,
      endHour: 21,
    });
    expect(timeGridRange([at(19, 1)])).toEqual({ startHour: 8, endHour: 21 });
  });

  it("nunca pasa de la medianoche", () => {
    expect(timeGridRange([at(0), at(23, 30)])).toEqual({
      startHour: 0,
      endHour: 24,
    });
    expect(timeGridRange([at(23, 59)])).toEqual({ startHour: 8, endHour: 24 });
  });

  it("rechaza minutos y franjas inválidos", () => {
    for (const minute of [-1, 1440, 10.5, Number.NaN]) {
      expect(() => timeGridRange([minute])).toThrow(RangeError);
    }
    expect(() => timeGridRange([], 0)).toThrow(RangeError);
  });

  it("marca cada hora entera con su distancia desde arriba", () => {
    const hours = timeGridHours({ startHour: 8, endHour: 12 });
    expect(hours).toEqual([
      { hour: 8, label: "08:00", offset: 0 },
      { hour: 9, label: "09:00", offset: 0.25 },
      { hour: 10, label: "10:00", offset: 0.5 },
      { hour: 11, label: "11:00", offset: 0.75 },
    ]);
    expect(timeGridHours(DEFAULT_RANGE)).toHaveLength(12);
  });
});

describe("ubicación de los bloques", () => {
  it("un bloque solo ocupa toda la columna y la franja de una hora", () => {
    expect(placeTimeGridBlocks([at(9, 30)], DEFAULT_RANGE)).toEqual([
      { top: 90 / 720, height: 60 / 720, lane: 0, lanes: 1 },
    ]);
  });

  it("los que no se tocan no comparten el ancho, aunque sean seguidos", () => {
    const placements = placeTimeGridBlocks(
      [at(9), at(10), at(15)],
      DEFAULT_RANGE,
    );
    expect(placements.map(({ lane, lanes }) => [lane, lanes])).toEqual([
      [0, 1],
      [0, 1],
      [0, 1],
    ]);
  });

  it("los que se pisan se reparten carriles y el primero libre se reusa", () => {
    // 10:00, 10:30 y 11:00: el de las 11:00 vuelve al carril del de las
    // 10:00, que ya terminó, y los tres son un grupo de dos carriles.
    const placements = placeTimeGridBlocks(
      [at(10), at(10, 30), at(11), at(14)],
      DEFAULT_RANGE,
    );
    expect(placements.map(({ lane, lanes }) => [lane, lanes])).toEqual([
      [0, 2],
      [1, 2],
      [0, 2],
      [0, 1],
    ]);
  });

  it("a la misma hora respeta el orden recibido y devuelve en ese orden", () => {
    const placements = placeTimeGridBlocks(
      [at(16), at(9), at(9), at(9)],
      DEFAULT_RANGE,
    );
    expect(placements.map(({ lane, lanes }) => [lane, lanes])).toEqual([
      [0, 1],
      [0, 3],
      [1, 3],
      [2, 3],
    ]);
    expect(placements[0]?.top).toBe(480 / 720);
  });

  it("corta la franja en el final del eje", () => {
    const range = timeGridRange([at(23, 30)]);
    const [placement] = placeTimeGridBlocks([at(23, 30)], range);
    expect(range).toEqual({ startHour: 8, endHour: 24 });
    expect(placement).toEqual({
      top: (at(23, 30) - at(8)) / (16 * 60),
      height: 30 / (16 * 60),
      lane: 0,
      lanes: 1,
    });
  });

  it("rechaza un bloque fuera del eje", () => {
    expect(() => placeTimeGridBlocks([at(7)], DEFAULT_RANGE)).toThrow(
      RangeError,
    );
    expect(() => placeTimeGridBlocks([at(20)], DEFAULT_RANGE)).toThrow(
      RangeError,
    );
  });
});

describe("grilla de la semana", () => {
  it("usa un eje común y ubica las pruebas de cada día en su columna", () => {
    const week = calendarWeek(undefined, NOW, CALENDAR_TIME_ZONE);
    const days = agendaDays(
      week,
      [
        // Martes 3: 07:30 extiende el eje para toda la semana.
        row("a", "2026-11-03T10:30:00Z"),
        // Miércoles 4: 10:00 y 10:30 se pisan (unidades distintas).
        row("b", "2026-11-04T13:00:00Z"),
        row("c", "2026-11-04T13:30:00Z"),
      ],
      USER,
      NOW,
    );
    const grid = weekTimeGrid(days);
    expect(grid.range).toEqual({ startHour: 7, endHour: 20 });
    expect(grid.hours[0]?.label).toBe("07:00");
    expect(grid.days.map((day) => day.blocks.length)).toEqual([
      0, 1, 2, 0, 0, 0, 0,
    ]);
    const [, tuesday, wednesday] = grid.days;
    expect(tuesday?.blocks[0]?.placement).toEqual({
      top: 30 / 780,
      height: 60 / 780,
      lane: 0,
      lanes: 1,
    });
    expect(
      wednesday?.blocks.map(({ item, placement }) => [
        item.id,
        placement.lane,
        placement.lanes,
      ]),
    ).toEqual([
      ["b", 0, 2],
      ["c", 1, 2],
    ]);
  });
});

describe("línea ahora", () => {
  const week = calendarWeek(undefined, NOW, CALENDAR_TIME_ZONE);
  const dates = week.days.map((day) => day.date);

  it("va en la columna de hoy, a la altura de la hora de Asunción", () => {
    expect(timeGridNow(NOW, dates, DEFAULT_RANGE, CALENDAR_TIME_ZONE)).toEqual({
      dayIndex: 2,
      offset: 120 / 720,
    });
  });

  it("no se muestra fuera del eje, en otra semana ni con un instante inválido", () => {
    // 07:59 y 20:00 del miércoles en Asunción.
    for (const instant of ["2026-11-04T10:59:00Z", "2026-11-04T23:00:00Z"]) {
      expect(
        timeGridNow(
          new Date(instant),
          dates,
          DEFAULT_RANGE,
          CALENDAR_TIME_ZONE,
        ),
      ).toBeNull();
    }
    expect(
      timeGridNow(
        new Date("2026-11-12T13:00:00Z"),
        dates,
        DEFAULT_RANGE,
        CALENDAR_TIME_ZONE,
      ),
    ).toBeNull();
    expect(
      timeGridNow(
        new Date(Number.NaN),
        dates,
        DEFAULT_RANGE,
        CALENDAR_TIME_ZONE,
      ),
    ).toBeNull();
  });
});
