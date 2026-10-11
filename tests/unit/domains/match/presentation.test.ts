import { describe, expect, it } from "vitest";

import type { DemandFact, DemandValues } from "@/domains/demand/facts";
import type {
  DemandSnapshot,
  DemandSnapshotFact,
} from "@/domains/demand/snapshot";
import {
  findMatchesForDemand,
  hasMatchableDemand,
  MATCH_REASONS,
  matchRail,
  type MatchCandidate,
} from "@/domains/match";

/*
 * Matches en el Opportunity Workspace (H1.5, DEC-031 §5): Top Match,
 * alternativa o un "sin dato" honesto que dice por qué.
 */

const ORG = "00000000-0000-4000-8000-000000000001";

type DemandInput = { [F in DemandFact]?: DemandValues[F] };

function snapshot(input: DemandInput = {}): DemandSnapshot {
  function fact<F extends DemandFact>(name: F): DemandSnapshotFact<F> {
    const value = input[name] as DemandValues[F] | undefined;
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

const HILUX_2025: MatchCandidate = {
  id: "v-hilux-2025",
  organizationId: ORG,
  status: "available",
  brand: "Toyota",
  model: "Hilux",
  version: "SRV 2.8 4x4 AT",
  year: 2025,
  km: 0,
  price: { amount: "49900.00", currency: "USD" },
};

const HILUX_2022: MatchCandidate = {
  id: "v-hilux-2022",
  organizationId: ORG,
  status: "available",
  brand: "Toyota",
  model: "Hilux",
  year: 2022,
  km: 64000,
  price: { amount: "38000.00", currency: "USD" },
};

const COROLLA: MatchCandidate = {
  id: "v-corolla",
  organizationId: ORG,
  status: "available",
  brand: "Toyota",
  model: "Corolla",
  year: 2023,
  price: null,
};

const DEMAND = snapshot({
  desired_vehicle: { brand: "Toyota", model: "Hilux" },
  year_range: { min: 2020 },
  budget_max: { amount: "45000.00", currency: "USD" },
});

function railFor(demand: DemandSnapshot, candidates: MatchCandidate[]) {
  return matchRail(
    demand,
    candidates,
    findMatchesForDemand(demand, candidates),
  );
}

describe("demanda evaluable por Match v0", () => {
  it("vehículo, años o presupuesto alcanzan; los demás facts no", () => {
    expect(hasMatchableDemand(snapshot())).toBe(false);
    expect(
      hasMatchableDemand(
        snapshot({
          purchase_type: "financed",
          trade_in_intent: true,
          down_payment: { amount: "0.00", currency: "PYG" },
        }),
      ),
    ).toBe(false);
    expect(
      hasMatchableDemand(snapshot({ desired_vehicle: { model: "Hilux" } })),
    ).toBe(true);
    expect(hasMatchableDemand(snapshot({ year_range: { max: 2018 } }))).toBe(
      true,
    );
    expect(
      hasMatchableDemand(
        snapshot({ budget_max: { amount: "1.00", currency: "USD" } }),
      ),
    ).toBe(true);
  });
});

describe("sin dato honesto: el rail dice por qué no hay matches", () => {
  it("sin demanda evaluable → no_demand, aunque haya stock", () => {
    expect(railFor(snapshot(), [HILUX_2025])).toEqual({
      kind: "empty",
      reason: "no_demand",
    });
    expect(railFor(snapshot({ purchase_type: "cash" }), [HILUX_2025])).toEqual({
      kind: "empty",
      reason: "no_demand",
    });
  });

  it("sin unidades disponibles → no_stock", () => {
    expect(railFor(DEMAND, [])).toEqual({ kind: "empty", reason: "no_stock" });
  });

  it("ninguna unidad llega al umbral → no_match", () => {
    const fordOnly = snapshot({ desired_vehicle: { brand: "Ford" } });
    expect(railFor(fordOnly, [HILUX_2025, COROLLA])).toEqual({
      kind: "empty",
      reason: "no_match",
    });
  });
});

describe("Top Match y alternativa", () => {
  it("los dos mejores matches, con la identidad de la unidad, el puntaje y las razones del motor", () => {
    expect(railFor(DEMAND, [HILUX_2025, COROLLA, HILUX_2022])).toEqual({
      kind: "matches",
      top: {
        vehicleId: "v-hilux-2022",
        name: "Toyota Hilux",
        detail: "2022",
        price: "USD 38.000",
        km: "64.000 km",
        score: { total: 100, vehicle: 45, year: 25, budget: 30 },
        reasons: [
          MATCH_REASONS.brandAndModel,
          MATCH_REASONS.yearInRange,
          MATCH_REASONS.priceWithinBudget,
          MATCH_REASONS.available,
        ],
      },
      alternative: {
        vehicleId: "v-hilux-2025",
        name: "Toyota Hilux",
        detail: "SRV 2.8 4x4 AT · 2025",
        price: "USD 49.900",
        km: "0 km",
        // USD 49.900 excede USD 45.000 en más del 10 %: no suma.
        score: { total: 70, vehicle: 45, year: 25, budget: 0 },
        reasons: [
          MATCH_REASONS.brandAndModel,
          MATCH_REASONS.yearInRange,
          MATCH_REASONS.available,
        ],
      },
    });
  });

  it("un solo match: sin alternativa", () => {
    const rail = railFor(DEMAND, [HILUX_2022]);
    expect(rail).toMatchObject({
      kind: "matches",
      top: { vehicleId: "v-hilux-2022" },
      alternative: null,
    });
  });

  it("sin precio ni km: null, nunca un valor inventado", () => {
    const demand = snapshot({
      desired_vehicle: { brand: "Toyota", model: "Corolla" },
    });
    expect(railFor(demand, [COROLLA])).toMatchObject({
      kind: "matches",
      top: {
        vehicleId: "v-corolla",
        detail: "2023",
        price: null,
        km: null,
        score: { total: 45 },
      },
    });
  });

  it("al rail no llega la organización", () => {
    const json = JSON.stringify(railFor(DEMAND, [HILUX_2025, HILUX_2022]));
    expect(json).not.toContain(ORG);
  });

  it("un resultado de una unidad que no está entre las candidatas es un error", () => {
    expect(() =>
      matchRail(
        DEMAND,
        [HILUX_2025],
        findMatchesForDemand(DEMAND, [HILUX_2022]),
      ),
    ).toThrow(/unknown vehicle/);
  });
});
