import { describe, expect, it } from "vitest";

import type { DemandFact, DemandValues } from "@/domains/demand/facts";
import type {
  DemandSnapshot,
  DemandSnapshotFact,
} from "@/domains/demand/snapshot";
import type { MatchableVehicle } from "@/domains/match";
import { OPPORTUNITY_STAGES, type Stage } from "@/domains/opportunities/stages";
import {
  DEAL_READINESS_BY_STAGE,
  evaluateOpportunity,
  INTENT_ACTIVITY_POINTS,
  INTENT_BASE_BY_STAGE,
  INTENT_INBOUND_POINTS,
  INTENT_QUOTE_POINTS,
  INTENT_TEST_DRIVE_POINTS,
  evaluateRecency,
  LINKED_VEHICLE_FIT,
  NOTE_RECENT_DAYS,
  nextBestAction,
  PORANDU_SCORE_COMPOSITION,
  RECENCY_PENALTY,
  RECENCY_STATE_DAYS,
  recencyCutoffs,
  recencyState,
  scoreOpportunity,
  stockFit,
  stockFitFromRail,
  type ScoringInput,
} from "@/domains/scoring/engine";
import type { IntentSignals } from "@/domains/scoring/signals";
import { RECENCY_STATE_LABELS, type StockFit } from "@/domains/scoring/types";

/*
 * Motor de inteligencia v0 (Hito 3, DEC-035): recencia, Porandú Score (el
 * Health Score de la oportunidad) y Next Best Action. Lógica pura: cada caso
 * fija `now` y combina fechas, etapas, unidad vinculada, Match v0 y bitácora.
 * Desde DEC-058, Intent v0: la etapa, la recencia, los mensajes del cliente,
 * la prueba de manejo y la cotización.
 */

const NOW = new Date("2026-10-12T15:00:00Z");
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** El momento que fue hace `ms` milisegundos, respecto de NOW. */
const ago = (ms: number) => new Date(NOW.getTime() - ms);

const OPEN_STAGES = ["new", "qualifying", "negotiating"] as const;

const MATCH_85: StockFit = { kind: "match", score: 85 };

/** Oportunidad abierta, activa, con una nota de hoy y sin unidad. */
function input(overrides: Partial<ScoringInput> = {}): ScoringInput {
  return {
    stage: "qualifying",
    lastActivityAt: ago(3 * HOUR),
    lastNoteAt: ago(1 * HOUR),
    hasLinkedVehicle: false,
    stockFit: MATCH_85,
    ...overrides,
  };
}

type DemandInput = { [F in DemandFact]?: DemandValues[F] };

/** DemandSnapshot con los facts dados; el resto, Unknown. */
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

function vehicle(overrides: Partial<MatchableVehicle> = {}): MatchableVehicle {
  return {
    id: "v-hilux",
    organizationId: "org-a",
    status: "available",
    brand: "Toyota",
    model: "Hilux",
    year: 2022,
    price: { amount: "30000.00", currency: "USD" },
    ...overrides,
  };
}

describe("reglas v0 del motor", () => {
  it("la composición es la del Master Context §10 y suma 1", () => {
    expect(PORANDU_SCORE_COMPOSITION).toEqual([
      { key: "intent", weight: 0.4 },
      { key: "fit", weight: 0.3 },
      { key: "deal", weight: 0.3 },
    ]);
    const total = PORANDU_SCORE_COMPOSITION.reduce(
      (sum, part) => sum + Math.round(part.weight * 100),
      0,
    );
    expect(total).toBe(100);
  });

  it("Deal Readiness crece con el embudo y cubre todas las etapas", () => {
    expect(Object.keys(DEAL_READINESS_BY_STAGE).sort()).toEqual(
      [...OPPORTUNITY_STAGES].sort(),
    );
    const open = OPEN_STAGES.map((stage) => DEAL_READINESS_BY_STAGE[stage]);
    expect(open).toEqual([20, 45, 75]);
    expect(open).toEqual([...open].sort((a, b) => a - b));
    expect(DEAL_READINESS_BY_STAGE.won).toBe(100);
    expect(DEAL_READINESS_BY_STAGE.lost).toBe(0);
  });

  it("la penalización por inactividad es 0, 15 y 40, y la unidad vinculada vale 100", () => {
    expect(RECENCY_PENALTY).toEqual({ active: 0, warning: 15, stale: 40 });
    expect(LINKED_VEHICLE_FIT).toBe(100);
    expect(RECENCY_STATE_DAYS).toEqual({ warning: 2, stale: 5 });
    expect(NOTE_RECENT_DAYS).toBe(2);
  });

  it("cada estado de recencia tiene su copy", () => {
    expect(RECENCY_STATE_LABELS).toEqual({
      active: "Activa",
      warning: "Enfriándose",
      stale: "Inactiva",
    });
  });
});

describe("recencia: días y horas desde last_activity_at", () => {
  it.each([
    [0, "active"],
    [5 * MINUTE, "active"],
    [23 * HOUR, "active"],
    [2 * DAY - MINUTE, "active"],
    [2 * DAY, "warning"],
    [3 * DAY + 7 * HOUR, "warning"],
    [5 * DAY, "warning"],
    [5 * DAY + MINUTE, "stale"],
    [30 * DAY, "stale"],
  ] as const)("hace %i ms → %s", (elapsed, state) => {
    expect(evaluateRecency(ago(elapsed), NOW).state).toBe(state);
    expect(recencyState(elapsed / MINUTE)).toBe(state);
  });

  it("devuelve minutos, horas y días enteros", () => {
    expect(evaluateRecency(ago(3 * DAY + 7 * HOUR + 30 * MINUTE), NOW)).toEqual(
      {
        state: "warning",
        minutes: 3 * 24 * 60 + 7 * 60 + 30,
        hours: 3 * 24 + 7,
        days: 3,
      },
    );
  });

  it("los segundos sueltos no cuentan: 5 días y 59 s sigue en warning", () => {
    expect(evaluateRecency(ago(5 * DAY + 59_000), NOW).state).toBe("warning");
  });

  it("una fecha futura (reloj desfasado) cuenta como 0: activa", () => {
    expect(evaluateRecency(new Date(NOW.getTime() + DAY), NOW)).toEqual({
      state: "active",
      minutes: 0,
      hours: 0,
      days: 0,
    });
  });

  it("una fecha inválida falla en vez de inventar un estado", () => {
    expect(() => evaluateRecency(new Date("nope"), NOW)).toThrow(RangeError);
    expect(() => evaluateRecency(NOW, new Date(Number.NaN))).toThrow(
      RangeError,
    );
  });
});

describe("recencyCutoffs: la misma regla como instantes de corte (DEC-037 §8)", () => {
  /** El estado según los cortes exclusivos, como lo cuenta la base. */
  function stateByCutoffs(lastActivityAt: Date): string {
    const cutoffs = recencyCutoffs(NOW);
    if (lastActivityAt < cutoffs.staleBefore) return "stale";
    if (lastActivityAt < cutoffs.warningBefore) return "warning";
    return "active";
  }

  it("cuenta como Enfriándose desde 2 días exactos y como Inactiva desde 5 días y 1 minuto, con límites exclusivos un milisegundo después", () => {
    expect(recencyCutoffs(NOW)).toEqual({
      warningBefore: ago(RECENCY_STATE_DAYS.warning * DAY - 1),
      staleBefore: ago(RECENCY_STATE_DAYS.stale * DAY + MINUTE - 1),
    });
  });

  it.each([
    -DAY,
    0,
    2 * DAY - MINUTE,
    2 * DAY - 1,
    2 * DAY,
    2 * DAY + 1,
    3 * DAY,
    5 * DAY,
    5 * DAY + 59_999,
    5 * DAY + MINUTE - 1,
    5 * DAY + MINUTE,
    5 * DAY + MINUTE + 1,
    30 * DAY,
  ])("hace %i ms: los cortes coinciden con evaluateRecency()", (elapsed) => {
    const lastActivityAt = ago(elapsed);
    expect(stateByCutoffs(lastActivityAt)).toBe(
      evaluateRecency(lastActivityAt, NOW).state,
    );
  });

  it("un `now` inválido falla en vez de inventar cortes", () => {
    expect(() => recencyCutoffs(new Date(Number.NaN))).toThrow(RangeError);
  });
});

describe("stockFit: Match v0 de la demanda contra el stock", () => {
  const HILUX = snapshot({
    desired_vehicle: { brand: "Toyota", model: "Hilux" },
  });

  it("sin vehículo, años ni presupuesto: sin dato (no_demand)", () => {
    expect(stockFit(snapshot({ purchase_type: "cash" }), [vehicle()])).toEqual({
      kind: "no_demand",
    });
  });

  it("con demanda y sin unidades: sin dato (no_stock)", () => {
    expect(stockFit(HILUX, [])).toEqual({ kind: "no_stock" });
  });

  it("con demanda y unidades que no llegan al umbral: no coincide (no_match)", () => {
    expect(
      stockFit(HILUX, [vehicle({ brand: "Ford", model: "Ranger" })]),
    ).toEqual({ kind: "no_match" });
  });

  it("con matches: el puntaje del Top Match", () => {
    const demand = snapshot({
      desired_vehicle: { brand: "Toyota", model: "Hilux" },
      year_range: { min: 2024 },
    });
    expect(
      stockFit(demand, [
        vehicle({ id: "old", year: 2020 }),
        vehicle({ id: "new", year: 2025 }),
      ]),
    ).toEqual({ kind: "match", score: 70 });
  });

  it("unidades de más de una organización fallan cerrado", () => {
    expect(() =>
      stockFit(HILUX, [
        vehicle(),
        vehicle({ id: "x", organizationId: "org-b" }),
      ]),
    ).toThrow("more than one organization");
  });
});

/** Porandú Score con la recencia que corresponde a la entrada. */
function score(overrides: Partial<ScoringInput>) {
  const data = input(overrides);
  return scoreOpportunity(data, evaluateRecency(data.lastActivityAt, NOW), NOW);
}

/** Señales de Intent: ninguna, salvo las dadas. */
function signals(overrides: Partial<IntentSignals> = {}): IntentSignals {
  return { lastInboundAt: null, testDrive: null, quote: null, ...overrides };
}

const QUOTE = {
  number: 12,
  total: { amount: "48500.00", currency: "USD" },
  validUntil: "2026-10-30",
} as const;

describe("Intent v0 (DEC-058)", () => {
  it("las bases y los puntos de cada señal son los aprobados", () => {
    expect(INTENT_BASE_BY_STAGE).toEqual({
      new: 25,
      qualifying: 35,
      negotiating: 45,
    });
    expect(INTENT_ACTIVITY_POINTS).toEqual({
      active: 5,
      warning: 0,
      stale: -15,
    });
    expect(INTENT_INBOUND_POINTS).toEqual({ day: 15, threeDays: 8 });
    expect(INTENT_TEST_DRIVE_POINTS).toEqual({
      completed: 20,
      upcoming: 15,
      overdue: 0,
      no_show: -10,
    });
    expect(INTENT_QUOTE_POINTS).toEqual({
      accepted: 25,
      sent: 15,
      pending: 5,
      expired: 0,
      rejected: -10,
    });
  });

  it("sin señales: la etapa y la recencia, nunca sin dato en una abierta", () => {
    const { scores, explanation } = score({});
    // En calificación (35) y activa (+5).
    expect(scores.intent).toBe(40);
    expect(explanation.factors.intent).toBe(
      "Etapa En calificación 35 · actividad al día +5",
    );
    // (40·40 + 30·85 + 30·45) / 100 = 55.
    expect(scores).toEqual({
      porandu: 55,
      coverage: 1,
      intent: 40,
      fit: 85,
      deal: 45,
    });
  });

  it("cada señal del cliente suma o resta y el motivo enumera los aportes", () => {
    const { scores, explanation } = score({
      stage: "negotiating",
      signals: signals({
        lastInboundAt: ago(2 * HOUR),
        testDrive: { state: "upcoming", at: ago(-DAY), confirmed: true },
        quote: { state: "sent", ...QUOTE },
      }),
    });
    // 45 + 5 + 15 + 15 + 15.
    expect(scores.intent).toBe(95);
    expect(explanation.factors.intent).toBe(
      "Etapa En negociación 45 · actividad al día +5 · escribió en las últimas 24 h +15 · prueba de manejo agendada +15 · cotización enviada +15",
    );
  });

  it.each([
    [ago(23 * HOUR), 40 + 15],
    [ago(30 * HOUR), 40 + 8],
    [ago(71 * HOUR), 40 + 8],
    [ago(72 * HOUR), 40],
    [null, 40],
  ] as const)(
    "el último mensaje del cliente (%o) deja Intent en %i",
    (lastInboundAt, intent) => {
      expect(score({ signals: signals({ lastInboundAt }) }).scores.intent).toBe(
        intent,
      );
    },
  );

  it.each([
    ["completed", 60],
    ["upcoming", 55],
    ["overdue", 40],
    ["no_show", 30],
  ] as const)("prueba de manejo %s → Intent %i", (state, intent) => {
    const testDrive = { state, at: NOW, confirmed: false };
    expect(score({ signals: signals({ testDrive }) }).scores.intent).toBe(
      intent,
    );
  });

  it.each([
    ["accepted", 65],
    ["sent", 55],
    ["pending", 45],
    ["expired", 40],
    ["rejected", 30],
  ] as const)("cotización %s → Intent %i", (state, intent) => {
    const quote = { state, ...QUOTE };
    expect(score({ signals: signals({ quote }) }).scores.intent).toBe(intent);
  });

  it("se acota entre 0 y 100", () => {
    const hot = score({
      stage: "negotiating",
      signals: signals({
        lastInboundAt: ago(HOUR),
        testDrive: { state: "completed", at: ago(DAY), confirmed: false },
        quote: { state: "accepted", ...QUOTE },
      }),
    });
    expect(hot.scores.intent).toBe(100);
    const cold = score({
      stage: "new",
      lastActivityAt: ago(9 * DAY),
      signals: signals({
        testDrive: { state: "no_show", at: ago(8 * DAY), confirmed: false },
        quote: { state: "rejected", ...QUOTE },
      }),
    });
    // 25 − 15 − 10 − 10 = −10 → 0.
    expect(cold.scores.intent).toBe(0);
  });

  it.each([
    ["won", 100],
    ["lost", 0],
  ] as const)("%s: Intent es el resultado (%i)", (stage, intent) => {
    const { scores, explanation } = score({ stage });
    expect(scores.intent).toBe(intent);
    expect(explanation.factors.intent).toBe(
      stage === "won" ? "Etapa Ganada" : "Etapa Perdida",
    );
  });

  it("un mensaje con fecha inválida falla en vez de inventar un estado", () => {
    expect(() =>
      score({ signals: signals({ lastInboundAt: new Date("nope") }) }),
    ).toThrow("invalid lastInboundAt");
  });
});

describe("Porandú Score (Health Score) v0", () => {
  it.each([
    // etapa, unidad, Match v0, hace, Intent, Fit, Deal, Porandú
    ["new", false, { kind: "no_demand" }, 1 * HOUR, 30, null, 20, 26],
    ["new", false, MATCH_85, 1 * HOUR, 30, 85, 20, 44],
    ["new", false, { kind: "match", score: 100 }, 1 * HOUR, 30, 100, 20, 48],
    ["qualifying", false, { kind: "no_match" }, 1 * HOUR, 40, 0, 45, 30],
    ["qualifying", false, { kind: "no_stock" }, 1 * HOUR, 40, null, 45, 42],
    ["negotiating", true, MATCH_85, 1 * HOUR, 50, 100, 75, 73],
    ["negotiating", true, { kind: "no_match" }, 1 * HOUR, 50, 100, 75, 73],
    ["negotiating", false, MATCH_85, 1 * HOUR, 50, 85, 75, 68],
    // Enfriándose: Intent sin el +5 de la actividad y −15 al Porandú.
    ["negotiating", true, MATCH_85, 3 * DAY, 45, 100, 75, 56],
    ["qualifying", false, { kind: "no_stock" }, 3 * DAY, 35, null, 45, 24],
    // Inactiva: Intent −15 y −40 al Porandú.
    ["negotiating", true, MATCH_85, 8 * DAY, 30, 100, 75, 25],
    ["new", false, MATCH_85, 8 * DAY, 10, 85, 20, 0],
    ["new", false, { kind: "no_demand" }, 8 * DAY, 10, null, 20, 0],
    ["negotiating", false, { kind: "no_match" }, 8 * DAY, 30, 0, 75, 0],
  ] as const)(
    "%s · vinculada %s · %o · hace %i ms → Intent %i, Fit %s, Deal %s, Porandú %i",
    (
      stage,
      linked,
      fit,
      elapsed,
      intentValue,
      fitValue,
      dealValue,
      porandu,
    ) => {
      const { scores } = score({
        stage,
        hasLinkedVehicle: linked,
        stockFit: fit,
        lastActivityAt: ago(elapsed),
      });
      expect(scores.intent).toBe(intentValue);
      expect(scores.fit).toBe(fitValue);
      expect(scores.deal).toBe(dealValue);
      expect(scores.porandu).toBe(porandu);
      expect(scores.coverage).toBe(fitValue === null ? 0.7 : 1);
    },
  );

  it("el redondeo es exacto: 72,5 sube a 73 (pesos enteros, sin coma flotante)", () => {
    // (40·50 + 30·100 + 30·75) / 100 = 72,5.
    const { scores } = score({ stage: "negotiating", hasLinkedVehicle: true });
    expect(scores.porandu).toBe(73);
  });

  it("un Fit sin dato no penaliza; un Fit que no coincide sí (DEC-005)", () => {
    const unknown = score({ stockFit: { kind: "no_stock" } }).scores;
    const mismatch = score({ stockFit: { kind: "no_match" } }).scores;
    // Sin Fit: (40·40 + 30·45) / 70 = 42,1.
    expect(unknown.porandu).toBe(42);
    expect(mismatch.porandu).toBeLessThan(unknown.porandu ?? 0);
    expect(unknown.coverage).toBeLessThan(mismatch.coverage);
  });

  it("la unidad vinculada suma más que cualquier Top Match", () => {
    const linked = score({
      hasLinkedVehicle: true,
      stockFit: { kind: "no_match" },
    });
    const best = score({ stockFit: { kind: "match", score: 99 } });
    expect(linked.scores.fit).toBe(100);
    expect(linked.explanation.factors.fit).toBe("Unidad del stock vinculada");
    expect(linked.scores.porandu).toBeGreaterThan(best.scores.porandu ?? 0);
  });

  it("a igual demanda y recencia, una etapa más avanzada nunca baja el score", () => {
    const values = OPEN_STAGES.map(
      (stage) => score({ stage }).scores.porandu ?? -1,
    );
    expect(values).toEqual([...values].sort((a, b) => a - b));
  });

  it("la inactividad baja el score: activa > enfriándose > inactiva", () => {
    const [active, warning, stale] = [1 * HOUR, 3 * DAY, 8 * DAY].map(
      (elapsed) =>
        score({
          stage: "negotiating",
          hasLinkedVehicle: true,
          lastActivityAt: ago(elapsed),
        }).scores.porandu ?? -1,
    );
    expect(active).toBeGreaterThan(warning!);
    expect(warning).toBeGreaterThan(stale!);
    // −40 de penalización y 20 puntos menos de Intent (+5 → −15) por su 40 %.
    expect(active! - stale!).toBe(RECENCY_PENALTY.stale + 8);
  });

  it("explica cada sub-score y la penalización, con su motivo", () => {
    expect(
      score({
        stage: "negotiating",
        stockFit: MATCH_85,
        lastActivityAt: ago(8 * DAY + 2 * HOUR),
      }).explanation,
    ).toEqual({
      factors: {
        intent: "Etapa En negociación 45 · sin actividad −15",
        fit: "Top Match en stock: 85 pts",
        deal: "Etapa En negociación",
      },
      penalties: [
        {
          kind: "inactivity",
          label: "Inactiva hace 8 días · riesgo de pérdida",
          points: -40,
        },
      ],
      outcome: null,
    });
    expect(
      score({ lastActivityAt: ago(2 * DAY) }).explanation.penalties,
    ).toEqual([
      { kind: "inactivity", label: "Sin actividad hace 2 días", points: -15 },
    ]);
    expect(score({}).explanation.penalties).toEqual([]);
  });

  it.each([
    [{ kind: "no_match" }, "Ninguna unidad disponible coincide"],
    [{ kind: "no_demand" }, "Sin dato: falta lo que busca"],
    [{ kind: "no_stock" }, "Sin dato: no hay unidades disponibles"],
  ] as const)("Fit %o se explica: %s", (fit, reason) => {
    expect(score({ stockFit: fit }).explanation.factors.fit).toBe(reason);
  });

  it.each([
    ["won", 100, "Ganada: la venta se concretó"],
    ["lost", 0, "Perdida: la oportunidad se descartó"],
  ] as const)(
    "%s: el score es el resultado, sin penalización aunque esté inactiva",
    (stage, porandu, outcome) => {
      const { scores, explanation } = score({
        stage,
        hasLinkedVehicle: true,
        lastActivityAt: ago(40 * DAY),
      });
      expect(scores.porandu).toBe(porandu);
      expect(scores.deal).toBe(DEAL_READINESS_BY_STAGE[stage]);
      expect(explanation.penalties).toEqual([]);
      expect(explanation.outcome).toBe(outcome);
    },
  );

  it("siempre entre 0 y 100, en todas las combinaciones", () => {
    const fits: StockFit[] = [
      { kind: "match", score: 40 },
      { kind: "match", score: 100 },
      { kind: "no_match" },
      { kind: "no_demand" },
      { kind: "no_stock" },
    ];
    for (const stage of OPPORTUNITY_STAGES) {
      for (const fit of fits) {
        for (const linked of [false, true]) {
          for (const elapsed of [0, 2 * DAY, 6 * DAY, 400 * DAY]) {
            const { scores } = score({
              stage,
              stockFit: fit,
              hasLinkedVehicle: linked,
              lastActivityAt: ago(elapsed),
            });
            expect(scores.porandu).not.toBeNull();
            expect(scores.porandu).toBeGreaterThanOrEqual(0);
            expect(scores.porandu).toBeLessThanOrEqual(100);
            expect(Number.isInteger(scores.porandu)).toBe(true);
          }
        }
      }
    }
  });
});

/** NBA con la recencia que corresponde a la entrada. */
function nba(overrides: Partial<ScoringInput>) {
  const data = input(overrides);
  return nextBestAction(data, evaluateRecency(data.lastActivityAt, NOW), NOW);
}

describe("Next Best Action", () => {
  it("inactiva: retomar contacto urgente, con riesgo de pérdida", () => {
    expect(nba({ lastActivityAt: ago(6 * DAY + 3 * HOUR) })).toEqual({
      code: "recover_stale",
      kind: "call",
      action: "Retomar contacto urgente",
      reason: "Sin actividad del cliente hace 6 días: riesgo de pérdida.",
      secondary: [],
      urgent: true,
    });
  });

  it("En negociación sin unidad vinculada: vincular unidad de stock", () => {
    expect(nba({ stage: "negotiating" })).toEqual({
      code: "link_vehicle",
      kind: "linkVehicle",
      action: "Vincular unidad de stock",
      reason:
        "En negociación sin una unidad vinculada. El Top Match del stock suma 85 pts.",
      secondary: [],
      urgent: false,
    });
  });

  it.each([
    [
      { kind: "no_match" },
      "En negociación sin una unidad vinculada, y ninguna unidad disponible coincide con lo que busca.",
    ],
    [
      { kind: "no_demand" },
      "En negociación sin una unidad vinculada. Cargá lo que busca para encontrarla en el stock.",
    ],
    [
      { kind: "no_stock" },
      "En negociación sin una unidad vinculada, y no hay unidades disponibles en stock.",
    ],
  ] as const)("vincular explica el stock: %o", (fit, reason) => {
    expect(nba({ stage: "negotiating", stockFit: fit })?.reason).toBe(reason);
  });

  it("con la unidad vinculada, En negociación no pide vincular", () => {
    expect(nba({ stage: "negotiating", hasLinkedVehicle: true })?.code).toBe(
      "on_track",
    );
  });

  it.each(["new", "qualifying"] as const)(
    "%s sin unidad no pide vincular (solo se vincula En negociación)",
    (stage) => {
      expect(nba({ stage })?.code).toBe("on_track");
    },
  );

  it("sin notas: registrar actualización de contacto", () => {
    expect(nba({ lastNoteAt: null })).toEqual({
      code: "log_contact_update",
      kind: "note",
      action: "Registrar actualización de contacto",
      reason: "Todavía no hay notas en la bitácora.",
      secondary: [],
      urgent: false,
    });
  });

  it.each([
    [2 * DAY - MINUTE, "on_track"],
    [2 * DAY, "log_contact_update"],
    [9 * DAY, "log_contact_update"],
  ] as const)("nota de hace %i ms → %s", (elapsed, code) => {
    expect(nba({ lastNoteAt: ago(elapsed) })?.code).toBe(code);
  });

  it("dice hace cuántos días fue la última nota", () => {
    expect(nba({ lastNoteAt: ago(3 * DAY + HOUR) })?.reason).toBe(
      "La última nota es de hace 3 días.",
    );
  });

  it("enfriándose con la bitácora al día: hacer seguimiento", () => {
    expect(nba({ lastActivityAt: ago(4 * DAY) })).toEqual({
      code: "follow_up",
      kind: "message",
      action: "Hacer seguimiento",
      reason: "Sin actividad del cliente hace 4 días.",
      secondary: [],
      urgent: false,
    });
  });

  it("activa y con la bitácora al día: sostener el seguimiento", () => {
    expect(nba({})).toEqual({
      code: "on_track",
      kind: "message",
      action: "Sostener el seguimiento",
      reason: "Actividad y bitácora al día.",
      secondary: [],
      urgent: false,
    });
  });

  it("prioridad: inactiva > vincular > registrar, con hasta 2 secundarias", () => {
    expect(
      nba({
        stage: "negotiating",
        lastActivityAt: ago(7 * DAY),
        lastNoteAt: null,
      }),
    ).toMatchObject({
      code: "recover_stale",
      secondary: [
        "Vincular unidad de stock",
        "Registrar actualización de contacto",
      ],
    });
    expect(
      nba({
        stage: "negotiating",
        lastActivityAt: ago(3 * DAY),
        lastNoteAt: null,
      }),
    ).toMatchObject({
      code: "link_vehicle",
      secondary: ["Registrar actualización de contacto", "Hacer seguimiento"],
    });
    expect(
      nba({ lastActivityAt: ago(3 * DAY), lastNoteAt: ago(4 * DAY) }),
    ).toMatchObject({
      code: "log_contact_update",
      secondary: ["Hacer seguimiento"],
    });
  });

  it("solo la inactividad es urgente", () => {
    const codes = [
      nba({ stage: "negotiating" }),
      nba({ lastNoteAt: null }),
      nba({ lastActivityAt: ago(4 * DAY) }),
      nba({}),
    ];
    expect(codes.map((item) => item?.urgent)).toEqual([
      false,
      false,
      false,
      false,
    ]);
  });

  it.each(["won", "lost"] as const)(
    "%s: sin acción, aunque esté inactiva y sin notas",
    (stage) => {
      expect(
        nba({ stage, lastActivityAt: ago(60 * DAY), lastNoteAt: null }),
      ).toBeNull();
    },
  );

  it("ninguna sugerencia cambia condiciones económicas", () => {
    for (const stage of OPEN_STAGES) {
      for (const elapsed of [0, 3 * DAY, 9 * DAY]) {
        const action = nba({
          stage,
          lastActivityAt: ago(elapsed),
          lastNoteAt: null,
        });
        expect(action).not.toBeNull();
        expect(action).not.toHaveProperty("needsApproval");
      }
    }
  });
});

describe("evaluateOpportunity", () => {
  it("junta recencia, scores, explicación y NBA de la misma entrada", () => {
    const data = input({
      stage: "negotiating",
      lastActivityAt: ago(6 * DAY),
      lastNoteAt: null,
      stockFit: { kind: "no_match" },
    });
    expect(evaluateOpportunity(data, NOW)).toEqual({
      recency: { state: "stale", minutes: 6 * 24 * 60, hours: 144, days: 6 },
      scores: {
        porandu: 0,
        coverage: 1,
        intent: 30,
        fit: 0,
        deal: 75,
      },
      explanation: {
        factors: {
          intent: "Etapa En negociación 45 · sin actividad −15",
          fit: "Ninguna unidad disponible coincide",
          deal: "Etapa En negociación",
        },
        penalties: [
          {
            kind: "inactivity",
            label: "Inactiva hace 6 días · riesgo de pérdida",
            points: -40,
          },
        ],
        outcome: null,
      },
      nba: {
        code: "recover_stale",
        kind: "call",
        action: "Retomar contacto urgente",
        reason: "Sin actividad del cliente hace 6 días: riesgo de pérdida.",
        secondary: [
          "Vincular unidad de stock",
          "Registrar actualización de contacto",
        ],
        urgent: true,
      },
    });
  });

  it("es determinista y no modifica la entrada", () => {
    const data = Object.freeze(
      input({ stage: "negotiating", lastNoteAt: null }),
    );
    const first = evaluateOpportunity(data, NOW);
    expect(evaluateOpportunity(data, NOW)).toEqual(first);
    expect(data.stage).toBe("negotiating");
  });

  it("el mismo dato con otro `now` cambia solo lo que depende del tiempo", () => {
    const data = input({ stage: "negotiating", hasLinkedVehicle: true });
    const today = evaluateOpportunity(data, NOW);
    const later = evaluateOpportunity(data, new Date(NOW.getTime() + 7 * DAY));
    expect(today.recency.state).toBe("active");
    expect(later.recency.state).toBe("stale");
    expect(later.scores.fit).toBe(today.scores.fit);
    expect(later.scores.deal).toBe(today.scores.deal);
    // Intent baja 20 (de +5 a −15): 8 puntos de su 40 %, más los −40.
    expect(later.scores.intent).toBe((today.scores.intent ?? 0) - 20);
    expect(later.scores.porandu).toBe((today.scores.porandu ?? 0) - 48);
    expect(later.nba?.code).toBe("recover_stale");
  });

  it.each(OPPORTUNITY_STAGES.map((stage) => [stage] as [Stage]))(
    "%s: siempre devuelve una recencia y un score",
    (stage) => {
      const result = evaluateOpportunity(input({ stage }), NOW);
      expect(result.recency.state).toBe("active");
      expect(result.scores.porandu).not.toBeNull();
    },
  );
});

describe("stockFitFromRail (DEC-058)", () => {
  it("lee del rail ya calculado lo mismo que stockFit()", () => {
    expect(stockFitFromRail({ kind: "empty", reason: "no_demand" })).toEqual({
      kind: "no_demand",
    });
    expect(stockFitFromRail({ kind: "empty", reason: "no_stock" })).toEqual({
      kind: "no_stock",
    });
    expect(stockFitFromRail({ kind: "empty", reason: "no_match" })).toEqual({
      kind: "no_match",
    });
    const top = {
      vehicleId: "v-hilux",
      name: "Toyota Hilux",
      detail: "2022",
      price: "USD 30.000",
      km: null,
      score: { total: 70, vehicle: 45, year: 25, budget: 0 },
      reasons: [],
      condition: null,
      body: "pickup",
      budgetDelta: null,
      balance: null,
    } as const;
    expect(
      stockFitFromRail({ kind: "matches", top, alternative: null }),
    ).toEqual({ kind: "match", score: 70 });
  });
});
