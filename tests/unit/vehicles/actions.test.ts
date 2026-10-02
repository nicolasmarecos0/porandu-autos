import { beforeEach, describe, expect, it, vi } from "vitest";

import { createVehicle } from "@/lib/vehicles/actions";

/*
 * Server Action del alta rápida (H1.3B), sin base de datos: el orden de la
 * cadena (requireTenant() → validar → escribir con ese mismo contexto →
 * revalidar) y qué le llega a la escritura. La escritura real, RLS y el
 * estado forzado se prueban contra PostgreSQL en
 * tests/db/create-vehicle.test.ts.
 */

vi.mock("server-only", () => ({}));

const mocks = vi.hoisted(() => ({
  calls: [] as string[],
  requireTenant: vi.fn(),
  write: vi.fn(),
  revalidatePath: vi.fn(),
}));

vi.mock("@/lib/tenant/session", () => ({
  requireTenant: mocks.requireTenant,
}));
vi.mock("@/db/queries/create-vehicle", () => ({
  createVehicleInPreparation: mocks.write,
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
