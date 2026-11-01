import { describe, expect, it } from "vitest";

import { testDriveStatuses } from "@/db/schema/test-drives";
import { testDriveScheduleToleranceMinutes } from "@/db/schema/test-drives";
import {
  agendaCounts,
  agendaDays,
  overlappingTestDrives,
  testDrivesLabel,
  type TestDriveRow,
} from "@/domains/calendar/agenda";
import {
  availableTransitions,
  CALENDAR_TIME_ZONE,
  INITIAL_TEST_DRIVE_STATUS,
  isTestDriveStatus,
  parseLocalDateTime,
  parseScheduledAt,
  planTestDriveTransition,
  readUuid,
  SCHEDULE_HORIZON_DAYS,
  SCHEDULE_PAST_TOLERANCE_MINUTES,
  TEST_DRIVE_STATUSES,
  TEST_DRIVE_TRANSITIONS,
  toLocalDateTime,
  type TestDriveStatus,
} from "@/domains/calendar/test-drives";
import { calendarWeek } from "@/domains/calendar/week";

/*
 * Agenda de pruebas de manejo (Hito 9, DEC-041), lógica pura: la matriz de
 * estados (que espeja el trigger de 0015), la hora de pared de Asunción, la
 * semana y la presentación.
 */

const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;
// Lunes 2 de noviembre de 2026, 10:00 en Asunción (UTC-3).
const NOW = new Date("2026-11-02T13:00:00Z");

describe("estados y transiciones", () => {
  it("el dominio y el schema tienen los mismos estados y la misma tolerancia", () => {
    expect([...TEST_DRIVE_STATUSES].sort()).toEqual(
      [...testDriveStatuses].sort(),
    );
    expect(SCHEDULE_PAST_TOLERANCE_MINUTES).toBe(
      testDriveScheduleToleranceMinutes,
    );
    expect(INITIAL_TEST_DRIVE_STATUS).toBe("scheduled");
  });

  it("la matriz: agendada y confirmada se mueven, las terminales no", () => {
    expect(TEST_DRIVE_TRANSITIONS).toEqual({
      scheduled: ["confirmed", "completed", "no_show", "cancelled"],
      confirmed: ["completed", "no_show", "cancelled"],
      completed: [],
      no_show: [],
      cancelled: [],
    });
  });

  it("los 25 pares: solo pasan los de la matriz y nunca el mismo estado", () => {
    const past = new Date(NOW.getTime() - DAY);
    for (const from of TEST_DRIVE_STATUSES) {
      for (const to of TEST_DRIVE_STATUSES) {
        const plan = planTestDriveTransition(from, to, past, NOW);
        expect(plan.ok).toBe(TEST_DRIVE_TRANSITIONS[from].includes(to));
        if (from === to)
          expect(plan).toEqual({ ok: false, error: "invalid_transition" });
      }
    }
  });

  it("realizada y no asistió solo desde la hora agendada; confirmar y cancelar, siempre", () => {
    const future = new Date(NOW.getTime() + 30 * MINUTE);
    expect(
      planTestDriveTransition("scheduled", "completed", future, NOW),
    ).toEqual({ ok: false, error: "not_started" });
    expect(
      planTestDriveTransition("confirmed", "no_show", future, NOW),
    ).toEqual({ ok: false, error: "not_started" });
    expect(planTestDriveTransition("scheduled", "completed", NOW, NOW)).toEqual(
      { ok: true },
    );
    expect(availableTransitions("scheduled", future, NOW)).toEqual([
      "confirmed",
      "cancelled",
    ]);
    expect(availableTransitions("confirmed", NOW, NOW)).toEqual([
      "completed",
      "no_show",
      "cancelled",
    ]);
    expect(availableTransitions("cancelled", NOW, NOW)).toEqual([]);
  });

  it("isTestDriveStatus solo acepta los estados conocidos", () => {
    expect(isTestDriveStatus("confirmed")).toBe(true);
    expect(isTestDriveStatus("deleted")).toBe(false);
    expect(isTestDriveStatus(undefined)).toBe(false);
  });

  it("readUuid normaliza y rechaza lo que no es un UUID", () => {
    expect(readUuid(" 6F1C2B0A-1D2E-4F3A-8B9C-0D1E2F3A4B5C ")).toBe(
      "6f1c2b0a-1d2e-4f3a-8b9c-0d1e2f3a4b5c",
    );
    expect(readUuid("x")).toBeNull();
    expect(readUuid(null)).toBeNull();
  });
});

describe("hora de pared de Asunción", () => {
  it("lee un datetime-local como hora de Asunción", () => {
    expect(
      parseLocalDateTime("2026-11-02T10:30", CALENDAR_TIME_ZONE)?.toISOString(),
    ).toBe("2026-11-02T13:30:00.000Z");
    expect(
      toLocalDateTime(new Date("2026-11-02T13:30:00Z"), CALENDAR_TIME_ZONE),
    ).toBe("2026-11-02T10:30");
  });

  it("rechaza fechas inexistentes, formatos ajenos y horas que no existieron", () => {
    for (const raw of [
      "",
      "2026-02-30T10:00",
      "2026-11-02 10:00",
      "2026-11-02T24:00",
      "2026-11-02T10:00:00",
      "1999-12-31T10:00",
    ]) {
      expect(parseLocalDateTime(raw, CALENDAR_TIME_ZONE)).toBeNull();
    }
    // 1 oct 2023: Asunción saltó de 00:00 a 01:00.
    expect(
      parseLocalDateTime("2023-10-01T00:30", CALENDAR_TIME_ZONE),
    ).toBeNull();
  });

  it("una hora repetida (retroceso de horario) es la primera vez que ocurrió", () => {
    // 26 mar 2023: Asunción volvió de 00:00 a 23:00 del 25.
    expect(
      parseLocalDateTime("2023-03-25T23:30", CALENDAR_TIME_ZONE)?.toISOString(),
    ).toBe("2023-03-26T02:30:00.000Z");
  });

  it("parseScheduledAt: obligatoria, válida, no en el pasado (con tolerancia) y dentro del horizonte", () => {
    expect(parseScheduledAt("", NOW)).toEqual({ ok: false, error: "required" });
    expect(parseScheduledAt("mañana", NOW)).toEqual({
      ok: false,
      error: "invalid",
    });
    expect(parseScheduledAt("2026-11-02T09:50", NOW)).toEqual({
      ok: false,
      error: "in_the_past",
    });
    expect(parseScheduledAt("2026-11-02T09:56", NOW)).toEqual({
      ok: true,
      scheduledAt: new Date("2026-11-02T12:56:00Z"),
    });
    const horizon = new Date(NOW.getTime() + SCHEDULE_HORIZON_DAYS * DAY);
    expect(
      parseScheduledAt(toLocalDateTime(horizon, CALENDAR_TIME_ZONE), NOW).ok,
    ).toBe(true);
    expect(
      parseScheduledAt(
        toLocalDateTime(
          new Date(horizon.getTime() + 60 * MINUTE),
          CALENDAR_TIME_ZONE,
        ),
        NOW,
      ),
    ).toEqual({ ok: false, error: "too_far" });
  });
});

describe("semana", () => {
  it("sin parámetro es la semana de hoy, de lunes a domingo en Asunción", () => {
    const week = calendarWeek(undefined, NOW, CALENDAR_TIME_ZONE);
    expect(week.key).toBe("2026-11-02");
    expect(week.start.toISOString()).toBe("2026-11-02T03:00:00.000Z");
    expect(week.end.toISOString()).toBe("2026-11-09T03:00:00.000Z");
    expect(week.days.map((day) => day.date)).toEqual([
      "2026-11-02",
      "2026-11-03",
      "2026-11-04",
      "2026-11-05",
      "2026-11-06",
      "2026-11-07",
      "2026-11-08",
    ]);
    expect(week.days.map((day) => day.isToday)).toEqual([
      true,
      false,
      false,
      false,
      false,
      false,
      false,
    ]);
    expect(week.isCurrent).toBe(true);
    expect(week.previousKey).toBe("2026-10-26");
    expect(week.nextKey).toBe("2026-11-09");
    expect(week.label).toBe("2 – 8 nov 2026");
  });

  it("cualquier día identifica su semana; un valor inválido es la de hoy", () => {
    expect(calendarWeek("2026-11-08", NOW, CALENDAR_TIME_ZONE).key).toBe(
      "2026-11-02",
    );
    expect(calendarWeek("2026-12-31", NOW, CALENDAR_TIME_ZONE).key).toBe(
      "2026-12-28",
    );
    expect(calendarWeek("2026-12-31", NOW, CALENDAR_TIME_ZONE).label).toBe(
      "28 dic 2026 – 3 ene 2027",
    );
    for (const raw of ["", "2026-13-01", "hoy", "2026-11-31"]) {
      expect(calendarWeek(raw, NOW, CALENDAR_TIME_ZONE).key).toBe("2026-11-02");
    }
    const other = calendarWeek("2026-11-12", NOW, CALENDAR_TIME_ZONE);
    expect(other.isCurrent).toBe(false);
    expect(other.days.every((day) => !day.isToday)).toBe(true);
  });

  it("a la medianoche de Asunción ya es el día siguiente", () => {
    // Domingo 8 nov, 23:59 y lunes 9 nov, 00:00 en Asunción.
    expect(
      calendarWeek(
        undefined,
        new Date("2026-11-09T02:59:00Z"),
        CALENDAR_TIME_ZONE,
      ).key,
    ).toBe("2026-11-02");
    expect(
      calendarWeek(
        undefined,
        new Date("2026-11-09T03:00:00Z"),
        CALENDAR_TIME_ZONE,
      ).key,
    ).toBe("2026-11-09");
  });
});

describe("presentación de la agenda", () => {
  const USER = "11111111-1111-4111-8111-111111111111";
  const row = (
    id: string,
    scheduledAt: string,
    status: TestDriveStatus = "scheduled",
    vehicleId = "v1",
    createdBy = USER,
  ): TestDriveRow => ({
    id,
    status,
    scheduledAt: new Date(scheduledAt),
    opportunityId: `o-${id}`,
    contactName: `Cliente ${id}`,
    vehicleId,
    vehicleBrand: "Toyota",
    vehicleModel: "Hilux",
    vehicleYear: 2021,
    createdBy,
  });

  it("agrupa por día de Asunción, ordena por hora y arma las etiquetas", () => {
    const week = calendarWeek(undefined, NOW, CALENDAR_TIME_ZONE);
    const days = agendaDays(
      week,
      [
        row("b", "2026-11-03T14:00:00Z", "confirmed", "v2", "otro"),
        row("a", "2026-11-03T12:30:00Z"),
        // Domingo 8, 23:30 en Asunción: todavía es de esta semana.
        row("c", "2026-11-09T02:30:00Z", "cancelled", "v3"),
      ],
      USER,
      NOW,
    );
    expect(days.map((day) => day.items.map((item) => item.id))).toEqual([
      [],
      ["a", "b"],
      [],
      [],
      [],
      [],
      ["c"],
    ]);
    const [a, b] = days[1]!.items;
    expect(a).toMatchObject({
      timeLabel: "09:30",
      vehicleLabel: "Toyota Hilux 2021",
      scheduledByLabel: "Vos",
      overlaps: false,
      transitions: ["confirmed", "cancelled"],
    });
    expect(b?.scheduledByLabel).toBe("Otro miembro");
    expect(days[6]!.items[0]?.transitions).toEqual([]);
  });

  it("avisa la superposición de una misma unidad solo entre pruebas abiertas", () => {
    const overlapping = overlappingTestDrives([
      row("a", "2026-11-03T13:00:00Z"),
      row("b", "2026-11-03T13:45:00Z", "confirmed"),
      row("c", "2026-11-03T15:00:00Z"),
      row("d", "2026-11-03T13:10:00Z", "cancelled"),
      row("e", "2026-11-03T13:20:00Z", "scheduled", "v2"),
    ]);
    expect([...overlapping].sort()).toEqual(["a", "b"]);
  });

  it("cuenta por estado, con todos los estados en 0", () => {
    expect(
      agendaCounts([
        row("a", "2026-11-03T13:00:00Z"),
        row("b", "2026-11-03T14:00:00Z", "completed"),
        row("c", "2026-11-03T15:00:00Z", "completed"),
      ]),
    ).toEqual({
      scheduled: 1,
      confirmed: 0,
      completed: 2,
      no_show: 0,
      cancelled: 0,
    });
    expect(testDrivesLabel(1)).toBe("1 prueba");
    expect(testDrivesLabel(0)).toBe("0 pruebas");
  });
});
