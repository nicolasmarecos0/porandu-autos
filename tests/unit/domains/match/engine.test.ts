import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import type { DemandFact, DemandValues } from "@/domains/demand/facts";
import type { CurrentStatus } from "@/domains/demand/resolver";
import type {
  DemandSnapshot,
  DemandSnapshotFact,
} from "@/domains/demand/snapshot";
import {
  evaluateMatch,
  findMatchesForDemand,
  MATCH_POINTS,
  MATCH_REASONS,
  MATCH_THRESHOLD,
  type MatchableVehicle,
} from "@/domains/match";
import {
  evaluateBudget,
  evaluateDesiredVehicle,
  evaluateYearRange,
} from "@/domains/match/evaluators";
import type { Money } from "@/domains/money";
import { VEHICLE_STATUSES } from "@/domains/vehicles/stock";

/*
 * Match v0 (H1.5, DEC-031): motor puro, determinista y explicable. Cruza el
 * DemandSnapshot de una oportunidad con unidades del stock.
 */

const ORG = "org-a";

const usd = (amount: string): Money => ({ amount, currency: "USD" });
const pyg = (amount: string): Money => ({ amount, currency: "PYG" });

type DemandInput = { [F in DemandFact]?: DemandValues[F] };

/** DemandSnapshot con los facts dados; el resto, Unknown. */
function snapshot(
  input: DemandInput = {},
  status: Exclude<CurrentStatus, "unknown"> = "confirmed",
): DemandSnapshot {
  function fact<F extends DemandFact>(name: F): DemandSnapshotFact<F> {
    const value = input[name] as DemandValues[F] | undefined;
    return value === undefined
      ? { value: null, status: "unknown", factId: null }
      : { value, status, factId: `${name}-1` };
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
    organizationId: ORG,
    status: "available",
    brand: "Toyota",
    model: "Hilux",
    year: 2022,
    price: usd("30000.00"),
    ...overrides,
  };
}

/** Busca una Toyota Hilux 2020–2024 con hasta USD 35.000. */
const FULL_DEMAND = snapshot({
  desired_vehicle: { brand: "Toyota", model: "Hilux" },
  year_range: { min: 2020, max: 2024 },
  budget_max: usd("35000.00"),
});

describe("reglas de Match v0", () => {
  it("puntos de cada criterio: el máximo es 100 y el umbral 40", () => {
    expect(MATCH_POINTS).toEqual({
      brandAndModel: 45,
      model: 35,
      brand: 35,
      yearInRange: 25,
      priceWithinBudget: 30,
      priceNearBudget: 10,
    });
    expect(
      MATCH_POINTS.brandAndModel +
        MATCH_POINTS.yearInRange +
        MATCH_POINTS.priceWithinBudget,
    ).toBe(100);
    expect(MATCH_THRESHOLD).toBe(40);
  });
});

describe("match perfecto", () => {
  it("marca, modelo, año en rango y precio dentro del presupuesto → 100", () => {
    expect(evaluateMatch(FULL_DEMAND, vehicle())).toEqual({
      vehicleId: "v-hilux",
      score: { total: 100, vehicle: 45, year: 25, budget: 30 },
      reasons: [
        "Marca y modelo coinciden exactamente",
        "Año dentro del rango buscado",
        "Precio dentro del presupuesto",
        "Unidad disponible en stock",
      ],
    });
  });

  it("marca y modelo se comparan sin mayúsculas ni espacios en los bordes", () => {
    const demand = snapshot({
      desired_vehicle: { brand: "TOYOTA", model: "hilux" },
    });
    expect(
      evaluateMatch(demand, vehicle({ brand: " Toyota ", model: "HiLux " })),
    ).toMatchObject({
      score: { total: 45, vehicle: 45 },
      reasons: [MATCH_REASONS.brandAndModel, MATCH_REASONS.available],
    });
  });

  it("un precio igual al presupuesto está dentro del presupuesto", () => {
    const result = evaluateMatch(
      FULL_DEMAND,
      vehicle({ price: usd("35000.00") }),
    );
    expect(result?.score.budget).toBe(30);
    expect(result?.reasons).toContain(MATCH_REASONS.priceWithinBudget);
  });

  it("marca y modelo solos ya son un match (45 ≥ 40)", () => {
    const demand = snapshot({
      desired_vehicle: { brand: "Toyota", model: "Hilux" },
    });
    expect(evaluateMatch(demand, vehicle())).toEqual({
      vehicleId: "v-hilux",
      score: { total: 45, vehicle: 45, year: 0, budget: 0 },
      reasons: [MATCH_REASONS.brandAndModel, MATCH_REASONS.available],
    });
  });

  it("un valor detectado pesa igual que uno confirmado", () => {
    const input: DemandInput = {
      desired_vehicle: { brand: "Toyota", model: "Hilux" },
      year_range: { min: 2020 },
      budget_max: usd("35000.00"),
    };
    expect(evaluateMatch(snapshot(input, "detected"), vehicle())).toEqual(
      evaluateMatch(snapshot(input, "confirmed"), vehicle()),
    );
    expect(evaluateMatch(snapshot(input, "corrected"), vehicle())).toEqual(
      evaluateMatch(snapshot(input, "confirmed"), vehicle()),
    );
  });

  it("es determinista y no modifica sus entradas", () => {
    const demand = structuredClone(FULL_DEMAND);
    const unit = vehicle();
    const before = structuredClone(unit);
    expect(evaluateMatch(demand, unit)).toEqual(evaluateMatch(demand, unit));
    expect(unit).toEqual(before);
    expect(demand).toEqual(FULL_DEMAND);
  });
});

describe("match parcial por marca sola", () => {
  const BRAND_ONLY = snapshot({
    desired_vehicle: { brand: "Toyota" },
    year_range: { min: 2020, max: 2024 },
    budget_max: usd("35000.00"),
  });

  it("solo marca: coincide → 35, cualquier modelo de la marca", () => {
    for (const model of ["Hilux", "Corolla", "SW4"]) {
      expect(evaluateMatch(BRAND_ONLY, vehicle({ model }))).toEqual({
        vehicleId: "v-hilux",
        score: { total: 90, vehicle: 35, year: 25, budget: 30 },
        reasons: [
          "Marca coincide con la buscada",
          "Año dentro del rango buscado",
          "Precio dentro del presupuesto",
          "Unidad disponible en stock",
        ],
      });
    }
  });

  it("la marca sola no alcanza el umbral (35 < 40)", () => {
    const demand = snapshot({ desired_vehicle: { brand: "Toyota" } });
    expect(evaluateMatch(demand, vehicle())).toBeNull();
  });

  it("marca más un precio cercano al presupuesto → 45, match", () => {
    const demand = snapshot({
      desired_vehicle: { brand: "Toyota" },
      budget_max: usd("28000.00"),
    });
    expect(evaluateMatch(demand, vehicle())).toEqual({
      vehicleId: "v-hilux",
      score: { total: 45, vehicle: 35, year: 0, budget: 10 },
      reasons: [
        MATCH_REASONS.brand,
        MATCH_REASONS.priceNearBudget,
        MATCH_REASONS.available,
      ],
    });
  });

  it("marca y modelo definidos, misma marca y otro modelo → 0 de vehículo, sin descalificar, explicado como modelo alternativo", () => {
    expect(evaluateMatch(FULL_DEMAND, vehicle({ model: "Corolla" }))).toEqual({
      vehicleId: "v-hilux",
      score: { total: 55, vehicle: 0, year: 25, budget: 30 },
      reasons: [
        "Misma marca, modelo alternativo",
        MATCH_REASONS.yearInRange,
        MATCH_REASONS.priceWithinBudget,
        MATCH_REASONS.available,
      ],
    });
    expect(
      evaluateDesiredVehicle(
        { brand: "Toyota", model: "Hilux" },
        { brand: "toyota", model: "Corolla" },
      ),
    ).toEqual({
      status: "partial",
      points: 0,
      reason: MATCH_REASONS.alternativeModel,
    });
  });

  it("misma marca y otro modelo, sin otras señales → sin match", () => {
    const demand = snapshot({
      desired_vehicle: { brand: "Toyota", model: "Hilux" },
    });
    expect(evaluateMatch(demand, vehicle({ model: "Corolla" }))).toBeNull();
  });
});

describe("match por modelo solo (DEC-031)", () => {
  const MODEL_ONLY = snapshot({
    desired_vehicle: { model: "Hilux" },
    year_range: { min: 2020, max: 2024 },
    budget_max: usd("35000.00"),
  });

  it("solo modelo: coincide → 35, sin mayúsculas ni espacios en los bordes", () => {
    expect(evaluateMatch(MODEL_ONLY, vehicle({ model: " HILUX" }))).toEqual({
      vehicleId: "v-hilux",
      score: { total: 90, vehicle: 35, year: 25, budget: 30 },
      reasons: [
        "Modelo coincide con el buscado",
        MATCH_REASONS.yearInRange,
        MATCH_REASONS.priceWithinBudget,
        MATCH_REASONS.available,
      ],
    });
  });

  it("el modelo solo no alcanza el umbral (35 < 40)", () => {
    const demand = snapshot({ desired_vehicle: { model: "Hilux" } });
    expect(evaluateMatch(demand, vehicle())).toBeNull();
  });

  it("otro modelo → 0 y no descalifica: sin marca no hay con qué descalificar", () => {
    expect(
      evaluateDesiredVehicle(
        { model: "Hilux" },
        { brand: "Ford", model: "Ranger" },
      ),
    ).toEqual({ status: "mismatch", points: 0, reason: null });
    expect(
      evaluateMatch(MODEL_ONLY, vehicle({ brand: "Ford", model: "Ranger" })),
    ).toEqual({
      vehicleId: "v-hilux",
      score: { total: 55, vehicle: 0, year: 25, budget: 30 },
      reasons: [
        MATCH_REASONS.yearInRange,
        MATCH_REASONS.priceWithinBudget,
        MATCH_REASONS.available,
      ],
    });
  });

  it("ordena el modelo buscado antes que otro con el mismo año y precio", () => {
    const matches = findMatchesForDemand(MODEL_ONLY, [
      vehicle({ id: "v-ranger", brand: "Ford", model: "Ranger" }),
      vehicle({ id: "v-hilux" }),
    ]);
    expect(
      matches.map(({ vehicleId, score }) => [vehicleId, score.total]),
    ).toEqual([
      ["v-hilux", 90],
      ["v-ranger", 55],
    ]);
  });
});

describe("descarte por marca distinta", () => {
  it("otra marca descalifica aunque año y precio coincidan", () => {
    expect(
      evaluateMatch(FULL_DEMAND, vehicle({ brand: "Nissan", model: "Hilux" })),
    ).toBeNull();
  });

  it("también cuando la demanda define solo la marca", () => {
    const demand = snapshot({
      desired_vehicle: { brand: "Toyota" },
      year_range: { min: 2020 },
      budget_max: usd("35000.00"),
    });
    expect(
      evaluateMatch(demand, vehicle({ brand: "Ford", model: "Ranger" })),
    ).toBeNull();
  });

  it("el evaluador lo marca como descalificado, no como sin dato", () => {
    expect(
      evaluateDesiredVehicle(
        { brand: "Toyota" },
        { brand: "Nissan", model: "Frontier" },
      ),
    ).toEqual({ status: "disqualified" });
  });

  it("findMatchesForDemand la deja afuera", () => {
    const matches = findMatchesForDemand(FULL_DEMAND, [
      vehicle({ id: "v-frontier", brand: "Nissan", model: "Frontier" }),
      vehicle({ id: "v-hilux" }),
    ]);
    expect(matches.map((match) => match.vehicleId)).toEqual(["v-hilux"]);
  });
});

describe("monedas distintas: sin FX (DEC-025 §5, DEC-030 §7)", () => {
  it("unidad en USD y presupuesto en PYG → no comparable: 0, sin razón de precio y sin descalificar", () => {
    const demand = snapshot({
      desired_vehicle: { brand: "Toyota", model: "Hilux" },
      year_range: { min: 2020, max: 2024 },
      budget_max: pyg("250000000.00"),
    });
    expect(evaluateMatch(demand, vehicle({ price: usd("30000.00") }))).toEqual({
      vehicleId: "v-hilux",
      score: { total: 70, vehicle: 45, year: 25, budget: 0 },
      reasons: [
        MATCH_REASONS.brandAndModel,
        MATCH_REASONS.yearInRange,
        MATCH_REASONS.available,
      ],
    });
  });

  it("unidad en PYG y presupuesto en USD → igual de no comparable", () => {
    const demand = snapshot({
      desired_vehicle: { brand: "Toyota", model: "Hilux" },
      budget_max: usd("35000.00"),
    });
    const result = evaluateMatch(
      demand,
      vehicle({ price: pyg("200000000.00") }),
    );
    expect(result?.score).toEqual({
      total: 45,
      vehicle: 45,
      year: 0,
      budget: 0,
    });
    expect(result?.reasons).not.toContain(MATCH_REASONS.priceWithinBudget);
    expect(result?.reasons).not.toContain(MATCH_REASONS.priceNearBudget);
  });

  it("no convierte: ningún monto en otra moneda entra ni se acerca al presupuesto", () => {
    for (const price of [usd("1.00"), usd("999999999999.99")]) {
      expect(evaluateBudget(pyg("250000000.00"), price)).toEqual({
        status: "unknown",
        points: 0,
        reason: null,
      });
    }
  });

  it("solo con señales no comparables no hay match, y no falla", () => {
    const demand = snapshot({
      year_range: { min: 2020 },
      budget_max: pyg("250000000.00"),
    });
    expect(() => evaluateMatch(demand, vehicle())).not.toThrow();
    expect(evaluateMatch(demand, vehicle())).toBeNull();
  });
});

describe("unidades no disponibles: descarte inmediato", () => {
  it.each(["inPreparation", "reserved", "sold"] as const)(
    "%s no hace match aunque coincida en todo",
    (status) => {
      expect(evaluateMatch(FULL_DEMAND, vehicle({ status }))).toBeNull();
    },
  );

  it("solo `available` participa, de todos los estados del inventario", () => {
    expect(
      VEHICLE_STATUSES.map(({ id }) => [
        id,
        evaluateMatch(FULL_DEMAND, vehicle({ status: id })) !== null,
      ]),
    ).toEqual([
      ["inPreparation", false],
      ["available", true],
      ["reserved", false],
      ["sold", false],
    ]);
  });

  it("findMatchesForDemand las deja afuera", () => {
    const matches = findMatchesForDemand(FULL_DEMAND, [
      vehicle({ id: "v-prep", status: "inPreparation" }),
      vehicle({ id: "v-sold", status: "sold" }),
      vehicle({ id: "v-reserved", status: "reserved" }),
      vehicle({ id: "v-available" }),
    ]);
    expect(matches.map((match) => match.vehicleId)).toEqual(["v-available"]);
  });

  it("todo match dice que la unidad está disponible", () => {
    expect(evaluateMatch(FULL_DEMAND, vehicle())?.reasons.at(-1)).toBe(
      "Unidad disponible en stock",
    );
  });
});

describe("ausencia honesta (DEC-005)", () => {
  it("DemandSnapshot vacío: ninguna unidad es match y nada falla", () => {
    const empty = snapshot();
    expect(evaluateMatch(empty, vehicle())).toBeNull();
    expect(
      findMatchesForDemand(empty, [
        vehicle({ id: "v-1" }),
        vehicle({ id: "v-2", price: null }),
      ]),
    ).toEqual([]);
  });

  it("vehículo buscado Unknown: no descalifica ni suma; año y precio alcanzan", () => {
    const demand = snapshot({
      year_range: { min: 2020, max: 2024 },
      budget_max: usd("35000.00"),
    });
    for (const brand of ["Toyota", "Nissan", "Ford"]) {
      expect(evaluateMatch(demand, vehicle({ brand }))).toEqual({
        vehicleId: "v-hilux",
        score: { total: 55, vehicle: 0, year: 25, budget: 30 },
        reasons: [
          MATCH_REASONS.yearInRange,
          MATCH_REASONS.priceWithinBudget,
          MATCH_REASONS.available,
        ],
      });
    }
  });

  it("unidad sin precio: 0 de presupuesto, sin razón de precio y sin descalificar", () => {
    expect(evaluateMatch(FULL_DEMAND, vehicle({ price: null }))).toEqual({
      vehicleId: "v-hilux",
      score: { total: 70, vehicle: 45, year: 25, budget: 0 },
      reasons: [
        MATCH_REASONS.brandAndModel,
        MATCH_REASONS.yearInRange,
        MATCH_REASONS.available,
      ],
    });
  });

  it("presupuesto Unknown con precio conocido: 0, sin penalizar", () => {
    const demand = snapshot({
      desired_vehicle: { brand: "Toyota", model: "Hilux" },
      year_range: { min: 2020, max: 2024 },
    });
    expect(evaluateMatch(demand, vehicle())?.score).toEqual({
      total: 70,
      vehicle: 45,
      year: 25,
      budget: 0,
    });
  });

  it("año Unknown en la demanda: 0, sin penalizar", () => {
    const demand = snapshot({
      desired_vehicle: { brand: "Toyota", model: "Hilux" },
      budget_max: usd("35000.00"),
    });
    expect(evaluateMatch(demand, vehicle({ year: 1995 }))?.score).toEqual({
      total: 75,
      vehicle: 45,
      year: 0,
      budget: 30,
    });
  });

  it("los facts que Match v0 no evalúa no cambian el puntaje", () => {
    const base = {
      desired_vehicle: { brand: "Toyota", model: "Hilux" },
      year_range: { min: 2020 },
    } satisfies DemandInput;
    const withExtras = snapshot({
      ...base,
      purchase_type: "financed",
      trade_in_intent: true,
      down_payment: usd("0.00"),
    });
    expect(evaluateMatch(withExtras, vehicle())).toEqual(
      evaluateMatch(snapshot(base), vehicle()),
    );
  });

  it("los evaluadores devuelven sin dato, no «no coincide»", () => {
    const unknown = { status: "unknown", points: 0, reason: null };
    expect(evaluateDesiredVehicle(null, vehicle())).toEqual(unknown);
    expect(evaluateYearRange(null, 2022)).toEqual(unknown);
    expect(evaluateYearRange({}, 2022)).toEqual(unknown);
    expect(evaluateBudget(null, usd("30000.00"))).toEqual(unknown);
    expect(evaluateBudget(usd("35000.00"), null)).toEqual(unknown);
  });
});

describe("year_range: extremos abiertos y bordes", () => {
  const inRange = {
    status: "match",
    points: 25,
    reason: "Año dentro del rango buscado",
  };
  const outOfRange = { status: "mismatch", points: 0, reason: null };

  it("solo mínimo (desde 2020): el máximo queda abierto", () => {
    expect(evaluateYearRange({ min: 2020 }, 2019)).toEqual(outOfRange);
    expect(evaluateYearRange({ min: 2020 }, 2020)).toEqual(inRange);
    expect(evaluateYearRange({ min: 2020 }, 2026)).toEqual(inRange);
    expect(evaluateYearRange({ min: 2020 }, 2100)).toEqual(inRange);
  });

  it("solo máximo (hasta 2018): el mínimo queda abierto", () => {
    expect(evaluateYearRange({ max: 2018 }, 1900)).toEqual(inRange);
    expect(evaluateYearRange({ max: 2018 }, 2018)).toEqual(inRange);
    expect(evaluateYearRange({ max: 2018 }, 2019)).toEqual(outOfRange);
  });

  it("rango cerrado: los dos extremos incluidos", () => {
    const range = { min: 2018, max: 2020 };
    expect(evaluateYearRange(range, 2017)).toEqual(outOfRange);
    expect(evaluateYearRange(range, 2018)).toEqual(inRange);
    expect(evaluateYearRange(range, 2019)).toEqual(inRange);
    expect(evaluateYearRange(range, 2020)).toEqual(inRange);
    expect(evaluateYearRange(range, 2021)).toEqual(outOfRange);
  });

  it("un solo año (min = max)", () => {
    expect(evaluateYearRange({ min: 2022, max: 2022 }, 2022)).toEqual(inRange);
    expect(evaluateYearRange({ min: 2022, max: 2022 }, 2023)).toEqual(
      outOfRange,
    );
  });

  it("fuera de rango no descalifica: marca, modelo y precio siguen sumando", () => {
    expect(evaluateMatch(FULL_DEMAND, vehicle({ year: 2015 }))).toEqual({
      vehicleId: "v-hilux",
      score: { total: 75, vehicle: 45, year: 0, budget: 30 },
      reasons: [
        MATCH_REASONS.brandAndModel,
        MATCH_REASONS.priceWithinBudget,
        MATCH_REASONS.available,
      ],
    });
  });

  it("con mínimo abierto en el motor", () => {
    const demand = snapshot({
      desired_vehicle: { brand: "Toyota", model: "Hilux" },
      year_range: { max: 2020 },
    });
    expect(evaluateMatch(demand, vehicle({ year: 2008 }))?.score.year).toBe(25);
    expect(evaluateMatch(demand, vehicle({ year: 2021 }))?.score.year).toBe(0);
  });

  it("con máximo abierto en el motor", () => {
    const demand = snapshot({
      desired_vehicle: { brand: "Toyota", model: "Hilux" },
      year_range: { min: 2020 },
    });
    expect(evaluateMatch(demand, vehicle({ year: 2026 }))?.score.year).toBe(25);
    expect(evaluateMatch(demand, vehicle({ year: 2019 }))?.score.year).toBe(0);
  });
});

describe("presupuesto: dentro, cercano y fuera", () => {
  const within = {
    status: "match",
    points: 30,
    reason: "Precio dentro del presupuesto",
  };
  const near = {
    status: "partial",
    points: 10,
    reason: "Precio cercano al presupuesto",
  };
  const over = { status: "mismatch", points: 0, reason: null };

  it("excede en menos del 10 % → cercano; en el 10 % exacto o más → 0", () => {
    const budget = usd("30000.00");
    expect(evaluateBudget(budget, usd("29999.99"))).toEqual(within);
    expect(evaluateBudget(budget, usd("30000.01"))).toEqual(near);
    expect(evaluateBudget(budget, usd("32999.99"))).toEqual(near);
    expect(evaluateBudget(budget, usd("33000.00"))).toEqual(over);
    expect(evaluateBudget(budget, usd("33000.01"))).toEqual(over);
    expect(evaluateBudget(budget, usd("90000.00"))).toEqual(over);
  });

  it("guaraníes: misma regla", () => {
    const budget = pyg("250000000.00");
    expect(evaluateBudget(budget, pyg("250000000.00"))).toEqual(within);
    expect(evaluateBudget(budget, pyg("274999999.00"))).toEqual(near);
    expect(evaluateBudget(budget, pyg("275000000.00"))).toEqual(over);
  });

  it("compara montos exactos, centavo a centavo", () => {
    expect(evaluateBudget(usd("29990.50"), usd("29990.50"))).toEqual(within);
    expect(evaluateBudget(usd("29990.50"), usd("29990.51"))).toEqual(near);
    expect(evaluateBudget(usd("29990.5"), usd("29990.50"))).toEqual(within);
  });

  it("sin pérdida de precisión con 12 dígitos enteros (numeric(14,2))", () => {
    const budget = usd("900000000000.00");
    expect(evaluateBudget(budget, usd("989999999999.99"))).toEqual(near);
    expect(evaluateBudget(budget, usd("990000000000.00"))).toEqual(over);
    expect(
      evaluateBudget(usd("999999999999.99"), usd("999999999999.99")),
    ).toEqual(within);
    expect(
      evaluateBudget(usd("999999999999.98"), usd("999999999999.99")),
    ).toEqual(near);
  });

  it("un monto mal formado es un dato corrupto: falla cerrado, sin exponer el valor", () => {
    for (const amount of ["", "-1.00", "1,5", "1.234", "abc", "1e5"]) {
      expect(() => evaluateBudget(usd("30000.00"), usd(amount))).toThrow(
        /^invalid money amount$/,
      );
    }
    expect(() =>
      evaluateBudget(usd("1000000000000.00"), usd("30000.00")),
    ).toThrow(/^invalid money amount$/);
  });
});

describe("findMatchesForDemand", () => {
  it("ordena de mayor a menor puntaje y deja afuera lo que no es match", () => {
    const matches = findMatchesForDemand(FULL_DEMAND, [
      // 45 + 25 = 70: sin precio.
      vehicle({ id: "v-no-price", price: null }),
      // 45 + 25 + 10 = 80: cercano al presupuesto.
      vehicle({ id: "v-near", price: usd("37000.00") }),
      // 100.
      vehicle({ id: "v-perfect" }),
      // 0 de vehículo + 25 + 30 = 55: misma marca, otro modelo.
      vehicle({ id: "v-corolla", model: "Corolla" }),
      // Otra marca: descalificada.
      vehicle({ id: "v-ranger", brand: "Ford", model: "Ranger" }),
      // Vendida.
      vehicle({ id: "v-sold", status: "sold" }),
      // 0 + 0 + 30 = 30 < 40.
      vehicle({ id: "v-old-corolla", model: "Corolla", year: 2010 }),
    ]);
    expect(
      matches.map(({ vehicleId, score }) => [vehicleId, score.total]),
    ).toEqual([
      ["v-perfect", 100],
      ["v-near", 80],
      ["v-no-price", 70],
      ["v-corolla", 55],
    ]);
  });

  it("un empate conserva el orden de entrada (determinista)", () => {
    const units = ["v-c", "v-a", "v-b"].map((id) => vehicle({ id }));
    expect(
      findMatchesForDemand(FULL_DEMAND, units).map((m) => m.vehicleId),
    ).toEqual(["v-c", "v-a", "v-b"]);
  });

  it("todo resultado alcanza el umbral y trae razones", () => {
    const matches = findMatchesForDemand(FULL_DEMAND, [
      vehicle({ id: "v-1" }),
      vehicle({ id: "v-2", price: usd("37000.00") }),
      vehicle({ id: "v-3", model: "Corolla", year: 2015 }),
    ]);
    expect(matches).not.toHaveLength(0);
    for (const match of matches) {
      expect(match.score.total).toBeGreaterThanOrEqual(MATCH_THRESHOLD);
      expect(match.score.total).toBe(
        match.score.vehicle + match.score.year + match.score.budget,
      );
      expect(match.reasons.length).toBeGreaterThan(0);
    }
  });

  it("sin unidades: lista vacía", () => {
    expect(findMatchesForDemand(FULL_DEMAND, [])).toEqual([]);
  });

  it("no modifica la lista recibida", () => {
    const units = [
      vehicle({ id: "v-low", price: null }),
      vehicle({ id: "v-high" }),
    ];
    const before = [...units];
    findMatchesForDemand(FULL_DEMAND, units);
    expect(units).toEqual(before);
  });

  it("aislamiento: unidades de más de una organización fallan cerrado", () => {
    expect(() =>
      findMatchesForDemand(FULL_DEMAND, [
        vehicle({ id: "v-a", organizationId: "org-a" }),
        vehicle({ id: "v-b", organizationId: "org-b" }),
      ]),
    ).toThrow(/more than one organization/);
  });

  it("aislamiento: también si la unidad de otra organización no sería match", () => {
    expect(() =>
      findMatchesForDemand(FULL_DEMAND, [
        vehicle({ id: "v-a", organizationId: "org-a" }),
        vehicle({ id: "v-b", organizationId: "org-b", status: "sold" }),
      ]),
    ).toThrow(/more than one organization/);
  });
});

describe("pureza del dominio match (DEC-016, DEC-031)", () => {
  const dir = fileURLToPath(
    new URL("../../../../domains/match/", import.meta.url),
  );
  const sources = readdirSync(dir).filter((file) => file.endsWith(".ts"));

  it("tiene los módulos del bloque", () => {
    expect(sources.sort()).toEqual([
      "engine.ts",
      "evaluators.ts",
      "index.ts",
      "presentation.ts",
      "types.ts",
    ]);
  });

  it.each(sources)(
    "%s solo importa del propio dominio o de domains/",
    (file) => {
      const code = readFileSync(`${dir}${file}`, "utf8");
      const specifiers = [...code.matchAll(/from\s+"([^"]+)"/g)].map(
        (match) => match[1],
      );
      for (const specifier of specifiers) {
        expect(specifier).toMatch(/^(\.\/|@\/domains\/)/);
      }
      expect(code).not.toMatch(/\bimport\s*\(/);
      expect(code).not.toMatch(/\brequire\s*\(/);
    },
  );
});
