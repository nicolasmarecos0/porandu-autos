import { beforeEach, describe, expect, it, vi } from "vitest";

import { changeOpportunityStage } from "@/lib/opportunities/actions";

/*
 * Server Action changeOpportunityStage() (H1.6, DEC-032), sin base de datos.
 * Prueba el orden de la cadena (requireTenant() → leer el pedido → transición
 * con ese mismo contexto → revalidar) y qué le llega a la escritura. La
 * máquina de estados real, RLS, el trigger y la concurrencia se prueban
 * contra PostgreSQL en tests/db/opportunity-stages.test.ts.
 */

vi.mock("server-only", () => ({}));

const mocks = vi.hoisted(() => ({
  calls: [] as string[],
  requireTenant: vi.fn(),
  transition: vi.fn(),
  revalidatePath: vi.fn(),
}));

vi.mock("@/lib/tenant/session", () => ({
  requireTenant: mocks.requireTenant,
}));
vi.mock("@/db/queries/change-opportunity-stage", () => ({
  transitionOpportunityStage: mocks.transition,
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

class RedirectSignal extends Error {}

beforeEach(() => {
  mocks.calls.length = 0;
  mocks.requireTenant.mockReset();
  mocks.requireTenant.mockImplementation(async () => {
    mocks.calls.push("requireTenant");
    return CTX;
  });
  mocks.transition.mockReset();
  mocks.transition.mockImplementation(async () => {
    mocks.calls.push("transition");
    return {
      outcome: "changed",
      opportunityId: ID,
      from: "new",
      to: "qualifying",
    };
  });
  mocks.revalidatePath.mockReset();
  mocks.revalidatePath.mockImplementation(() => {
    mocks.calls.push("revalidatePath");
  });
});

function form(fields: Record<string, string>): FormData {
  const data = new FormData();
  for (const [name, value] of Object.entries(fields)) data.append(name, value);
  return data;
}

describe("changeOpportunityStage()", () => {
  it("requireTenant() → transición con ese contexto → revalidar la cola y el detalle", async () => {
    const state = await changeOpportunityStage(
      null,
      form({ opportunityId: ID, stage: "qualifying" }),
    );

    expect(mocks.calls).toEqual([
      "requireTenant",
      "transition",
      "revalidatePath",
      "revalidatePath",
    ]);
    expect(mocks.transition).toHaveBeenCalledWith(CTX, {
      opportunityId: ID,
      to: "qualifying",
    });
    expect(mocks.revalidatePath.mock.calls).toEqual([
      ["/opportunities"],
      [`/opportunities/${ID}`],
    ]);
    expect(state).toEqual({
      status: "changed",
      opportunityId: ID,
      from: "new",
      to: "qualifying",
    });
  });

  it("un cierre no se escribe acá: closure_required, sin revalidar (DEC-034 §1)", async () => {
    mocks.transition.mockImplementation(async () => ({
      outcome: "closure_required",
      opportunityId: ID,
      current: "negotiating",
    }));
    const state = await changeOpportunityStage(
      null,
      form({ opportunityId: ID, stage: "lost", lossReason: "price" }),
    );
    // El motivo no viaja: no tiene adónde ir.
    expect(mocks.transition).toHaveBeenCalledWith(CTX, {
      opportunityId: ID,
      to: "lost",
    });
    expect(state).toEqual({
      status: "closure_required",
      opportunityId: ID,
      current: "negotiating",
    });
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });

  it("sin tenant (redirect) no lee el pedido ni escribe", async () => {
    mocks.requireTenant.mockImplementation(async () => {
      throw new RedirectSignal("/no-access");
    });
    await expect(
      changeOpportunityStage(null, form({ opportunityId: ID, stage: "won" })),
    ).rejects.toThrow(RedirectSignal);
    expect(mocks.transition).not.toHaveBeenCalled();
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });

  it("organización, usuario, etapa de origen y reloj del pedido no llegan a la escritura", async () => {
    await changeOpportunityStage(
      null,
      form({
        opportunityId: ID,
        stage: "qualifying",
        organizationId: OTHER_ORG,
        organization_id: OTHER_ORG,
        from: "negotiating",
        updated_at: "2020-01-01",
        userId: "x",
        lossReason: "price",
      }),
    );
    expect(mocks.transition).toHaveBeenCalledTimes(1);
    const [ctx, request] = mocks.transition.mock.calls[0] as [
      unknown,
      Record<string, unknown>,
    ];
    expect(ctx).toBe(CTX);
    expect(Object.keys(request).sort()).toEqual(["opportunityId", "to"]);
    expect(JSON.stringify(request)).not.toMatch(
      /000000000002|negotiating|2020|price/,
    );
  });

  it.each([
    ["sin id", { stage: "won" }],
    ["un id que no es UUID", { opportunityId: "1", stage: "won" }],
    [
      "una inyección en el id",
      { opportunityId: `${ID}' OR '1'='1`, stage: "won" },
    ],
  ])(
    "un pedido con %s es not_found y no llega a la base",
    async (_, fields) => {
      expect(await changeOpportunityStage(null, form(fields))).toEqual({
        status: "not_found",
      });
      expect(mocks.calls).toEqual(["requireTenant"]);
      expect(mocks.revalidatePath).not.toHaveBeenCalled();
    },
  );

  it.each(["", "qualified", "test_drive", "done"])(
    "la etapa %j no existe: invalid y no llega a la base",
    async (stage) => {
      expect(
        await changeOpportunityStage(null, form({ opportunityId: ID, stage })),
      ).toEqual({ status: "invalid" });
      expect(mocks.calls).toEqual(["requireTenant"]);
    },
  );

  it("unchanged no revalida: no cambió nada", async () => {
    mocks.transition.mockImplementation(async () => ({
      outcome: "unchanged",
      opportunityId: ID,
      stage: "qualifying",
    }));
    const state = await changeOpportunityStage(
      null,
      form({ opportunityId: ID, stage: "qualifying" }),
    );
    expect(state).toEqual({
      status: "unchanged",
      opportunityId: ID,
      stage: "qualifying",
    });
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });

  it("invalid_transition devuelve la etapa real y revalida para mostrarla", async () => {
    mocks.transition.mockImplementation(async () => ({
      outcome: "invalid_transition",
      opportunityId: ID,
      current: "lost",
    }));
    const state = await changeOpportunityStage(
      null,
      form({ opportunityId: ID, stage: "won" }),
    );
    expect(state).toEqual({
      status: "invalid_transition",
      opportunityId: ID,
      current: "lost",
    });
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/opportunities");
    expect(mocks.revalidatePath).toHaveBeenCalledWith(`/opportunities/${ID}`);
  });

  it("una oportunidad inexistente o ajena es not_found", async () => {
    mocks.transition.mockImplementation(async () => ({ outcome: "not_found" }));
    expect(
      await changeOpportunityStage(
        null,
        form({ opportunityId: ID, stage: "qualifying" }),
      ),
    ).toEqual({ status: "not_found" });
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });

  it("el estado previo que manda el cliente no se usa", async () => {
    const forgedPrevious = {
      status: "changed",
      opportunityId: "x",
      from: "new",
      to: "won",
    } as const;
    expect(await changeOpportunityStage(forgedPrevious, form({}))).toEqual({
      status: "not_found",
    });
  });

  it("una falla al guardar no revalida ni expone detalles", async () => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    mocks.transition.mockImplementation(async () => {
      throw new Error(
        'Failed query: update "opportunities" … params: price,Ramón Benítez',
        { cause: { code: "23514", constraint_name: "x", detail: "secreto" } },
      );
    });
    try {
      const state = await changeOpportunityStage(
        null,
        form({ opportunityId: ID, stage: "negotiating" }),
      );
      expect(state).toEqual({ status: "failed" });
      expect(mocks.revalidatePath).not.toHaveBeenCalled();
      expect(errors).toHaveBeenCalledWith(
        "[opportunities] change stage failed",
        {
          name: "Error",
          code: "23514",
          constraint_name: "x",
        },
      );
      expect(JSON.stringify(errors.mock.calls)).not.toMatch(
        /Ramón|secreto|Failed query|price/,
      );
    } finally {
      errors.mockRestore();
    }
  });
});
