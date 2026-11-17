import { describe, expect, it } from "vitest";

import {
  quoteSignal,
  testDriveSignal,
  type QuoteRecord,
} from "@/domains/scoring/signals";

/*
 * Señales comerciales (DEC-058): qué prueba de manejo y qué cotización
 * cuentan para Intent y "¿Por qué ahora?", sin persistir nada.
 */

const NOW = new Date("2026-11-17T13:30:00Z");
const HOUR = 3_600_000;
const at = (hours: number) => new Date(NOW.getTime() + hours * HOUR);

describe("testDriveSignal", () => {
  it("sin pruebas, o solo canceladas: ninguna", () => {
    expect(testDriveSignal([], NOW)).toBeNull();
    expect(
      testDriveSignal([{ status: "cancelled", scheduledAt: at(5) }], NOW),
    ).toBeNull();
  });

  it("la próxima por delante (la más cercana) gana a todo", () => {
    expect(
      testDriveSignal(
        [
          { status: "completed", scheduledAt: at(-48) },
          { status: "scheduled", scheduledAt: at(72) },
          { status: "confirmed", scheduledAt: at(24) },
        ],
        NOW,
      ),
    ).toEqual({ state: "upcoming", at: at(24), confirmed: true });
  });

  it("sin próxima: la última realizada, después la vencida y la ausencia", () => {
    expect(
      testDriveSignal(
        [
          { status: "no_show", scheduledAt: at(-10) },
          { status: "completed", scheduledAt: at(-100) },
          { status: "completed", scheduledAt: at(-50) },
        ],
        NOW,
      ),
    ).toEqual({ state: "completed", at: at(-50), confirmed: false });
    expect(
      testDriveSignal(
        [
          { status: "no_show", scheduledAt: at(-10) },
          { status: "scheduled", scheduledAt: at(-2) },
        ],
        NOW,
      ),
    ).toEqual({ state: "overdue", at: at(-2), confirmed: false });
    expect(
      testDriveSignal([{ status: "no_show", scheduledAt: at(-10) }], NOW),
    ).toEqual({ state: "no_show", at: at(-10), confirmed: false });
  });

  it("agendada justo ahora todavía está por delante", () => {
    expect(
      testDriveSignal([{ status: "scheduled", scheduledAt: NOW }], NOW)?.state,
    ).toBe("upcoming");
  });
});

function quote(
  number: number,
  status: QuoteRecord["status"],
  validUntil = "2026-11-30",
): QuoteRecord {
  return {
    number,
    status,
    total: { amount: "48500.00", currency: "USD" },
    validUntil,
  };
}

describe("quoteSignal", () => {
  const TODAY = "2026-11-17";

  it("sin cotizaciones, o solo anuladas: ninguna", () => {
    expect(quoteSignal([], TODAY)).toBeNull();
    expect(quoteSignal([quote(1, "withdrawn")], TODAY)).toBeNull();
  });

  it("prioridad: aceptada, enviada, sin enviar, vencida, rechazada", () => {
    const all = [
      quote(1, "rejected"),
      quote(2, "sent", "2026-11-10"),
      quote(3, "draft"),
      quote(4, "sent"),
      quote(5, "accepted"),
    ];
    expect(quoteSignal(all, TODAY)?.state).toBe("accepted");
    expect(quoteSignal(all.slice(0, 4), TODAY)).toMatchObject({
      state: "sent",
      number: 4,
    });
    expect(quoteSignal(all.slice(0, 3), TODAY)).toMatchObject({
      state: "pending",
      number: 3,
    });
    expect(quoteSignal(all.slice(0, 2), TODAY)).toMatchObject({
      state: "expired",
      number: 2,
    });
    expect(quoteSignal(all.slice(0, 1), TODAY)?.state).toBe("rejected");
  });

  it("vigente hasta hoy inclusive; una aprobada sin enviar está pendiente", () => {
    expect(quoteSignal([quote(1, "sent", TODAY)], TODAY)?.state).toBe("sent");
    expect(quoteSignal([quote(1, "approved")], TODAY)?.state).toBe("pending");
    expect(
      quoteSignal([quote(1, "approved", "2026-11-16")], TODAY)?.state,
    ).toBe("expired");
  });

  it("dentro de un estado, la más nueva", () => {
    expect(
      quoteSignal([quote(7, "sent"), quote(9, "sent"), quote(8, "sent")], TODAY)
        ?.number,
    ).toBe(9);
  });
});
