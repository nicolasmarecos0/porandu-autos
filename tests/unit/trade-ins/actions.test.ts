import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  appraiseTradeIn,
  changeTradeInStatus,
  registerTradeIn,
} from "@/lib/trade-ins/actions";

/*
 * Server Actions de la toma de usados (Hito 20, DEC-052 §3), sin base de
 * datos. Prueban el orden de la cadena (requireTenant() → leer y validar el
 * pedido → escritura con ese mismo contexto → revalidar el detalle y el
 * embudo), qué le llega a la escritura (el usado y la tasación ya
 * validados, y el rol de la membership para el plan) y cómo se traduce cada
 * resultado. RLS, los CHECKs, el trigger y el aislamiento se prueban contra
 * PostgreSQL en tests/db/trade-ins.test.ts.
 */

vi.mock("server-only", () => ({}));

const mocks = vi.hoisted(() => ({
  calls: [] as string[],
  requireTenant: vi.fn(),
  insertTradeIn: vi.fn(),
  writeTradeInAppraisal: vi.fn(),
  writeTradeInDecision: vi.fn(),
  revalidatePath: vi.fn(),
}));

vi.mock("@/lib/tenant/session", () => ({
  requireTenant: mocks.requireTenant,
}));
vi.mock("@/db/queries/trade-ins-write", () => ({
  insertTradeIn: mocks.insertTradeIn,
  writeTradeInAppraisal: mocks.writeTradeInAppraisal,
  writeTradeInDecision: mocks.writeTradeInDecision,
}));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));

const ORG = "00000000-0000-4000-8000-000000000001";
const USER = "00000000-0000-4000-8000-00000000000a";
const OPPORTUNITY = "10000000-0000-4000-8000-000000000101";
const TRADE_IN = "40000000-0000-4000-8000-000000000101";
const VITZ = { brand: "Toyota", model: "Vitz", year: 2015 } as const;

let role: "admin" | "seller" = "seller";

beforeEach(() => {
  role = "seller";
  mocks.calls.length = 0;
  mocks.requireTenant.mockReset();
  mocks.requireTenant.mockImplementation(async () => {
    mocks.calls.push("requireTenant");
    return Object.freeze({ organizationId: ORG, userId: USER, role });
  });
  mocks.insertTradeIn.mockReset();
  mocks.writeTradeInAppraisal.mockReset();
  mocks.writeTradeInDecision.mockReset();
  mocks.revalidatePath.mockReset();
  mocks.revalidatePath.mockImplementation((path: string) => {
    mocks.calls.push(`revalidate ${path}`);
  });
  vi.spyOn(console, "error").mockImplementation(() => {});
});

function form(fields: Record<string, string>): FormData {
  const data = new FormData();
  for (const [name, value] of Object.entries(fields)) data.append(name, value);
  return data;
}

const REGISTER = {
  opportunityId: OPPORTUNITY,
  brand: "Toyota",
  model: "Vitz",
  version: "1.3 F",
  year: "2015",
  km: "98.000",
  plate: "abc-123",
};

const REVALIDATED = [
  `revalidate /opportunities/${OPPORTUNITY}`,
  "revalidate /opportunities/pipeline",
];

describe("registerTradeIn()", () => {
  it("requireTenant() → el usado validado → escritura con ese contexto → revalidar", async () => {
    mocks.insertTradeIn.mockImplementation(async () => {
      mocks.calls.push("insert");
      return {
        outcome: "registered",
        tradeInId: TRADE_IN,
        opportunityId: OPPORTUNITY,
        status: "pending",
      };
    });

    const state = await registerTradeIn(null, form(REGISTER));

    expect(state).toEqual({
      status: "registered",
      tradeInId: TRADE_IN,
      appraised: false,
      label: "Toyota Vitz 2015",
    });
    expect(mocks.calls).toEqual(["requireTenant", "insert", ...REVALIDATED]);
    const [ctx, request, actor] = mocks.insertTradeIn.mock.calls[0]!;
    expect(ctx).toMatchObject({ organizationId: ORG, userId: USER });
    expect(request).toEqual({
      opportunityId: OPPORTUNITY,
      vehicle: {
        brand: "Toyota",
        model: "Vitz",
        version: "1.3 F",
        year: 2015,
        km: 98000,
        plate: "ABC 123",
      },
      appraisal: null,
    });
    expect(actor).toEqual({ isAdmin: false });
  });

  it("un admin registra y tasa en el mismo pedido; organización, estado y autor del pedido se ignoran", async () => {
    role = "admin";
    mocks.insertTradeIn.mockResolvedValue({
      outcome: "registered",
      tradeInId: TRADE_IN,
      opportunityId: OPPORTUNITY,
      status: "appraised",
    });

    const state = await registerTradeIn(
      null,
      form({
        ...REGISTER,
        currency: "USD",
        estimatedRepairCost: "800",
        offerPrice: "8.000",
        status: "accepted",
        organizationId: "00000000-0000-4000-8000-000000000002",
        createdBy: "00000000-0000-4000-8000-00000000000b",
        convertedVehicleId: "20000000-0000-4000-8000-000000000001",
      }),
    );

    expect(state).toMatchObject({ status: "registered", appraised: true });
    const [, request, actor] = mocks.insertTradeIn.mock.calls[0]!;
    expect(request.appraisal).toEqual({
      currency: "USD",
      estimatedRepairCost: "800.00",
      offerPrice: "8000.00",
    });
    expect(Object.keys(request)).toEqual([
      "opportunityId",
      "vehicle",
      "appraisal",
    ]);
    expect(actor).toEqual({ isAdmin: true });
  });

  it("un usado inválido vuelve con los errores y lo cargado, sin llegar a la base", async () => {
    const state = await registerTradeIn(
      null,
      form({ ...REGISTER, brand: "", year: "15", plate: "Ñ" }),
    );
    expect(state).toEqual({
      status: "invalid",
      errors: {
        brand: "required",
        year: "invalid_year",
        plate: "invalid_plate",
      },
      values: {
        brand: "",
        model: "Vitz",
        version: "1.3 F",
        year: "15",
        km: "98.000",
        plate: "Ñ",
        currency: "",
        estimatedRepairCost: "",
        offerPrice: "",
      },
    });
    expect(mocks.insertTradeIn).not.toHaveBeenCalled();
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });

  it("una tasación cargada a medias se valida entera", async () => {
    role = "admin";
    const state = await registerTradeIn(
      null,
      form({ ...REGISTER, offerPrice: "8.000" }),
    );
    expect(state).toMatchObject({
      status: "invalid",
      errors: { currency: "required", estimatedRepairCost: "required" },
    });
    expect(mocks.insertTradeIn).not.toHaveBeenCalled();
  });

  it("un id malformado es not_found sin llegar a la base", async () => {
    expect(
      await registerTradeIn(null, form({ ...REGISTER, opportunityId: "x" })),
    ).toEqual({ status: "not_found" });
    expect(mocks.insertTradeIn).not.toHaveBeenCalled();
  });

  it.each([
    ["opportunity_closed", true],
    ["already_registered", true],
    ["requires_admin", false],
  ] as const)(
    "%s vuelve con lo cargado (revalida: %s)",
    async (outcome, revalidates) => {
      mocks.insertTradeIn.mockResolvedValue({
        outcome,
        opportunityId: OPPORTUNITY,
      });
      const state = await registerTradeIn(null, form(REGISTER));
      expect(state).toMatchObject({
        status: outcome,
        values: { brand: "Toyota" },
      });
      expect(mocks.revalidatePath).toHaveBeenCalledTimes(revalidates ? 2 : 0);
    },
  );

  it("una falla inesperada no expone la base ni registra lo cargado", async () => {
    mocks.insertTradeIn.mockRejectedValue(
      Object.assign(new Error("Failed query: insert … ABC 123"), {
        cause: { code: "XX000", constraint_name: undefined },
      }),
    );
    const state = await registerTradeIn(null, form(REGISTER));
    expect(state).toMatchObject({
      status: "failed",
      values: { plate: "abc-123" },
    });
    const logged = JSON.stringify(vi.mocked(console.error).mock.calls);
    expect(logged).not.toContain("ABC 123");
    expect(logged).not.toContain("Vitz");
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });
});

const APPRAISE = {
  tradeInId: TRADE_IN,
  from: "pending",
  currency: "PYG",
  estimatedRepairCost: "2.500.000",
  offerPrice: "50.000.000",
};

describe("appraiseTradeIn()", () => {
  it("requireTenant() → la tasación validada y el rol → escritura → revalidar", async () => {
    role = "admin";
    mocks.writeTradeInAppraisal.mockImplementation(async () => {
      mocks.calls.push("appraise");
      return {
        outcome: "appraised",
        opportunityId: OPPORTUNITY,
        identity: VITZ,
        from: "pending",
        offerPrice: { amount: "50000000.00", currency: "PYG" },
      };
    });

    const state = await appraiseTradeIn(null, form(APPRAISE));

    expect(state).toEqual({
      status: "appraised",
      label: "Toyota Vitz 2015",
      offerPriceLabel: "Gs. 50.000.000",
    });
    expect(mocks.calls).toEqual(["requireTenant", "appraise", ...REVALIDATED]);
    const [, request, actor] = mocks.writeTradeInAppraisal.mock.calls[0]!;
    expect(request).toEqual({
      tradeInId: TRADE_IN,
      seen: "pending",
      appraisal: {
        currency: "PYG",
        estimatedRepairCost: "2500000.00",
        offerPrice: "50000000.00",
      },
    });
    expect(actor).toEqual({ isAdmin: true });
  });

  it("un seller llega con su rol: la escritura y la base lo rechazan", async () => {
    mocks.writeTradeInAppraisal.mockResolvedValue({
      outcome: "requires_admin",
      opportunityId: OPPORTUNITY,
    });
    expect(await appraiseTradeIn(null, form(APPRAISE))).toEqual({
      status: "requires_admin",
    });
    expect(mocks.writeTradeInAppraisal.mock.calls[0]![2]).toEqual({
      isAdmin: false,
    });
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });

  it("PYG con decimales es inválido, sin llegar a la base", async () => {
    role = "admin";
    expect(
      await appraiseTradeIn(
        null,
        form({ ...APPRAISE, offerPrice: "50.000.000,50" }),
      ),
    ).toMatchObject({
      status: "invalid",
      errors: { offerPrice: "pyg_decimals" },
    });
    expect(mocks.writeTradeInAppraisal).not.toHaveBeenCalled();
  });

  it("un estado de origen desconocido o un id malformado es not_found", async () => {
    for (const fields of [
      { ...APPRAISE, from: "approved" },
      { ...APPRAISE, tradeInId: "x" },
    ]) {
      expect(await appraiseTradeIn(null, form(fields))).toEqual({
        status: "not_found",
      });
    }
    expect(mocks.writeTradeInAppraisal).not.toHaveBeenCalled();
  });

  it("conflict revalida para mostrar lo que dejó otra persona", async () => {
    role = "admin";
    mocks.writeTradeInAppraisal.mockResolvedValue({
      outcome: "conflict",
      opportunityId: OPPORTUNITY,
      identity: VITZ,
      current: "accepted",
    });
    expect(await appraiseTradeIn(null, form(APPRAISE))).toEqual({
      status: "conflict",
      current: "accepted",
      label: "Toyota Vitz 2015",
    });
    expect(mocks.calls.slice(-2)).toEqual(REVALIDATED);
  });
});

describe("changeTradeInStatus()", () => {
  it("requireTenant() → la decisión → escritura → revalidar", async () => {
    mocks.writeTradeInDecision.mockImplementation(async () => {
      mocks.calls.push("decide");
      return {
        outcome: "changed",
        opportunityId: OPPORTUNITY,
        identity: VITZ,
        decision: "accept",
        from: "appraised",
        to: "accepted",
      };
    });

    const state = await changeTradeInStatus(
      null,
      form({ tradeInId: TRADE_IN, decision: "accept", status: "rejected" }),
    );

    expect(state).toEqual({
      status: "changed",
      decision: "accept",
      to: "accepted",
      label: "Toyota Vitz 2015",
    });
    expect(mocks.calls).toEqual(["requireTenant", "decide", ...REVALIDATED]);
    expect(mocks.writeTradeInDecision.mock.calls[0]![1]).toEqual({
      tradeInId: TRADE_IN,
      decision: "accept",
    });
  });

  it("una decisión desconocida es not_found, sin llegar a la base", async () => {
    for (const decision of ["", "approve", "accepted", "ACCEPT"]) {
      expect(
        await changeTradeInStatus(
          null,
          form({ tradeInId: TRADE_IN, decision }),
        ),
      ).toEqual({ status: "not_found" });
    }
    expect(mocks.writeTradeInDecision).not.toHaveBeenCalled();
  });

  it.each([
    [
      { outcome: "offer_price_required", opportunityId: OPPORTUNITY },
      { status: "offer_price_required" },
      0,
    ],
    [
      { outcome: "opportunity_closed", opportunityId: OPPORTUNITY },
      { status: "opportunity_closed" },
      2,
    ],
    [
      {
        outcome: "conflict",
        opportunityId: OPPORTUNITY,
        identity: VITZ,
        current: "rejected",
      },
      { status: "conflict", current: "rejected", label: "Toyota Vitz 2015" },
      2,
    ],
    [{ outcome: "not_found" }, { status: "not_found" }, 0],
  ] as const)("%o → %o", async (outcome, state, revalidations) => {
    mocks.writeTradeInDecision.mockResolvedValue(outcome);
    expect(
      await changeTradeInStatus(
        null,
        form({ tradeInId: TRADE_IN, decision: "accept" }),
      ),
    ).toEqual(state);
    expect(mocks.revalidatePath).toHaveBeenCalledTimes(revalidations);
  });

  it("una falla inesperada es failed y no revalida", async () => {
    mocks.writeTradeInDecision.mockRejectedValue(new Error("boom"));
    expect(
      await changeTradeInStatus(
        null,
        form({ tradeInId: TRADE_IN, decision: "reject" }),
      ),
    ).toEqual({ status: "failed" });
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });
});
