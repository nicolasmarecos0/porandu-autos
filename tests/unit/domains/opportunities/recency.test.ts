import { describe, expect, it } from "vitest";

import {
  formatElapsedLong,
  formatElapsedShort,
  minuteOfDay,
  minutesSince,
  recencyEmoji,
} from "@/domains/opportunities/recency";

/*
 * Build Baseline B1 §3.2: 🔥 <5 min · 🟢 5–30 min · 🟡 30 min–2 h · ❄️ >2 h.
 * Los límites exactos de 30 min y 2 h no están definidos en la baseline:
 * se prueban valores dentro de cada rango.
 */
describe("recencyEmoji", () => {
  it.each([
    [0, "🔥"],
    [4, "🔥"],
    [5, "🟢"],
    [15, "🟢"],
    [60, "🟡"],
    [180, "❄️"],
  ])("%i min → %s", (minutes, emoji) => {
    expect(recencyEmoji(minutes)).toBe(emoji);
  });
});

describe("minutesSince", () => {
  const now = new Date("2026-10-01T13:30:00Z");

  it("minutos enteros desde la última actividad", () => {
    expect(minutesSince(new Date("2026-10-01T13:28:00Z"), now)).toBe(2);
    expect(minutesSince(new Date("2026-10-01T13:28:59Z"), now)).toBe(1);
    expect(minutesSince(new Date("2026-09-30T13:30:00Z"), now)).toBe(1440);
  });

  it("una fecha futura (reloj desfasado) cuenta como 0, nunca negativo", () => {
    expect(minutesSince(new Date("2026-10-01T13:31:00Z"), now)).toBe(0);
  });
});

describe("minuteOfDay", () => {
  it("hora local de la zona pedida", () => {
    // Asunción es UTC-3 en esa fecha.
    expect(
      minuteOfDay(new Date("2026-10-01T13:30:00Z"), "America/Asuncion"),
    ).toBe(10 * 60 + 30);
    expect(minuteOfDay(new Date("2026-10-01T03:05:00Z"), "UTC")).toBe(185);
  });

  it("medianoche es 0, no 24:00", () => {
    expect(minuteOfDay(new Date("2026-10-01T00:00:00Z"), "UTC")).toBe(0);
  });
});

describe("formatElapsed (referencia 10:30)", () => {
  const ref = 10 * 60 + 30;

  it.each([
    [2, "2 min", "hace 2 min"],
    [105, "1 h 45", "hace 1 h 45 min"],
    [120, "2 h", "hace 2 h"],
    // Ayer: entre la medianoche de ayer y la de hoy.
    [915, "ayer", "ayer 19:15"],
    [ref + 1440, "ayer", "ayer 00:00"],
    // Antes de ayer: días de calendario, no "ayer".
    [ref + 1441, "2 d", "hace 2 días"],
    [ref + 3 * 1440, "3 d", "hace 3 días"],
  ])("%i min → %s / %s", (minutes, short, long) => {
    expect(formatElapsedShort(minutes, ref)).toBe(short);
    expect(formatElapsedLong(minutes, ref)).toBe(long);
  });
});
