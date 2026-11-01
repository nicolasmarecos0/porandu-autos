import { beforeEach, describe, expect, it, vi } from "vitest";

import { todayInAsuncion } from "@/domains/opportunities/closure";
import { addDays } from "@/domains/quotes/request";
import { changeQuoteStatus, createQuote } from "@/lib/quotes/actions";

/*
 * Server Actions de cotizaciones (Hito 10, DEC-042 §8), sin base de datos.
 * Prueban el orden de la cadena (requireTenant() → leer el pedido →
 * escritura con ese mismo contexto → revalidar el detalle), qué le llega a
 * la escritura (la validación de las condiciones contra la lista que lee
 * la escritura, y el rol de la membership para el plan) y cómo se traduce
 * cada resultado. RLS, los CHECKs, el trigger y el aislamiento se prueban
 * contra PostgreSQL en tests/db/quotes.test.ts.
 */

vi.mock("server-only", () => ({}));

const mocks = vi.hoisted(() => ({
  calls: [] as string[],
  requireTenant: vi.fn(),
  insertQuote: vi.fn(),
  updateQuoteStatus: vi.fn(),
  revalidatePath: vi.fn(),
}));

vi.mock("@/lib/tenant/session", () => ({
  requireTenant: mocks.requireTenant,
}));
vi.mock("@/db/queries/quotes-write", () => ({
  insertQuote: mocks.insertQuote,
  updateQuoteStatus: mocks.updateQuoteStatus,
}));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));

const ORG = "00000000-0000-4000-8000-000000000001";
const USER = "00000000-0000-4000-8000-00000000000a";
const OPPORTUNITY = "10000000-0000-4000-8000-000000000101";
const VEHICLE = "20000000-0000-4000-8000-000000000101";
const QUOTE = "30000000-0000-4000-8000-000000000101";

let role: "admin" | "seller" = "seller";

beforeEach(() => {
  role = "seller";
  mocks.calls.length = 0;
  mocks.requireTenant.mockReset();
  mocks.requireTenant.mockImplementation(async () => {
    mocks.calls.push("requireTenant");
    return Object.freeze({ organizationId: ORG, userId: USER, role });
  });
  mocks.insertQuote.mockReset();
  mocks.updateQuoteStatus.mockReset();
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

const CREATE = {
  opportunityId: OPPORTUNITY,
  vehicleId: VEHICLE,
  discountKind: "percent",
  discountValue: "7,5",
  validUntil: addDays(todayInAsuncion(new Date()), 7),
  notes: "",
};

describe("createQuote()", () => {
  it("requireTenant() → escritura con ese contexto → revalidar el detalle", async () => {
    mocks.insertQuote.mockImplementation(async () => {
      mocks.calls.push("insert");
      return { outcome: "created", quoteId: QUOTE, number: 7 };
    });

    const state = await createQuote(null, form(CREATE));

    expect(state).toEqual({ status: "created", quoteId: QUOTE, number: 7 });
    expect(mocks.calls).toEqual([
      "requireTenant",
      "insert",
      `revalidate /opportunities/${OPPORTUNITY}`,
    ]);
    const [ctx, request] = mocks.insertQuote.mock.calls[0]!;
    expect(ctx).toMatchObject({ organizationId: ORG, userId: USER });
    expect(request).toEqual({
      opportunityId: OPPORTUNITY,
      vehicleId: VEHICLE,
    });
  });

  it("valida las condiciones contra la lista que lee la escritura", async () => {
    let parsed: unknown;
    mocks.insertQuote.mockImplementation(
      async (
        _ctx: unknown,
        _request: unknown,
        terms: (list: unknown) => unknown,
      ) => {
        parsed = terms({ amount: "50000.00", currency: "USD" });
        return { outcome: "created", quoteId: QUOTE, number: 1 };
      },
    );

    await createQuote(
      null,
      form({ ...CREATE, discountKind: "amount", discountValue: "1.000" }),
    );

    expect(parsed).toMatchObject({
      ok: true,
      terms: { discount: { kind: "amount", value: "1000.00" } },
    });
  });

  it("un descuento inválido contra esa lista vuelve con el error por campo y lo cargado", async () => {
    mocks.insertQuote.mockImplementation(
      async (
        _ctx: unknown,
        _request: unknown,
        terms: (list: unknown) => unknown,
      ) => ({
        outcome: "invalid",
        parsed: terms({ amount: "50000.00", currency: "USD" }),
      }),
    );

    const state = await createQuote(
      null,
      form({ ...CREATE, discountValue: "45" }),
    );

    expect(state).toEqual({
      status: "invalid",
      errors: { discountValue: "too_large" },
      values: { ...CREATE, discountValue: "45" },
    });
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });

  it("una unidad que no es UUID no llega a la base", async () => {
    const state = await createQuote(null, form({ ...CREATE, vehicleId: "x" }));

    expect(state).toMatchObject({
      status: "invalid",
      errors: { vehicleId: "required" },
    });
    expect(mocks.insertQuote).not.toHaveBeenCalled();
  });

  it("una oportunidad que no es UUID es opportunity_unavailable, sin escribir", async () => {
    const state = await createQuote(
      null,
      form({ ...CREATE, opportunityId: "nope" }),
    );

    expect(state).toMatchObject({ status: "opportunity_unavailable" });
    expect(mocks.insertQuote).not.toHaveBeenCalled();
  });

  it.each([
    ["vehicle_unavailable", { vehicleId: "unavailable" }],
    ["vehicle_without_price", { vehicleId: "without_price" }],
  ] as const)(
    "%s se informa en el campo de la unidad",
    async (outcome, errors) => {
      mocks.insertQuote.mockResolvedValue({ outcome });

      const state = await createQuote(null, form(CREATE));

      expect(state).toEqual({ status: "invalid", errors, values: CREATE });
    },
  );

  it("un pedido con organización, autor o lista de más no los usa", async () => {
    mocks.insertQuote.mockResolvedValue({
      outcome: "created",
      quoteId: QUOTE,
      number: 1,
    });

    await createQuote(
      null,
      form({
        ...CREATE,
        organizationId: "00000000-0000-4000-8000-000000000002",
        createdBy: "00000000-0000-4000-8000-00000000000b",
        listPrice: "1",
        status: "accepted",
      }),
    );

    const [ctx, request] = mocks.insertQuote.mock.calls[0]!;
    expect(ctx).toMatchObject({ organizationId: ORG, userId: USER });
    expect(request).toEqual({ opportunityId: OPPORTUNITY, vehicleId: VEHICLE });
  });

  it("una falla inesperada no revalida ni expone detalles", async () => {
    mocks.insertQuote.mockRejectedValue(new Error("boom"));

    const state = await createQuote(null, form(CREATE));

    expect(state).toEqual({ status: "failed", values: CREATE });
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });
});

const CHANGE = { quoteId: QUOTE, from: "draft", to: "approved" };

describe("changeQuoteStatus()", () => {
  it("planea con el rol de la membership y revalida el detalle de la oportunidad", async () => {
    let decisions: unknown[] = [];
    mocks.updateQuoteStatus.mockImplementation(
      async (
        _ctx: unknown,
        _request: unknown,
        plan: (locked: unknown) => unknown,
      ) => {
        mocks.calls.push("update");
        const locked = {
          status: "draft",
          validUntil: "2099-01-01",
          opportunityStage: "negotiating",
          vehicleStatus: "available",
          requiresAdmin: true,
        };
        decisions = [plan(locked)];
        return {
          outcome: "changed",
          status: "approved",
          opportunityId: OPPORTUNITY,
        };
      },
    );

    const state = await changeQuoteStatus(null, form(CHANGE));

    // Seller con un descuento sobre el 10 %: el dominio lo frena.
    expect(decisions).toEqual(["requires_admin"]);
    expect(state).toEqual({
      status: "changed",
      quoteId: QUOTE,
      to: "approved",
    });
    expect(mocks.calls).toEqual([
      "requireTenant",
      "update",
      `revalidate /opportunities/${OPPORTUNITY}`,
    ]);
    expect(mocks.updateQuoteStatus.mock.calls[0]![1]).toEqual({
      quoteId: QUOTE,
      from: "draft",
      to: "approved",
    });
  });

  it("un admin sí aprueba ese descuento", async () => {
    role = "admin";
    let decision: unknown;
    mocks.updateQuoteStatus.mockImplementation(
      async (
        _ctx: unknown,
        _request: unknown,
        plan: (locked: unknown) => unknown,
      ) => {
        decision = plan({
          status: "draft",
          validUntil: "2099-01-01",
          opportunityStage: "negotiating",
          vehicleStatus: "available",
          requiresAdmin: true,
        });
        return { outcome: "not_found" };
      },
    );

    await changeQuoteStatus(null, form(CHANGE));

    expect(decision).toBe("ok");
  });

  it.each([
    "invalid_transition",
    "expired",
    "opportunity_closed",
    "vehicle_unavailable",
    "requires_admin",
  ] as const)("%s se informa sin revalidar", async (outcome) => {
    mocks.updateQuoteStatus.mockResolvedValue({
      outcome,
      opportunityId: OPPORTUNITY,
    });

    expect(await changeQuoteStatus(null, form(CHANGE))).toEqual({
      status: outcome,
    });
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });

  it("unchanged devuelve el estado real y revalida", async () => {
    mocks.updateQuoteStatus.mockResolvedValue({
      outcome: "unchanged",
      current: "withdrawn",
      opportunityId: OPPORTUNITY,
    });

    expect(await changeQuoteStatus(null, form(CHANGE))).toEqual({
      status: "unchanged",
      quoteId: QUOTE,
      current: "withdrawn",
    });
    expect(mocks.revalidatePath).toHaveBeenCalledWith(
      `/opportunities/${OPPORTUNITY}`,
    );
  });

  it("un pedido inválido es not_found sin llegar a la base", async () => {
    for (const fields of [
      { ...CHANGE, quoteId: "x" },
      { ...CHANGE, from: "pending" },
      { ...CHANGE, to: "closed" },
    ]) {
      expect(await changeQuoteStatus(null, form(fields))).toEqual({
        status: "not_found",
      });
    }
    expect(mocks.updateQuoteStatus).not.toHaveBeenCalled();
  });

  it("una falla inesperada es failed", async () => {
    mocks.updateQuoteStatus.mockRejectedValue(new Error("boom"));

    expect(await changeQuoteStatus(null, form(CHANGE))).toEqual({
      status: "failed",
    });
  });
});
