import { describe, expect, it } from "vitest";

import {
  chatDayKey,
  chatDayLabel,
  chatDaysAgo,
  chatListTime,
  chatTime,
} from "@/domains/conversations/chat-time";

/*
 * Hora de chat (Hito 12, DEC-044 §1): días de calendario de Asunción
 * (UTC-3), con el instante de referencia explícito.
 */

/** Jueves 29 oct 2026, 15:00 de Asunción. */
const NOW = new Date("2026-10-29T18:00:00Z");

describe("chatDayKey y chatDaysAgo", () => {
  it("el día es el de Asunción, no el de UTC", () => {
    // 28 oct, 22:30 de Asunción: ya es 29 en UTC.
    const lateYesterday = new Date("2026-10-29T01:30:00Z");
    expect(chatDayKey(lateYesterday)).toBe("2026-10-28");
    expect(chatDaysAgo(lateYesterday, NOW)).toBe(1);
    expect(chatDaysAgo(new Date("2026-10-29T03:00:00Z"), NOW)).toBe(0);
  });

  it("un día posterior a hoy es negativo", () => {
    expect(chatDaysAgo(new Date("2026-10-30T12:00:00Z"), NOW)).toBe(-1);
  });
});

describe("chatTime", () => {
  it("hora de 24 horas con dos dígitos", () => {
    expect(chatTime(new Date("2026-10-29T15:32:00Z"))).toBe("12:32");
    expect(chatTime(new Date("2026-10-29T03:05:00Z"))).toBe("00:05");
  });
});

describe("chatDayLabel", () => {
  it("Hoy, Ayer, el día de la semana en el año en curso y la fecha en otro", () => {
    expect(chatDayLabel(new Date("2026-10-29T12:00:00Z"), NOW)).toBe("Hoy");
    expect(chatDayLabel(new Date("2026-10-28T12:00:00Z"), NOW)).toBe("Ayer");
    expect(chatDayLabel(new Date("2026-10-26T12:00:00Z"), NOW)).toBe(
      "Lunes 26 de octubre",
    );
    expect(chatDayLabel(new Date("2026-03-02T12:00:00Z"), NOW)).toBe(
      "Lunes 2 de marzo",
    );
    expect(chatDayLabel(new Date("2025-12-31T12:00:00Z"), NOW)).toBe(
      "31 de diciembre de 2025",
    );
  });
});

describe("chatListTime", () => {
  it("la hora hoy, Ayer, el día de la semana en los seis anteriores y la fecha después", () => {
    expect(chatListTime(new Date("2026-10-29T15:32:00Z"), NOW)).toBe("12:32");
    expect(chatListTime(new Date("2026-10-28T15:32:00Z"), NOW)).toBe("Ayer");
    expect(chatListTime(new Date("2026-10-27T15:32:00Z"), NOW)).toBe("Martes");
    expect(chatListTime(new Date("2026-10-23T15:32:00Z"), NOW)).toBe("Viernes");
    // A los 7 días el día de la semana se repite con el de hoy.
    expect(chatListTime(new Date("2026-10-22T15:32:00Z"), NOW)).toBe("22 oct");
    expect(chatListTime(new Date("2025-10-22T15:32:00Z"), NOW)).toBe(
      "22 oct 2025",
    );
  });

  it("un instante posterior a hoy se rotula con la fecha", () => {
    expect(chatListTime(new Date("2026-10-31T15:32:00Z"), NOW)).toBe("31 oct");
  });
});
