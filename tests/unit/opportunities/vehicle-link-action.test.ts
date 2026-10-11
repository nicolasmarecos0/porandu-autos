import { beforeEach, describe, expect, it, vi } from "vitest";

import { linkOpportunityVehicle } from "@/lib/opportunities/actions";

/*
 * Server Action linkOpportunityVehicle() (Hito 2, DEC-033 §2), sin base de
 * datos. Prueba el orden de la cadena (requireTenant() → leer el pedido →
 * escritura con ese mismo contexto → revalidar el detalle), qué le llega a la
 * escritura y qué responde ante cada resultado. El planner, la fila
 * bloqueada, RLS, la FK compuesta, el CHECK y el trigger se prueban contra
 * PostgreSQL en tests/db/opportunity-vehicle-link.test.ts.
 */

vi.mock("server-only", () => ({}));

const mocks = vi.hoisted(() => ({
  calls: [] as string[],
  requireTenant: vi.fn(),
  setVehicle: vi.fn(),
  revalidatePath: vi.fn(),
}));

vi.mock("@/lib/tenant/session", () => ({
  requireTenant: mocks.requireTenant,
}));
vi.mock("@/db/queries/link-opportunity-vehicle", () => ({
  setOpportunityVehicle: mocks.setVehicle,
}));
vi.mock("@/db/queries/record-opportunity-note", () => ({
  insertOpportunityNote: vi.fn(),
}));
vi.mock("@/db/queries/change-opportunity-stage", () => ({
  transitionOpportunityStage: vi.fn(),
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
const VEHICLE = "20000000-0000-4000-8000-000000000101";

class RedirectSignal extends Error {}

beforeEach(() => {
  mocks.calls.length = 0;
  mocks.requireTenant.mockReset();
  mocks.requireTenant.mockImplementation(async () => {
    mocks.calls.push("requireTenant");
    return CTX;
  });
  mocks.setVehicle.mockReset();
  mocks.setVehicle.mockImplementation(async () => {
    mocks.calls.push("setVehicle");
    return {
      outcome: "linked",
      opportunityId: ID,
      vehicleId: VEHICLE,
      previousVehicleId: null,
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

describe("linkOpportunityVehicle()", () => {
  it("requireTenant() → escritura con ese contexto → revalidar solo el detalle", async () => {
    const state = await linkOpportunityVehicle(
      null,
      form({ opportunityId: ID, vehicleId: VEHICLE }),
    );

    expect(mocks.calls).toEqual([
      "requireTenant",
      "setVehicle",
      "revalidatePath",
    ]);
    expect(mocks.setVehicle).toHaveBeenCalledWith(CTX, {
      opportunityId: ID,
      vehicleId: VEHICLE,
    });
    expect(mocks.revalidatePath.mock.calls).toEqual([[`/opportunities/${ID}`]]);
    expect(state).toEqual({
      status: "linked",
      opportunityId: ID,
      vehicleId: VEHICLE,
    });
  });

  it("una unidad vacía quita el vínculo", async () => {
    mocks.setVehicle.mockImplementation(async () => ({
      outcome: "unlinked",
      opportunityId: ID,
      previousVehicleId: VEHICLE,
    }));
    const state = await linkOpportunityVehicle(
      null,
      form({ opportunityId: ID, vehicleId: "  " }),
    );
    expect(mocks.setVehicle).toHaveBeenCalledWith(CTX, {
      opportunityId: ID,
      vehicleId: null,
    });
    expect(state).toEqual({ status: "unlinked", opportunityId: ID });
    expect(mocks.revalidatePath).toHaveBeenCalledWith(`/opportunities/${ID}`);
  });

  it("los ids llegan en minúsculas", async () => {
    await linkOpportunityVehicle(
      null,
      form({
        opportunityId: ID.toUpperCase(),
        vehicleId: VEHICLE.toUpperCase(),
      }),
    );
    expect(mocks.setVehicle).toHaveBeenCalledWith(CTX, {
      opportunityId: ID,
      vehicleId: VEHICLE,
    });
  });

  it("sin tenant (redirect) no lee el pedido ni escribe", async () => {
    mocks.requireTenant.mockImplementation(async () => {
      throw new RedirectSignal("/no-access");
    });
    await expect(
      linkOpportunityVehicle(
        null,
        form({ opportunityId: ID, vehicleId: VEHICLE }),
      ),
    ).rejects.toThrow(RedirectSignal);
    expect(mocks.setVehicle).not.toHaveBeenCalled();
  });

  it("organización, etapa, estado de la unidad y reloj del pedido no llegan a la escritura", async () => {
    await linkOpportunityVehicle(
      null,
      form({
        opportunityId: ID,
        vehicleId: VEHICLE,
        organizationId: OTHER_ORG,
        organization_id: OTHER_ORG,
        stage: "won",
        status: "sold",
        updated_at: "2020-01-01",
      }),
    );
    const [ctx, request] = mocks.setVehicle.mock.calls[0] as [
      unknown,
      Record<string, unknown>,
    ];
    expect(ctx).toBe(CTX);
    expect(Object.keys(request).sort()).toEqual(["opportunityId", "vehicleId"]);
    expect(JSON.stringify(request)).not.toMatch(/000000000002|won|sold|2020/);
  });

  it.each([
    ["sin id", { vehicleId: VEHICLE }, { status: "not_found" }],
    [
      "un id que no es UUID",
      { opportunityId: "1", vehicleId: VEHICLE },
      { status: "not_found" },
    ],
    [
      "una unidad que no es UUID",
      { opportunityId: ID, vehicleId: "1' OR '1'='1" },
      { status: "vehicle_not_found" },
    ],
    ["sin el campo de la unidad", { opportunityId: ID }, { status: "invalid" }],
  ])("un pedido %s no llega a la base", async (_, fields, expected) => {
    expect(await linkOpportunityVehicle(null, form(fields))).toEqual(expected);
    expect(mocks.calls).toEqual(["requireTenant"]);
  });

  it.each([
    [
      { outcome: "unchanged", opportunityId: ID, vehicleId: VEHICLE },
      { status: "unchanged", opportunityId: ID, vehicleId: VEHICLE },
      false,
    ],
    [
      { outcome: "stage_not_allowed", opportunityId: ID, stage: "lost" },
      { status: "stage_not_allowed", opportunityId: ID, stage: "lost" },
      true,
    ],
    [
      { outcome: "vehicle_not_found", opportunityId: ID },
      { status: "vehicle_not_found" },
      false,
    ],
    [
      { outcome: "vehicle_not_available", opportunityId: ID },
      { status: "vehicle_not_available" },
      true,
    ],
    [
      { outcome: "not_a_match", opportunityId: ID },
      { status: "not_a_match" },
      true,
    ],
    [{ outcome: "not_found" }, { status: "not_found" }, false],
  ] as const)(
    "%o → %o (revalida para mostrar el estado real: %s)",
    async (outcome, expected, revalidates) => {
      mocks.setVehicle.mockImplementation(async () => outcome);
      expect(
        await linkOpportunityVehicle(
          null,
          form({ opportunityId: ID, vehicleId: VEHICLE }),
        ),
      ).toEqual(expected);
      if (revalidates) {
        expect(mocks.revalidatePath.mock.calls).toEqual([
          [`/opportunities/${ID}`],
        ]);
      } else {
        expect(mocks.revalidatePath).not.toHaveBeenCalled();
      }
    },
  );

  it("el estado previo que manda el cliente no se usa", async () => {
    const forgedPrevious = {
      status: "linked",
      opportunityId: "x",
      vehicleId: "y",
    } as const;
    expect(await linkOpportunityVehicle(forgedPrevious, form({}))).toEqual({
      status: "not_found",
    });
  });

  it("una falla al guardar no revalida ni expone detalles", async () => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    mocks.setVehicle.mockImplementation(async () => {
      throw new Error(
        'Failed query: update "opportunities" … params: Ramón Benítez',
        {
          cause: {
            code: "23514",
            constraint_name: "opportunities_vehicle_link",
            detail: "secreto",
          },
        },
      );
    });
    try {
      const state = await linkOpportunityVehicle(
        null,
        form({ opportunityId: ID, vehicleId: VEHICLE }),
      );
      expect(state).toEqual({ status: "failed" });
      expect(mocks.revalidatePath).not.toHaveBeenCalled();
      expect(errors).toHaveBeenCalledWith(
        "[opportunities] link vehicle failed",
        {
          name: "Error",
          code: "23514",
          constraint_name: "opportunities_vehicle_link",
        },
      );
      expect(JSON.stringify(errors.mock.calls)).not.toMatch(
        /Ramón|secreto|Failed query/,
      );
    } finally {
      errors.mockRestore();
    }
  });
});
