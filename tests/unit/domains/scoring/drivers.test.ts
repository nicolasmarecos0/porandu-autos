import { describe, expect, it } from "vitest";

import type { DemandFact, DemandValues } from "@/domains/demand/facts";
import type {
  DemandSnapshot,
  DemandSnapshotFact,
} from "@/domains/demand/snapshot";
import type { MatchCard, MatchRail } from "@/domains/match/presentation";
import {
  deriveOpportunityDrivers,
  DRIVER_STRENGTH,
  formatDriverDateTime,
  formatDriverDay,
  MAX_DRIVERS_PER_GROUP,
  STRONG_DRIVER_MIN_STRENGTH,
  type DriverInput,
} from "@/domains/scoring/drivers";
import { evaluateRecency } from "@/domains/scoring/engine";
import {
  NO_INTENT_SIGNALS,
  type IntentSignals,
} from "@/domains/scoring/signals";
import type { Driver } from "@/domains/scoring/types";

/*
 * "¿Por qué ahora?" (DEC-058): derivador puro y determinista. Cada caso fija
 * `now` y combina lo que busca, el rail de Match v0, la agenda, la
 * cotización, la toma del usado, los mensajes y la recencia. Ninguna señal
 * sale de un dato que falta.
 */

const NOW = new Date("2026-11-17T13:30:00Z"); // 10:30 en Asunción
const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const ago = (ms: number) => new Date(NOW.getTime() - ms);

type DemandInput = { [F in DemandFact]?: DemandValues[F] };

function snapshot(values: DemandInput = {}): DemandSnapshot {
  function fact<F extends DemandFact>(name: F): DemandSnapshotFact<F> {
    const value = values[name] as DemandValues[F] | undefined;
    return value === undefined
      ? { value: null, status: "unknown", factId: null }
      : { value, status: "confirmed", factId: `${name}-1` };
  }
  return {
    desired_vehicle: fact("desired_vehicle"),
    year_range: fact("year_range"),
    budget_max: fact("budget_max"),
    purchase_type: fact("purchase_type"),
    trade_in_intent: fact("trade_in_intent"),
    down_payment: fact("down_payment"),
  };
}

const USD = (amount: string) => ({ amount, currency: "USD" }) as const;

function matchCard(total: number, overrides: Partial<MatchCard> = {}) {
  return {
    vehicleId: "v-1",
    name: "Toyota Hilux",
    detail: "SRV · 2025",
    price: "USD 49.900",
    km: "0 km",
    score: { total, vehicle: 45, year: 25, budget: total - 70 },
    reasons: [],
    condition: "new",
    body: "pickup",
    budgetDelta: { kind: "under", amount: "USD 8.100" },
    balance: null,
    ...overrides,
  } as MatchCard;
}

const NO_DEMAND: MatchRail = { kind: "empty", reason: "no_demand" };

function input(overrides: Partial<DriverInput> = {}): DriverInput {
  return {
    stage: "negotiating",
    demand: snapshot(),
    rail: NO_DEMAND,
    hasLinkedVehicle: false,
    recency: evaluateRecency(ago(10 * 60_000), NOW),
    signals: NO_INTENT_SIGNALS,
    tradeIn: null,
    ...overrides,
  };
}

function drivers(overrides: Partial<DriverInput> = {}): Driver[] {
  return deriveOpportunityDrivers(input(overrides), NOW);
}

function signals(overrides: Partial<IntentSignals>): IntentSignals {
  return { ...NO_INTENT_SIGNALS, ...overrides };
}

function only(list: Driver[]): Driver {
  expect(list).toHaveLength(1);
  return list[0]!;
}

describe("reglas", () => {
  it("el corte entre fuertes y a validar es 75, y los topes 6 y 3", () => {
    expect(STRONG_DRIVER_MIN_STRENGTH).toBe(75);
    expect(MAX_DRIVERS_PER_GROUP).toEqual({ strong: 6, validate: 3 });
    for (const strength of Object.values(DRIVER_STRENGTH)) {
      expect(strength).toBeGreaterThanOrEqual(0);
      expect(strength).toBeLessThanOrEqual(100);
    }
  });

  it("sin datos ni señales, y activa: ninguna señal (nada se inventa)", () => {
    expect(drivers()).toEqual([]);
  });

  it.each(["won", "lost"] as const)(
    "%s: una oportunidad cerrada no tiene señales",
    (stage) => {
      expect(
        drivers({
          stage,
          demand: snapshot({ purchase_type: "cash" }),
          signals: signals({ lastInboundAt: ago(HOUR) }),
        }),
      ).toEqual([]);
    },
  );
});

describe("lo que busca", () => {
  it("entrega inicial alta: el porcentaje real del presupuesto, en negrita", () => {
    const driver = only(
      drivers({
        demand: snapshot({
          budget_max: USD("58000.00"),
          down_payment: USD("20000.00"),
        }),
      }),
    );
    expect(driver).toEqual({
      kind: "downPayment",
      label: "Entrega inicial",
      detail: "Entrega USD 20.000: el 34 % del presupuesto de USD 58.000.",
      source: "Lo que busca",
      strength: DRIVER_STRENGTH.downPaymentHigh,
      emphasis: ["USD 20.000", "34 %", "USD 58.000"],
    });
  });

  it.each([
    ["10000.00", DRIVER_STRENGTH.downPaymentSolid, "Entrega inicial"],
    ["5000.00", DRIVER_STRENGTH.downPaymentLow, "Entrega inicial baja"],
  ])("entrega de USD %s sobre USD 58.000 → %i", (amount, strength, label) => {
    const driver = only(
      drivers({
        demand: snapshot({
          budget_max: USD("58000.00"),
          down_payment: USD(amount),
        }),
      }),
    );
    expect(driver.strength).toBe(strength);
    expect(driver.label).toBe(label);
  });

  it("entrega sin presupuesto comparable (otra moneda): solo el monto", () => {
    const driver = only(
      drivers({
        demand: snapshot({
          budget_max: { amount: "300000000.00", currency: "PYG" },
          down_payment: USD("20000.00"),
        }),
      }),
    );
    expect(driver.detail).toBe("Declaró una entrega inicial de USD 20.000.");
    expect(driver.strength).toBe(DRIVER_STRENGTH.downPaymentDeclared);
  });

  it("sin entrega inicial y financiado: a validar el 100 %", () => {
    const list = drivers({
      demand: snapshot({
        purchase_type: "financed",
        down_payment: USD("0.00"),
      }),
    });
    expect(list.map((driver) => [driver.label, driver.strength])).toEqual([
      ["Financiación", DRIVER_STRENGTH.financing],
      ["Sin entrega inicial", DRIVER_STRENGTH.zeroDownPayment],
    ]);
  });

  it.each([
    ["cash", "Pago contado", DRIVER_STRENGTH.cashPayment],
    ["financed", "Financiación", DRIVER_STRENGTH.financing],
    ["undecided", "Forma de pago a definir", DRIVER_STRENGTH.undecidedPayment],
  ] as const)("pago %s → %s", (purchase_type, label, strength) => {
    const driver = only(drivers({ demand: snapshot({ purchase_type }) }));
    expect(driver).toMatchObject({ kind: "financing", label, strength });
  });

  it("entrega un usado sin tasar: fuerte y, aparte, la tasación a validar", () => {
    const list = drivers({ demand: snapshot({ trade_in_intent: true }) });
    expect(list.map((driver) => [driver.kind, driver.strength])).toEqual([
      ["tradeIn", DRIVER_STRENGTH.tradeInDeclared],
      ["appraisal", DRIVER_STRENGTH.appraisalPending],
    ]);
  });

  it("no entrega usado (`false`): sin señal", () => {
    expect(drivers({ demand: snapshot({ trade_in_intent: false }) })).toEqual(
      [],
    );
  });
});

describe("toma del usado (DEC-052)", () => {
  it.each([
    ["accepted", "Usado en parte de pago", DRIVER_STRENGTH.tradeInAccepted],
    ["appraised", "Usado tasado", DRIVER_STRENGTH.tradeInAppraised],
  ] as const)("%s → %s, sin tasación pendiente", (status, label, strength) => {
    const driver = only(
      drivers({
        demand: snapshot({ trade_in_intent: true }),
        tradeIn: { status, label: "Toyota Fortuner 2019" },
      }),
    );
    expect(driver).toMatchObject({ kind: "tradeIn", label, strength });
    expect(driver.detail).toContain("Toyota Fortuner 2019");
  });

  it("pendiente: nombra el usado y pide tasarlo", () => {
    const list = drivers({
      tradeIn: { status: "pending", label: "Toyota Fortuner 2019" },
    });
    expect(list[0]?.detail).toBe(
      "Ofrece su Toyota Fortuner 2019 en parte de pago: reduce el saldo a pagar.",
    );
    expect(list[1]?.label).toBe("Tasación pendiente");
  });
});

describe("stock", () => {
  it("Top Match fuerte: unidad, precio y diferencia contra el presupuesto", () => {
    const driver = only(
      drivers({
        rail: { kind: "matches", top: matchCard(100), alternative: null },
      }),
    );
    expect(driver).toEqual({
      kind: "stock",
      label: "Match en stock",
      detail:
        "Toyota Hilux SRV · 2025 disponible por USD 49.900: USD 8.100 debajo del presupuesto.",
      source: "Stock · Top Match 100 pts",
      strength: 100,
      emphasis: ["Toyota Hilux SRV · 2025", "USD 49.900", "USD 8.100"],
    });
  });

  it("Top Match que excede el presupuesto lo dice", () => {
    const driver = only(
      drivers({
        rail: {
          kind: "matches",
          top: matchCard(80, {
            budgetDelta: { kind: "over", amount: "USD 2.000" },
          }),
          alternative: null,
        },
      }),
    );
    expect(driver.detail).toContain("USD 2.000 sobre el presupuesto");
    expect(driver.strength).toBe(80);
  });

  it("match parcial (menos de 70): a validar, con su puntaje como peso", () => {
    const driver = only(
      drivers({
        rail: { kind: "matches", top: matchCard(45), alternative: null },
      }),
    );
    expect(driver.label).toBe("Match parcial en stock");
    expect(driver.strength).toBe(45);
  });

  it("con la unidad vinculada, la señal es la vinculación", () => {
    const driver = only(
      drivers({
        hasLinkedVehicle: true,
        rail: { kind: "matches", top: matchCard(100), alternative: null },
      }),
    );
    expect(driver).toMatchObject({
      label: "Unidad vinculada",
      strength: DRIVER_STRENGTH.linkedVehicle,
    });
  });

  it.each(["no_demand", "no_stock", "no_match"] as const)(
    "rail vacío (%s): sin señal de stock",
    (reason) => {
      expect(drivers({ rail: { kind: "empty", reason } })).toEqual([]);
    },
  );
});

describe("agenda, cotizaciones y mensajes", () => {
  it("prueba agendada y confirmada: fecha y hora de Asunción", () => {
    const at = new Date("2026-11-19T13:00:00Z"); // jue 10:00 en Asunción
    const driver = only(
      drivers({
        signals: signals({
          testDrive: { state: "upcoming", at, confirmed: true },
        }),
      }),
    );
    expect(driver).toMatchObject({
      kind: "testDrive",
      label: "Prueba de manejo agendada",
      detail: "Agendada para el jue 19 nov, 10:00, confirmada por el cliente.",
      at: "jue 19 nov, 10:00",
      strength: DRIVER_STRENGTH.testDriveConfirmed,
    });
  });

  it.each([
    [
      "completed",
      "Prueba de manejo realizada",
      DRIVER_STRENGTH.testDriveCompleted,
    ],
    ["overdue", "Prueba sin resultado", DRIVER_STRENGTH.testDriveOverdue],
    ["no_show", "No asistió a la prueba", DRIVER_STRENGTH.testDriveNoShow],
  ] as const)("prueba %s → %s", (state, label, strength) => {
    const driver = only(
      drivers({
        signals: signals({
          testDrive: { state, at: ago(2 * DAY), confirmed: false },
        }),
      }),
    );
    expect(driver).toMatchObject({ label, strength, at: "dom 15 nov" });
  });

  it.each([
    ["accepted", "Cotización aceptada", DRIVER_STRENGTH.quoteAccepted],
    ["sent", "Cotización enviada", DRIVER_STRENGTH.quoteSent],
    ["pending", "Cotización sin enviar", DRIVER_STRENGTH.quotePending],
    ["expired", "Cotización vencida", DRIVER_STRENGTH.quoteExpired],
    ["rejected", "Cotización rechazada", DRIVER_STRENGTH.quoteRejected],
  ] as const)("cotización %s → %s", (state, label, strength) => {
    const driver = only(
      drivers({
        signals: signals({
          quote: {
            state,
            number: 12,
            total: USD("48500.00"),
            validUntil: "2026-11-25",
          },
        }),
      }),
    );
    expect(driver).toMatchObject({ kind: "quote", label, strength });
    expect(driver.detail).toContain("N.º 0012");
  });

  it("cotización enviada: número, total y vigencia reales", () => {
    const driver = only(
      drivers({
        signals: signals({
          quote: {
            state: "sent",
            number: 12,
            total: USD("48500.00"),
            validUntil: "2026-11-25",
          },
        }),
      }),
    );
    expect(driver.detail).toBe(
      "Tiene la cotización N.º 0012 por USD 48.500, vigente hasta el 25 nov.",
    );
    expect(driver.emphasis).toEqual(["N.º 0012", "USD 48.500", "25 nov"]);
  });

  it.each([
    [2 * HOUR, DRIVER_STRENGTH.inboundDay, "hace 2 h"],
    [30 * HOUR, DRIVER_STRENGTH.inboundThreeDays, "ayer 04:30"],
  ])("el cliente escribió hace %i ms → %i", (elapsed, strength, when) => {
    const driver = only(
      drivers({ signals: signals({ lastInboundAt: ago(elapsed) }) }),
    );
    expect(driver).toMatchObject({
      kind: "engagement",
      strength,
      detail: `El cliente escribió ${when}.`,
    });
  });

  it("un mensaje de hace 3 días o más no es interacción reciente", () => {
    expect(
      drivers({ signals: signals({ lastInboundAt: ago(3 * DAY) }) }),
    ).toEqual([]);
  });

  it.each([
    [3 * DAY, "Interés a confirmar", DRIVER_STRENGTH.coolingDown],
    [8 * DAY, "Riesgo de pérdida", DRIVER_STRENGTH.inactive],
  ])("sin actividad hace %i ms → %s", (elapsed, label, strength) => {
    const driver = only(
      drivers({ recency: evaluateRecency(ago(elapsed), NOW) }),
    );
    expect(driver).toMatchObject({ kind: "timing", label, strength });
  });
});

describe("orden y topes", () => {
  it("fuertes primero y después a validar, cada grupo del mayor peso al menor", () => {
    const list = drivers({
      demand: snapshot({
        budget_max: USD("58000.00"),
        down_payment: USD("20000.00"),
        purchase_type: "financed",
        trade_in_intent: true,
      }),
      rail: { kind: "matches", top: matchCard(100), alternative: null },
      signals: signals({
        lastInboundAt: ago(2 * HOUR),
        testDrive: { state: "upcoming", at: ago(-DAY), confirmed: true },
        quote: {
          state: "sent",
          number: 12,
          total: USD("48500.00"),
          validUntil: "2026-11-25",
        },
      }),
    });
    expect(list.map((driver) => [driver.kind, driver.strength])).toEqual([
      ["stock", 100],
      ["testDrive", 92],
      ["quote", 90],
      ["downPayment", 90],
      ["engagement", 90],
      ["tradeIn", 85],
      ["appraisal", 70],
      ["financing", 70],
    ]);
  });

  it("cada grupo respeta su tope", () => {
    const list = drivers({
      stage: "new",
      recency: evaluateRecency(ago(8 * DAY), NOW),
      demand: snapshot({
        budget_max: USD("58000.00"),
        down_payment: USD("2000.00"),
        purchase_type: "undecided",
        trade_in_intent: true,
      }),
      rail: { kind: "matches", top: matchCard(45), alternative: null },
      signals: signals({
        testDrive: { state: "no_show", at: ago(2 * DAY), confirmed: false },
        quote: {
          state: "rejected",
          number: 3,
          total: USD("50000.00"),
          validUntil: "2026-11-01",
        },
      }),
    });
    const validate = list.filter(
      (driver) => driver.strength < STRONG_DRIVER_MIN_STRENGTH,
    );
    expect(validate).toHaveLength(MAX_DRIVERS_PER_GROUP.validate);
    expect(validate.map((driver) => driver.strength)).toEqual([70, 65, 60]);
  });

  it("es determinista: la misma entrada, las mismas señales", () => {
    const data = input({
      demand: snapshot({ purchase_type: "cash", trade_in_intent: true }),
    });
    expect(deriveOpportunityDrivers(data, NOW)).toEqual(
      deriveOpportunityDrivers(data, NOW),
    );
  });

  it("las cifras resaltadas aparecen en el texto", () => {
    const list = drivers({
      demand: snapshot({
        budget_max: USD("58000.00"),
        down_payment: USD("20000.00"),
      }),
      rail: { kind: "matches", top: matchCard(100), alternative: null },
    });
    for (const driver of list) {
      for (const fragment of driver.emphasis ?? []) {
        expect(driver.detail).toContain(fragment);
      }
    }
  });
});

describe("fechas de Asunción", () => {
  it("día y hora en la zona de Paraguay", () => {
    const at = new Date("2026-11-19T13:00:00Z");
    expect(formatDriverDay(at)).toBe("jue 19 nov");
    expect(formatDriverDateTime(at)).toBe("jue 19 nov, 10:00");
  });
});
