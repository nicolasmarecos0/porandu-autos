import { describe, expect, it } from "vitest";

import { OPPORTUNITY_STAGES, type Stage } from "@/domains/opportunities/stages";
import {
  ACTIVE_TRADE_IN_STATUSES,
  canAcceptTradeIn,
  canTransitionTradeIn,
  decisionsFor,
  isActiveTradeInStatus,
  isTradeInDecisionId,
  isTradeInOpenStage,
  isTradeInStatus,
  normalizePlate,
  normalizeSingleLine,
  optimisticTradeInStatus,
  parseTradeInAppraisal,
  parseTradeInVehicle,
  planTradeInAppraisal,
  planTradeInDecision,
  planTradeInIntake,
  planTradeInRegistration,
  sameAppraisal,
  TRADE_IN_DECISION_IDS,
  TRADE_IN_DECISIONS,
  TRADE_IN_OPEN_STAGES,
  TRADE_IN_STATUS_LABELS,
  TRADE_IN_STATUSES,
  TRADE_IN_TRANSITIONS,
  tradeInIntakeCost,
  type TradeInAppraisal,
  type TradeInStatus,
  type TradeInTarget,
  type TradeInVehicleValues,
} from "@/domains/opportunities/trade-ins";

/*
 * Toma de usados y tasaciones (Hito 20, DEC-052): la matriz, las dos reglas
 * del fundador, la validación del usado y de la tasación, y los planes que
 * el servidor aplica sobre la fila bloqueada. La base espeja la matriz en
 * su trigger (tests/db/trade-ins.test.ts cruza los 16 pares).
 */

const APPRAISAL: TradeInAppraisal = {
  currency: "USD",
  estimatedRepairCost: "800.00",
  offerPrice: "8000.00",
};

function target(
  status: TradeInStatus,
  overrides: Partial<TradeInTarget> = {},
): TradeInTarget {
  return {
    status,
    opportunityStage: "negotiating",
    appraisal: status === "pending" ? null : APPRAISAL,
    ...overrides,
  };
}

describe("estados y matriz", () => {
  it("cuatro estados, con su copy del pedido del fundador", () => {
    expect(TRADE_IN_STATUSES).toEqual([
      "pending",
      "appraised",
      "accepted",
      "rejected",
    ]);
    expect(TRADE_IN_STATUS_LABELS).toEqual({
      pending: "Pendiente de tasación",
      appraised: "Tasado",
      accepted: "Aprobado por el cliente",
      rejected: "Rechazado",
    });
    expect(isTradeInStatus("appraised")).toBe(true);
    expect(isTradeInStatus("approved")).toBe(false);
    expect(isTradeInStatus(undefined)).toBe(false);
  });

  it("la matriz: tasar, retasar, aprobar y rechazar; sin saltos ni salida de rechazada", () => {
    expect(TRADE_IN_TRANSITIONS).toEqual({
      pending: ["appraised", "rejected"],
      appraised: ["appraised", "accepted", "rejected"],
      accepted: ["rejected"],
      rejected: [],
    });
    // No se acepta sin tasar ni se vuelve a pendiente.
    expect(canTransitionTradeIn("pending", "accepted")).toBe(false);
    expect(canTransitionTradeIn("appraised", "pending")).toBe(false);
    expect(canTransitionTradeIn("accepted", "appraised")).toBe(false);
    for (const to of TRADE_IN_STATUSES) {
      expect(canTransitionTradeIn("rejected", to)).toBe(false);
    }
    expect(canTransitionTradeIn("appraised", "appraised")).toBe(true);
  });

  it("vigentes: pendiente, tasada y aceptada; la rechazada es historial", () => {
    expect(ACTIVE_TRADE_IN_STATUSES).toEqual([
      "pending",
      "appraised",
      "accepted",
    ]);
    expect(TRADE_IN_STATUSES.filter(isActiveTradeInStatus)).toEqual(
      ACTIVE_TRADE_IN_STATUSES,
    );
  });

  it("la toma se registra y se decide con la oportunidad abierta", () => {
    expect(TRADE_IN_OPEN_STAGES).toEqual(["new", "qualifying", "negotiating"]);
    expect(OPPORTUNITY_STAGES.filter(isTradeInOpenStage)).toEqual(
      TRADE_IN_OPEN_STAGES,
    );
  });
});

describe("regla 1: no se acepta una toma sin precio de oferta", () => {
  it("sin tasación es offer_price_required", () => {
    expect(canAcceptTradeIn(null)).toEqual({
      ok: false,
      error: "offer_price_required",
    });
  });

  it("con tasación, el valor de toma con su moneda", () => {
    expect(canAcceptTradeIn(APPRAISAL)).toEqual({
      ok: true,
      offerPrice: { amount: "8000.00", currency: "USD" },
    });
  });

  it("un valor de toma de cero tampoco alcanza", () => {
    expect(
      canAcceptTradeIn({ ...APPRAISAL, offerPrice: "0.00" }),
    ).toMatchObject({ ok: false });
  });
});

describe("regla 2: costo total de ingreso = valor de toma + reacondicionamiento", () => {
  it.each([
    ["USD", "8000.00", "800.00", "8800.00"],
    ["USD", "7999.99", "0.01", "8000.00"],
    ["USD", "0.10", "0.20", "0.30"],
    ["USD", "8000.00", "0.00", "8000.00"],
    ["PYG", "50000000.00", "2500000.00", "52500000.00"],
    ["USD", "999999999999.99", "0.01", "1000000000000.00"],
  ] as const)(
    "%s %s + %s = %s, exacto (sin float)",
    (currency, offerPrice, estimatedRepairCost, total) => {
      expect(
        tradeInIntakeCost({ currency, offerPrice, estimatedRepairCost }),
      ).toEqual({ amount: total, currency });
    },
  );
});

describe("el usado: normalización y validación del alta", () => {
  const VALID: TradeInVehicleValues = {
    brand: "  Toyota ",
    model: "Vitz",
    version: "1.3   F",
    year: "2015",
    km: "98.000",
    plate: "abc-123",
  };

  it("normaliza textos y chapa", () => {
    expect(normalizeSingleLine(" Toyota\t\nVitz ")).toBe("Toyota Vitz");
    expect(normalizePlate("abc-123")).toBe("ABC 123");
    expect(normalizePlate("  aaab   123 ")).toBe("AAAB 123");
    expect(normalizePlate("ab.c/12_3")).toBe("AB C 12 3");
    // Lo que no es un separador queda, para que la validación lo rechace.
    expect(normalizePlate("ñan 123")).toBe("ÑAN 123");
  });

  it("un alta completa queda normalizada: km es-PY, chapa en mayúsculas", () => {
    expect(parseTradeInVehicle(VALID)).toEqual({
      ok: true,
      vehicle: {
        brand: "Toyota",
        model: "Vitz",
        version: "1.3 F",
        year: 2015,
        km: 98000,
        plate: "ABC 123",
      },
    });
  });

  it("versión, km y chapa son opcionales: vacíos son sin dato; 0 km es un dato", () => {
    expect(
      parseTradeInVehicle({ ...VALID, version: " ", km: "", plate: "" }),
    ).toEqual({
      ok: true,
      vehicle: {
        brand: "Toyota",
        model: "Vitz",
        version: null,
        year: 2015,
        km: null,
        plate: null,
      },
    });
    expect(parseTradeInVehicle({ ...VALID, km: "0" })).toMatchObject({
      ok: true,
      vehicle: { km: 0 },
    });
  });

  it.each([
    [{ brand: "" }, { brand: "required" }],
    [{ model: "   " }, { model: "required" }],
    [{ brand: "x".repeat(41) }, { brand: "too_long" }],
    [{ version: "x".repeat(81) }, { version: "too_long" }],
    [{ year: "" }, { year: "required" }],
    [{ year: "15" }, { year: "invalid_year" }],
    [{ year: "1899" }, { year: "invalid_year" }],
    [{ year: "2101" }, { year: "invalid_year" }],
    [{ year: "20a5" }, { year: "invalid_year" }],
    [{ km: "-1" }, { km: "invalid_km" }],
    [{ km: "98,5" }, { km: "invalid_km" }],
    [{ km: "98.00" }, { km: "invalid_km" }],
    [{ km: "9.999.999.999" }, { km: "invalid_km" }],
    [{ plate: "A" }, { plate: "invalid_plate" }],
    [{ plate: "ÑAN 123" }, { plate: "invalid_plate" }],
    [{ plate: "ÁBC 123" }, { plate: "invalid_plate" }],
    [{ plate: "ABCDEFG 12345" }, { plate: "invalid_plate" }],
  ] satisfies [Partial<TradeInVehicleValues>, object][])(
    "%o es inválido: %o",
    (overrides, errors) => {
      expect(parseTradeInVehicle({ ...VALID, ...overrides })).toEqual({
        ok: false,
        errors,
      });
    },
  );

  it("reporta el primer error de cada campo, todos a la vez", () => {
    expect(
      parseTradeInVehicle({
        brand: "",
        model: "",
        version: "",
        year: "abc",
        km: "x",
        plate: "!",
      }),
    ).toEqual({
      ok: false,
      errors: {
        brand: "required",
        model: "required",
        year: "invalid_year",
        km: "invalid_km",
        plate: "invalid_plate",
      },
    });
  });
});

describe("la tasación: validación", () => {
  it("USD con decimales es-PY y un arreglo de cero", () => {
    expect(
      parseTradeInAppraisal({
        currency: "USD",
        estimatedRepairCost: "0",
        offerPrice: "8.000,50",
      }),
    ).toEqual({
      ok: true,
      appraisal: {
        currency: "USD",
        estimatedRepairCost: "0.00",
        offerPrice: "8000.50",
      },
    });
  });

  it("PYG sin decimales", () => {
    expect(
      parseTradeInAppraisal({
        currency: "PYG",
        estimatedRepairCost: "2.500.000",
        offerPrice: "50.000.000",
      }),
    ).toEqual({
      ok: true,
      appraisal: {
        currency: "PYG",
        estimatedRepairCost: "2500000.00",
        offerPrice: "50000000.00",
      },
    });
    expect(
      parseTradeInAppraisal({
        currency: "PYG",
        estimatedRepairCost: "100,50",
        offerPrice: "50.000.000,50",
      }),
    ).toEqual({
      ok: false,
      errors: {
        offerPrice: "pyg_decimals",
        estimatedRepairCost: "pyg_decimals",
      },
    });
  });

  it.each([
    [{ currency: "" }, { currency: "required" }],
    [{ currency: "EUR" }, { currency: "invalid_option" }],
    [{ offerPrice: "" }, { offerPrice: "required" }],
    [{ offerPrice: "0" }, { offerPrice: "not_positive" }],
    [{ offerPrice: "8000.50" }, { offerPrice: "invalid_amount" }],
    [{ offerPrice: "-1" }, { offerPrice: "invalid_amount" }],
    [{ offerPrice: "1.000.000.000.000" }, { offerPrice: "invalid_amount" }],
    [{ estimatedRepairCost: "" }, { estimatedRepairCost: "required" }],
    [{ estimatedRepairCost: "1.5" }, { estimatedRepairCost: "invalid_amount" }],
  ])("%o es inválido: %o", (overrides, errors) => {
    expect(
      parseTradeInAppraisal({
        currency: "USD",
        estimatedRepairCost: "800",
        offerPrice: "8.000",
        ...overrides,
      }),
    ).toEqual({ ok: false, errors });
  });

  it("dos tasaciones son la misma si coinciden moneda y montos", () => {
    expect(sameAppraisal(APPRAISAL, { ...APPRAISAL })).toBe(true);
    expect(
      sameAppraisal(APPRAISAL, { ...APPRAISAL, offerPrice: "8500.00" }),
    ).toBe(false);
    expect(sameAppraisal(APPRAISAL, { ...APPRAISAL, currency: "PYG" })).toBe(
      false,
    );
  });
});

describe("decisiones con nombre", () => {
  it("cada decisión es un pase de la matriz y cada estado ofrece las suyas", () => {
    for (const id of TRADE_IN_DECISION_IDS) {
      const { from, to } = TRADE_IN_DECISIONS[id];
      expect(canTransitionTradeIn(from, to), id).toBe(true);
      expect(optimisticTradeInStatus(id)).toBe(to);
    }
    expect(decisionsFor("pending")).toEqual(["discard"]);
    expect(decisionsFor("appraised")).toEqual(["accept", "reject"]);
    expect(decisionsFor("accepted")).toEqual(["withdraw"]);
    expect(decisionsFor("rejected")).toEqual([]);
    expect(isTradeInDecisionId("accept")).toBe(true);
    expect(isTradeInDecisionId("approve")).toBe(false);
  });
});

describe("planes sobre la fila bloqueada", () => {
  it("registrar: oportunidad abierta y sin toma vigente", () => {
    expect(planTradeInRegistration("qualifying", null)).toEqual({
      kind: "register",
    });
    expect(planTradeInRegistration("won", null)).toEqual({
      kind: "opportunity_closed",
      stage: "won",
    });
    expect(planTradeInRegistration("negotiating", "appraised")).toEqual({
      kind: "already_registered",
      status: "appraised",
    });
  });

  describe("tasar", () => {
    const admin = { isAdmin: true };
    const NEW: TradeInAppraisal = { ...APPRAISAL, offerPrice: "8500.00" };

    it("un admin tasa una pendiente y retasa una tasada con otros valores", () => {
      expect(
        planTradeInAppraisal(target("pending"), "pending", NEW, admin),
      ).toEqual({ kind: "appraise", from: "pending", appraisal: NEW });
      expect(
        planTradeInAppraisal(target("appraised"), "appraised", NEW, admin),
      ).toEqual({ kind: "appraise", from: "appraised", appraisal: NEW });
    });

    it("la misma tasación no se reescribe", () => {
      expect(
        planTradeInAppraisal(
          target("appraised"),
          "appraised",
          APPRAISAL,
          admin,
        ),
      ).toEqual({ kind: "unchanged" });
    });

    it("un seller no tasa: es del admin (tasador o gerente)", () => {
      expect(
        planTradeInAppraisal(target("pending"), "pending", NEW, {
          isAdmin: false,
        }),
      ).toEqual({ kind: "requires_admin" });
    });

    it("compare-and-set: si otra persona ya la tasó o la decidió, es un conflicto", () => {
      expect(
        planTradeInAppraisal(target("appraised"), "pending", NEW, admin),
      ).toEqual({ kind: "conflict", current: "appraised" });
      for (const status of ["accepted", "rejected"] as const) {
        expect(
          planTradeInAppraisal(target(status), status, NEW, admin),
        ).toEqual({ kind: "conflict", current: status });
      }
    });

    it.each(["won", "lost"] as const)(
      "con la oportunidad %s no se tasa",
      (stage) => {
        expect(
          planTradeInAppraisal(
            target("pending", { opportunityStage: stage }),
            "pending",
            NEW,
            admin,
          ),
        ).toEqual({ kind: "opportunity_closed", stage });
      },
    );
  });

  describe("decidir", () => {
    const CASES: [TradeInStatus, string, object][] = [
      [
        "appraised",
        "accept",
        {
          kind: "change",
          decision: "accept",
          from: "appraised",
          to: "accepted",
        },
      ],
      ["pending", "accept", { kind: "offer_price_required" }],
      ["accepted", "accept", { kind: "unchanged", status: "accepted" }],
      ["rejected", "accept", { kind: "conflict", current: "rejected" }],
      [
        "appraised",
        "reject",
        {
          kind: "change",
          decision: "reject",
          from: "appraised",
          to: "rejected",
        },
      ],
      ["rejected", "reject", { kind: "unchanged", status: "rejected" }],
      ["accepted", "reject", { kind: "conflict", current: "accepted" }],
      ["pending", "reject", { kind: "conflict", current: "pending" }],
      [
        "pending",
        "discard",
        {
          kind: "change",
          decision: "discard",
          from: "pending",
          to: "rejected",
        },
      ],
      ["appraised", "discard", { kind: "conflict", current: "appraised" }],
      [
        "accepted",
        "withdraw",
        {
          kind: "change",
          decision: "withdraw",
          from: "accepted",
          to: "rejected",
        },
      ],
      ["appraised", "withdraw", { kind: "conflict", current: "appraised" }],
    ];

    it.each(CASES)("%s + %s → %o", (status, decision, plan) => {
      expect(
        planTradeInDecision(
          target(status),
          decision as (typeof TRADE_IN_DECISION_IDS)[number],
        ),
      ).toEqual(plan);
    });

    it("aceptar una tasada sin valor de toma (dato incompleto) tampoco pasa", () => {
      expect(
        planTradeInDecision(target("appraised", { appraisal: null }), "accept"),
      ).toEqual({ kind: "offer_price_required" });
    });

    it.each(OPPORTUNITY_STAGES.filter((stage) => !isTradeInOpenStage(stage)))(
      "con la oportunidad %s ninguna decisión pasa",
      (stage: Stage) => {
        for (const decision of TRADE_IN_DECISION_IDS) {
          expect(
            planTradeInDecision(
              target("appraised", { opportunityStage: stage }),
              decision,
            ),
          ).toEqual({ kind: "opportunity_closed", stage });
        }
      },
    );
  });

  describe("ingreso al stock con el cierre Ganada (la regla de oro)", () => {
    const ROW = {
      id: "40000000-0000-4000-8000-000000000001",
      status: "accepted" as TradeInStatus,
      convertedVehicleId: null,
      brand: "Toyota",
      model: "Vitz",
      version: "1.3 F",
      year: 2015,
      km: 98000,
    };

    it("una aceptada sin convertir entra al stock con los datos del usado", () => {
      expect(planTradeInIntake(ROW)).toEqual({
        kind: "intake",
        tradeInId: ROW.id,
        unit: {
          brand: "Toyota",
          model: "Vitz",
          version: "1.3 F",
          year: 2015,
          km: 98000,
        },
      });
    });

    it("sin toma, sin decidir, rechazada o ya convertida, no crea ninguna unidad", () => {
      expect(planTradeInIntake(null)).toEqual({ kind: "none" });
      for (const status of ["pending", "appraised", "rejected"] as const) {
        expect(planTradeInIntake({ ...ROW, status })).toEqual({ kind: "none" });
      }
      expect(
        planTradeInIntake({
          ...ROW,
          convertedVehicleId: "20000000-0000-4000-8000-000000000001",
        }),
      ).toEqual({ kind: "none" });
    });
  });
});
