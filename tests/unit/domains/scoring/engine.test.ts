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
  evaluateRecency,
  LINKED_VEHICLE_FIT,
  NOTE_RECENT_DAYS,
  nextBestAction,
  PORANDU_SCORE_COMPOSITION,
  RECENCY_PENALTY,
  RECENCY_STATE_DAYS,
  recencyState,
  scoreOpportunity,
  stockFit,
  type ScoringInput,
} from "@/domains/scoring/engine";
import { RECENCY_STATE_LABELS, type StockFit } from "@/domains/scoring/types";

/*
 * Motor de inteligencia v0 (Hito 3, DEC-035): recencia, Porandú Score (el
 * Health Score de la oportunidad) y Next Best Action. Lógica pura: cada caso
 * fija `now` y combina fechas, etapas, unidad vinculada, Match v0 y bitácora.
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
  return scoreOpportunity(data, evaluateRecency(data.lastActivityAt, NOW));
}

describe("Porandú Score (Health Score) v0", () => {
  it("Intent es sin dato hasta las conversaciones y no penaliza", () => {
    const { scores, explanation } = score({});
    expect(scores.intent).toBeNull();
    expect(explanation.factors.intent).toBe(
      "Sin dato: llega con las conversaciones",
    );
    // Fit 85 y Deal 45 pesan igual (30 % y 30 %): (85 + 45) / 2 = 65.
    expect(scores).toEqual({
      porandu: 65,
      coverage: 0.6,
      intent: null,
      fit: 85,
      deal: 45,
    });
  });

  it.each([
    // etapa, unidad, Match v0, hace, Fit, Deal, Porandú
    ["new", false, { kind: "no_demand" }, 1 * HOUR, null, 20, 20],
    ["new", false, MATCH_85, 1 * HOUR, 85, 20, 53],
    ["new", false, { kind: "match", score: 100 }, 1 * HOUR, 100, 20, 60],
    ["qualifying", false, { kind: "no_match" }, 1 * HOUR, 0, 45, 23],
    ["qualifying", false, { kind: "no_stock" }, 1 * HOUR, null, 45, 45],
    ["negotiating", true, MATCH_85, 1 * HOUR, 100, 75, 88],
    ["negotiating", true, { kind: "no_match" }, 1 * HOUR, 100, 75, 88],
    ["negotiating", false, MATCH_85, 1 * HOUR, 85, 75, 80],
    // Enfriándose: −15.
    ["negotiating", true, MATCH_85, 3 * DAY, 100, 75, 73],
    ["qualifying", false, { kind: "no_stock" }, 3 * DAY, null, 45, 30],
    // Inactiva: −40.
    ["negotiating", true, MATCH_85, 8 * DAY, 100, 75, 48],
    ["new", false, MATCH_85, 8 * DAY, 85, 20, 13],
    ["new", false, { kind: "no_demand" }, 8 * DAY, null, 20, 0],
    ["negotiating", false, { kind: "no_match" }, 8 * DAY, 0, 75, 0],
  ] as const)(
    "%s · vinculada %s · %o · hace %i ms → Fit %s, Deal %s, Porandú %i",
    (stage, linked, fit, elapsed, fitValue, dealValue, porandu) => {
      const { scores } = score({
        stage,
        hasLinkedVehicle: linked,
        stockFit: fit,
        lastActivityAt: ago(elapsed),
      });
      expect(scores.fit).toBe(fitValue);
      expect(scores.deal).toBe(dealValue);
      expect(scores.porandu).toBe(porandu);
      expect(scores.coverage).toBe(fitValue === null ? 0.3 : 0.6);
    },
  );

  it("el redondeo es exacto: 87,5 sube a 88 (pesos enteros, sin coma flotante)", () => {
    const { scores } = score({ stage: "negotiating", hasLinkedVehicle: true });
    expect(scores.porandu).toBe(88);
  });

  it("un Fit sin dato no penaliza; un Fit que no coincide sí (DEC-005)", () => {
    const unknown = score({ stockFit: { kind: "no_stock" } }).scores;
    const mismatch = score({ stockFit: { kind: "no_match" } }).scores;
    expect(unknown.porandu).toBe(DEAL_READINESS_BY_STAGE.qualifying);
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
    expect(active! - stale!).toBe(RECENCY_PENALTY.stale);
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
        intent: "Sin dato: llega con las conversaciones",
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
        coverage: 0.6,
        intent: null,
        fit: 0,
        deal: 75,
      },
      explanation: {
        factors: {
          intent: "Sin dato: llega con las conversaciones",
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
    expect(later.scores.porandu).toBe((today.scores.porandu ?? 0) - 40);
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
