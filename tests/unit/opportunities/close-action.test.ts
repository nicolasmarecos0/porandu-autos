import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { closeOpportunity } from "@/lib/opportunities/actions";

/*
 * Server Action closeOpportunity() (DEC-034), sin base de datos. Prueba el
 * orden de la cadena (requireTenant() → leer y validar el pedido →
 * escritura con ese mismo contexto → revalidar la cola y el detalle), qué
 * le llega a la escritura (solo el cierre validado, nunca organización,
 * usuario, etapa ni reloj del pedido) y qué responde ante cada resultado.
 * El planner sobre la fila bloqueada, RLS, los CHECKs de cierre, el trigger
 * y la concurrencia se prueban contra PostgreSQL en
 * tests/db/opportunity-closure.test.ts.
 */

vi.mock("server-only", () => ({}));

const mocks = vi.hoisted(() => ({
  calls: [] as string[],
  requireTenant: vi.fn(),
  close: vi.fn(),
  revalidatePath: vi.fn(),
}));

vi.mock("@/lib/tenant/session", () => ({
  requireTenant: mocks.requireTenant,
}));
vi.mock("@/db/queries/close-opportunity", () => ({
  closeOpportunityWithMetadata: mocks.close,
}));
vi.mock("@/db/queries/change-opportunity-stage", () => ({
  transitionOpportunityStage: vi.fn(),
}));
vi.mock("@/db/queries/link-opportunity-vehicle", () => ({
  setOpportunityVehicle: vi.fn(),
}));
vi.mock("@/db/queries/record-opportunity-note", () => ({
  insertOpportunityNote: vi.fn(),
}));
vi.mock("@/db/queries/create-opportunity", () => ({
  createOpportunityWithContact: vi.fn(),
}));
vi.mock("@/db/queries/demand-facts", () => ({
  recordDemandCapture: vi.fn(),
}));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));

const ORG = "00000000-0000-4000-8000-000000000001";
const OTHER_ORG = "00000000-0000-4000-8000-000000000002";
const CTX = Object.freeze({ organizationId: ORG, marker: "tenant-context" });
const ID = "10000000-0000-4000-8000-000000000101";

/** 23:30 del 11 de octubre en Asunción (UTC-3), ya 12 en UTC. */
const NOW = new Date("2026-10-12T02:30:00Z");

class RedirectSignal extends Error {}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  mocks.calls.length = 0;
  mocks.requireTenant.mockReset();
  mocks.requireTenant.mockImplementation(async () => {
    mocks.calls.push("requireTenant");
    return CTX;
  });
  mocks.close.mockReset();
  mocks.close.mockImplementation(async () => {
    mocks.calls.push("close");
    return {
      outcome: "closed",
      opportunityId: ID,
      from: "negotiating",
      to: "won",
    };
  });
  mocks.revalidatePath.mockReset();
  mocks.revalidatePath.mockImplementation(() => {
    mocks.calls.push("revalidatePath");
  });
});

afterEach(() => {
  vi.useRealTimers();
});

function form(fields: Record<string, string>): FormData {
  const data = new FormData();
  for (const [name, value] of Object.entries(fields)) data.append(name, value);
  return data;
}

const WON_FIELDS = {
  opportunityId: ID,
  outcome: "won",
  salePrice: "47.500",
  saleCurrency: "USD",
  paymentMethod: "financing",
  deliveryStatus: "delivered",
  deliveryDate: "2026-10-11",
} as const;

const LOST_FIELDS = {
  opportunityId: ID,
  outcome: "lost",
  lossReason: "competitor",
  lossNotes: "  Le ofrecieron   mejor tasación  ",
} as const;

const EMPTY_VALUES = {
  salePrice: "",
  saleCurrency: "",
  paymentMethod: "",
  deliveryStatus: "",
  deliveryDate: "",
  lossReason: "",
  lossNotes: "",
};

describe("closeOpportunity()", () => {
  it("ganar: requireTenant() → escritura con ese contexto y el cierre validado → revalidar la cola y el detalle", async () => {
    const state = await closeOpportunity(null, form(WON_FIELDS));

    expect(mocks.calls).toEqual([
      "requireTenant",
      "close",
      "revalidatePath",
      "revalidatePath",
    ]);
    expect(mocks.close).toHaveBeenCalledWith(CTX, {
      opportunityId: ID,
      closure: {
        outcome: "won",
        salePrice: { amount: "47500.00", currency: "USD" },
        paymentMethod: "financing",
        deliveryStatus: "delivered",
        deliveryDate: "2026-10-11",
      },
    });
    expect(mocks.revalidatePath.mock.calls).toEqual([
      ["/opportunities"],
      [`/opportunities/${ID}`],
    ]);
    expect(state).toEqual({
      status: "closed",
      opportunityId: ID,
      from: "negotiating",
      to: "won",
    });
  });

  it("perder: motivo y notas normalizadas llegan a la escritura", async () => {
    mocks.close.mockImplementation(async () => ({
      outcome: "closed",
      opportunityId: ID,
      from: "qualifying",
      to: "lost",
    }));
    const state = await closeOpportunity(null, form(LOST_FIELDS));
    expect(mocks.close).toHaveBeenCalledWith(CTX, {
      opportunityId: ID,
      closure: {
        outcome: "lost",
        lossReason: "competitor",
        lossNotes: "Le ofrecieron mejor tasación",
      },
    });
    expect(state).toMatchObject({ status: "closed", to: "lost" });
  });

  it("'hoy' es el día de Asunción del servidor: una entrega de mañana no está hecha", async () => {
    const state = await closeOpportunity(
      null,
      form({ ...WON_FIELDS, deliveryDate: "2026-10-12" }),
    );
    expect(state).toEqual({
      status: "invalid",
      outcome: "won",
      errors: { deliveryDate: "delivered_in_future" },
      values: {
        ...EMPTY_VALUES,
        salePrice: "47.500",
        saleCurrency: "USD",
        paymentMethod: "financing",
        deliveryStatus: "delivered",
        deliveryDate: "2026-10-12",
      },
    });
    expect(mocks.calls).toEqual(["requireTenant"]);
  });

  it("un pedido inválido vuelve con los errores por campo y lo cargado, sin llegar a la base", async () => {
    const state = await closeOpportunity(
      null,
      form({
        ...WON_FIELDS,
        salePrice: "1.000,50",
        saleCurrency: "PYG",
        paymentMethod: "",
        // Los campos de la pérdida no se miran ni vuelven.
        lossReason: "caro",
      }),
    );
    expect(state).toEqual({
      status: "invalid",
      outcome: "won",
      errors: { paymentMethod: "required", salePrice: "pyg_decimals" },
      values: {
        ...EMPTY_VALUES,
        salePrice: "1.000,50",
        saleCurrency: "PYG",
        paymentMethod: "",
        deliveryStatus: "delivered",
        deliveryDate: "2026-10-11",
      },
    });
    expect(mocks.close).not.toHaveBeenCalled();
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });

  it("perder sin motivo es invalid y no escribe", async () => {
    expect(
      await closeOpportunity(
        null,
        form({ opportunityId: ID, outcome: "lost" }),
      ),
    ).toMatchObject({
      status: "invalid",
      outcome: "lost",
      errors: { lossReason: "required" },
    });
    expect(mocks.close).not.toHaveBeenCalled();
  });

  it("el eco de lo cargado está acotado", async () => {
    const state = await closeOpportunity(
      null,
      form({ ...LOST_FIELDS, lossNotes: "x".repeat(10_000) }),
    );
    expect(state).toMatchObject({
      status: "invalid",
      errors: { lossNotes: "too_long" },
    });
    const values = (state as { values: Record<string, string> }).values;
    expect(values.lossNotes!.length).toBe(2000);
  });

  it("sin tenant (redirect) no lee el pedido ni escribe", async () => {
    mocks.requireTenant.mockImplementation(async () => {
      throw new RedirectSignal("/no-access");
    });
    await expect(closeOpportunity(null, form(WON_FIELDS))).rejects.toThrow(
      RedirectSignal,
    );
    expect(mocks.close).not.toHaveBeenCalled();
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });

  it("organización, usuario, etapa de origen, unidad y reloj del pedido no llegan a la escritura", async () => {
    await closeOpportunity(
      null,
      form({
        ...WON_FIELDS,
        organizationId: OTHER_ORG,
        organization_id: OTHER_ORG,
        from: "new",
        stage: "won",
        vehicleId: "20000000-0000-4000-8000-000000000999",
        updated_at: "2020-01-01",
        closedBy: "x",
        userId: "x",
      }),
    );
    expect(mocks.close).toHaveBeenCalledTimes(1);
    const [ctx, request] = mocks.close.mock.calls[0] as [
      unknown,
      { closure: Record<string, unknown> },
    ];
    expect(ctx).toBe(CTX);
    expect(Object.keys(request).sort()).toEqual(["closure", "opportunityId"]);
    expect(Object.keys(request.closure).sort()).toEqual([
      "deliveryDate",
      "deliveryStatus",
      "outcome",
      "paymentMethod",
      "salePrice",
    ]);
    expect(JSON.stringify(request)).not.toMatch(
      /000000000002|000000000999|2020|"new"/,
    );
  });

  it.each([
    ["sin id", { outcome: "won" }],
    ["un id que no es UUID", { opportunityId: "1", outcome: "won" }],
    [
      "una inyección en el id",
      { opportunityId: `${ID}' OR '1'='1`, outcome: "lost" },
    ],
  ])(
    "un pedido con %s es not_found y no llega a la base",
    async (_, fields) => {
      expect(await closeOpportunity(null, form(fields))).toEqual({
        status: "not_found",
      });
      expect(mocks.calls).toEqual(["requireTenant"]);
    },
  );

  it.each(["", "negotiating", "WON", "sold"])(
    "el resultado %j no es un cierre: invalid_outcome, sin llegar a la base",
    async (outcome) => {
      expect(
        await closeOpportunity(null, form({ ...WON_FIELDS, outcome })),
      ).toEqual({ status: "invalid_outcome" });
      expect(mocks.calls).toEqual(["requireTenant"]);
    },
  );

  it("unchanged no revalida: no cambió nada", async () => {
    mocks.close.mockImplementation(async () => ({
      outcome: "unchanged",
      opportunityId: ID,
      stage: "won",
    }));
    expect(await closeOpportunity(null, form(WON_FIELDS))).toEqual({
      status: "unchanged",
      opportunityId: ID,
      stage: "won",
    });
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });

  it("invalid_transition devuelve la etapa real y revalida para mostrarla", async () => {
    mocks.close.mockImplementation(async () => ({
      outcome: "invalid_transition",
      opportunityId: ID,
      current: "lost",
    }));
    expect(await closeOpportunity(null, form(WON_FIELDS))).toEqual({
      status: "invalid_transition",
      opportunityId: ID,
      current: "lost",
    });
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/opportunities");
    expect(mocks.revalidatePath).toHaveBeenCalledWith(`/opportunities/${ID}`);
  });

  it("vehicle_required revalida: la unidad pudo cambiar desde que se abrió el formulario", async () => {
    mocks.close.mockImplementation(async () => ({
      outcome: "vehicle_required",
      opportunityId: ID,
    }));
    expect(await closeOpportunity(null, form(WON_FIELDS))).toEqual({
      status: "vehicle_required",
      opportunityId: ID,
    });
    expect(mocks.revalidatePath).toHaveBeenCalledWith(`/opportunities/${ID}`);
  });

  it("una oportunidad inexistente o ajena es not_found", async () => {
    mocks.close.mockImplementation(async () => ({ outcome: "not_found" }));
    expect(await closeOpportunity(null, form(LOST_FIELDS))).toEqual({
      status: "not_found",
    });
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });

  it("el estado previo que manda el cliente no se usa", async () => {
    const forgedPrevious = {
      status: "closed",
      opportunityId: "x",
      from: "new",
      to: "won",
    } as const;
    expect(await closeOpportunity(forgedPrevious, form({}))).toEqual({
      status: "not_found",
    });
  });

  it("una falla al guardar no revalida ni expone detalles ni lo cargado", async () => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    mocks.close.mockImplementation(async () => {
      throw new Error(
        'Failed query: update "opportunities" … params: 47500.00,USD,Ramón',
        {
          cause: {
            code: "23514",
            constraint_name: "opportunities_won_closure_check",
            detail: "secreto",
          },
        },
      );
    });
    try {
      const state = await closeOpportunity(null, form(WON_FIELDS));
      expect(state).toMatchObject({
        status: "failed",
        outcome: "won",
        values: { salePrice: "47.500", saleCurrency: "USD" },
      });
      expect(mocks.revalidatePath).not.toHaveBeenCalled();
      expect(errors).toHaveBeenCalledWith("[opportunities] close failed", {
        name: "Error",
        code: "23514",
        constraint_name: "opportunities_won_closure_check",
      });
      expect(JSON.stringify(errors.mock.calls)).not.toMatch(
        /Ramón|secreto|Failed query|47500|47\.500/,
      );
    } finally {
      errors.mockRestore();
    }
  });
});
