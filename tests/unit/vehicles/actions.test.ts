import { beforeEach, describe, expect, it, vi } from "vitest";

import { createVehicle, markVehicleAvailable } from "@/lib/vehicles/actions";

/*
 * Server Actions de unidades, sin base de datos: el alta rápida (H1.3B) y la
 * disponibilidad (H1.3C). Prueban el orden de la cadena (requireTenant() →
 * validar → escribir con ese mismo contexto → revalidar) y qué le llega a la
 * escritura. La escritura real, RLS, el estado forzado y la concurrencia se
 * prueban contra PostgreSQL en tests/db/create-vehicle.test.ts y
 * tests/db/vehicle-availability.test.ts.
 */

vi.mock("server-only", () => ({}));

const mocks = vi.hoisted(() => ({
  calls: [] as string[],
  requireTenant: vi.fn(),
  write: vi.fn(),
  transition: vi.fn(),
  revalidatePath: vi.fn(),
}));

vi.mock("@/lib/tenant/session", () => ({
  requireTenant: mocks.requireTenant,
}));
vi.mock("@/db/queries/create-vehicle", () => ({
  createVehicleInPreparation: mocks.write,
}));
vi.mock("@/db/queries/mark-vehicle-available", () => ({
  transitionVehicleToAvailable: mocks.transition,
}));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));

const ORG = "00000000-0000-4000-8000-000000000001";
const OTHER_ORG = "00000000-0000-4000-8000-000000000002";
const CTX = Object.freeze({ organizationId: ORG, marker: "tenant-context" });
const VEHICLE_ID = "20000000-0000-4000-8000-000000000001";

class RedirectSignal extends Error {}

beforeEach(() => {
  mocks.calls.length = 0;
  mocks.requireTenant.mockReset();
  mocks.requireTenant.mockImplementation(async () => {
    mocks.calls.push("requireTenant");
    return CTX;
  });
  mocks.write.mockReset();
  mocks.write.mockImplementation(async () => {
    mocks.calls.push("write");
    return { id: VEHICLE_ID, brand: "Toyota", model: "Hilux", year: 2021 };
  });
  mocks.transition.mockReset();
  mocks.transition.mockImplementation(async () => {
    mocks.calls.push("transition");
    return {
      outcome: "became_available",
      vehicle: { id: VEHICLE_ID, brand: "Toyota", model: "Hilux", year: 2021 },
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

const VALID = {
  brand: "Toyota",
  model: "Hilux",
  version: "",
  year: "2021",
  km: "142.000",
  price: "31.500",
  currency: "USD",
};

describe("createVehicle()", () => {
  it("requireTenant() → escritura con ese contexto → revalidar /stock", async () => {
    const state = await createVehicle(null, form(VALID));

    expect(mocks.calls).toEqual(["requireTenant", "write", "revalidatePath"]);
    expect(mocks.write).toHaveBeenCalledWith(CTX, {
      brand: "Toyota",
      model: "Hilux",
      version: null,
      year: 2021,
      km: 142000,
      price: { amount: "31500.00", currency: "USD" },
    });
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/stock");
    expect(state).toEqual({
      status: "created",
      vehicleId: VEHICLE_ID,
      brand: "Toyota",
      model: "Hilux",
      year: 2021,
    });
  });

  it("sin tenant (redirect) no valida ni escribe, aunque el payload sea inválido", async () => {
    mocks.requireTenant.mockImplementation(async () => {
      throw new RedirectSignal("/login");
    });
    await expect(createVehicle(null, form({}))).rejects.toThrow(RedirectSignal);
    expect(mocks.write).not.toHaveBeenCalled();
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });

  it("un payload inválido no llega a la escritura", async () => {
    const state = await createVehicle(
      null,
      form({ ...VALID, year: "1899", currency: "" }),
    );
    expect(state).toMatchObject({
      status: "invalid",
      errors: { year: "invalid_year", currency: "required" },
    });
    expect(mocks.calls).toEqual(["requireTenant"]);
  });

  it("organización y estado del payload no llegan a la escritura", async () => {
    await createVehicle(
      null,
      form({
        ...VALID,
        organizationId: OTHER_ORG,
        organization_id: OTHER_ORG,
        status: "available",
        id: "20000000-0000-4000-8000-000000000999",
      }),
    );
    const [ctx, input] = mocks.write.mock.calls[0] as [unknown, object];
    expect(ctx).toBe(CTX);
    expect(JSON.stringify(input)).not.toMatch(
      /000000000002|000000000999|available|organization|status/,
    );
  });

  it("el estado previo que manda el cliente no se usa", async () => {
    const forgedPrevious = {
      status: "created",
      vehicleId: "x",
      brand: "x",
      model: "x",
      year: 2000,
    } as const;
    const state = await createVehicle(forgedPrevious, form({}));
    expect(state).toMatchObject({ status: "invalid" });
  });

  it("una falla al guardar no revalida ni expone detalles: vuelve lo cargado", async () => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    mocks.write.mockImplementation(async () => {
      throw new Error(
        'Failed query: insert into "vehicles" … params: Toyota,Hilux,2021',
        { cause: { code: "42501", detail: "secreto" } },
      );
    });
    try {
      const state = await createVehicle(null, form(VALID));
      expect(state).toEqual({ status: "failed", values: VALID });
      expect(mocks.revalidatePath).not.toHaveBeenCalled();
      expect(errors).toHaveBeenCalledWith("[vehicles] create failed", {
        name: "Error",
        code: "42501",
      });
      expect(JSON.stringify(errors.mock.calls)).not.toMatch(
        /Toyota|Hilux|secreto|Failed query/,
      );
    } finally {
      errors.mockRestore();
    }
  });
});

describe("markVehicleAvailable()", () => {
  const HILUX = { id: VEHICLE_ID, brand: "Toyota", model: "Hilux", year: 2021 };

  it("requireTenant() → transición con ese contexto y solo el id → revalidar /stock", async () => {
    const state = await markVehicleAvailable(
      null,
      form({ vehicleId: VEHICLE_ID }),
    );

    expect(mocks.calls).toEqual([
      "requireTenant",
      "transition",
      "revalidatePath",
    ]);
    expect(mocks.transition).toHaveBeenCalledWith(CTX, VEHICLE_ID);
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/stock");
    expect(state).toEqual({
      status: "available",
      vehicleId: VEHICLE_ID,
      brand: "Toyota",
      model: "Hilux",
      year: 2021,
    });
  });

  it("sin tenant (redirect) no lee el pedido ni escribe", async () => {
    mocks.requireTenant.mockImplementation(async () => {
      throw new RedirectSignal("/no-access");
    });
    await expect(
      markVehicleAvailable(null, form({ vehicleId: VEHICLE_ID })),
    ).rejects.toThrow(RedirectSignal);
    expect(mocks.transition).not.toHaveBeenCalled();
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });

  it("organización, estado de destino y datos del pedido no llegan a la escritura: solo el contexto y el id", async () => {
    await markVehicleAvailable(
      null,
      form({
        vehicleId: VEHICLE_ID,
        organizationId: OTHER_ORG,
        organization_id: OTHER_ORG,
        status: "sold",
        to: "reserved",
        brand: "Pisada",
        price: "1",
      }),
    );
    expect(mocks.transition).toHaveBeenCalledTimes(1);
    const args = mocks.transition.mock.calls[0] as unknown[];
    expect(args).toHaveLength(2);
    expect(args[0]).toBe(CTX);
    expect(args[1]).toBe(VEHICLE_ID);
  });

  it("normaliza el id (espacios, mayúsculas) antes de escribir", async () => {
    await markVehicleAvailable(
      null,
      form({ vehicleId: `  ${VEHICLE_ID.toUpperCase()} ` }),
    );
    expect(mocks.transition).toHaveBeenCalledWith(CTX, VEHICLE_ID);
  });

  it.each([
    ["sin id", {}],
    ["id vacío", { vehicleId: "" }],
    ["id que no es un UUID", { vehicleId: "20000000-0000" }],
    ["inyección en el id", { vehicleId: `${VEHICLE_ID}' OR '1'='1` }],
  ])(
    "un pedido sin unidad válida (%s) es not_found y no llega a la base",
    async (_, fields) => {
      const state = await markVehicleAvailable(null, form(fields));
      expect(state).toEqual({ status: "not_found" });
      expect(mocks.calls).toEqual(["requireTenant"]);
      expect(mocks.revalidatePath).not.toHaveBeenCalled();
    },
  );

  it("un archivo en lugar del id tampoco llega a la base", async () => {
    const data = new FormData();
    data.append("vehicleId", new Blob([VEHICLE_ID]), "id.txt");
    expect(await markVehicleAvailable(null, data)).toEqual({
      status: "not_found",
    });
    expect(mocks.transition).not.toHaveBeenCalled();
  });

  it("una unidad que ya no estaba en preparación es unchanged, con su estado real, y revalida", async () => {
    mocks.transition.mockImplementation(async () => ({
      outcome: "unchanged",
      vehicle: HILUX,
      status: "reserved",
    }));
    expect(
      await markVehicleAvailable(null, form({ vehicleId: VEHICLE_ID })),
    ).toEqual({
      status: "unchanged",
      vehicleId: VEHICLE_ID,
      brand: "Toyota",
      model: "Hilux",
      year: 2021,
      current: "reserved",
    });
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/stock");
  });

  it("una unidad inexistente o de otra organización es not_found y revalida", async () => {
    mocks.transition.mockImplementation(async () => ({
      outcome: "not_found",
    }));
    expect(
      await markVehicleAvailable(null, form({ vehicleId: VEHICLE_ID })),
    ).toEqual({ status: "not_found" });
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/stock");
  });

  it("el estado previo que manda el cliente no se usa", async () => {
    const forgedPrevious = {
      status: "available",
      vehicleId: "x",
      brand: "x",
      model: "x",
      year: 2000,
    } as const;
    const state = await markVehicleAvailable(forgedPrevious, form({}));
    expect(state).toEqual({ status: "not_found" });
    expect(mocks.transition).not.toHaveBeenCalled();
  });

  it("una falla al guardar no revalida ni expone detalles", async () => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    mocks.transition.mockImplementation(async () => {
      throw new Error(
        `Failed query: update "vehicles" … params: available,${VEHICLE_ID}`,
        { cause: { code: "40001", detail: "secreto" } },
      );
    });
    try {
      const state = await markVehicleAvailable(
        null,
        form({ vehicleId: VEHICLE_ID }),
      );
      expect(state).toEqual({ status: "failed" });
      expect(mocks.revalidatePath).not.toHaveBeenCalled();
      expect(errors).toHaveBeenCalledWith("[vehicles] mark available failed", {
        name: "Error",
        code: "40001",
      });
      expect(JSON.stringify(errors.mock.calls)).not.toMatch(
        /secreto|Failed query|000000000001/,
      );
    } finally {
      errors.mockRestore();
    }
  });
});
