import { beforeEach, describe, expect, it, vi } from "vitest";

import { changeVehiclePrice } from "@/lib/vehicles/actions";

/*
 * Server Action del precio publicado (Hito 22, DEC-054 §3), sin base de
 * datos: un seller recibe UNAUTHORIZED_ROLE antes de leer el pedido y sin
 * tocar la base; un admin llega a la escritura con su contexto. La
 * escritura real, el trigger y los grants se prueban contra PostgreSQL en
 * tests/db/security-roles.test.ts.
 */

vi.mock("server-only", () => ({}));

const mocks = vi.hoisted(() => ({
  calls: [] as string[],
  role: "seller" as "admin" | "seller",
  requireTenant: vi.fn(),
  writeVehiclePrice: vi.fn(),
  revalidatePath: vi.fn(),
}));

vi.mock("@/lib/tenant/session", () => ({
  requireTenant: mocks.requireTenant,
}));
vi.mock("@/db/queries/change-vehicle-status", () => ({
  transitionVehicleStatus: vi.fn(),
  writeVehiclePrice: mocks.writeVehiclePrice,
}));
vi.mock("@/db/queries/create-vehicle", () => ({
  createVehicleInPreparation: vi.fn(),
}));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));

const ORG = "00000000-0000-4000-8000-000000000001";
const VEHICLE_ID = "20000000-0000-4000-8000-000000000001";
const HILUX = { id: VEHICLE_ID, brand: "Toyota", model: "Hilux", year: 2024 };

function form(fields: Record<string, string>): FormData {
  const data = new FormData();
  for (const [name, value] of Object.entries(fields)) data.append(name, value);
  return data;
}

const VALID = { vehicleId: VEHICLE_ID, price: "49.900", currency: "USD" };

beforeEach(() => {
  mocks.calls.length = 0;
  mocks.role = "seller";
  mocks.requireTenant.mockReset();
  mocks.requireTenant.mockImplementation(async () => {
    mocks.calls.push("requireTenant");
    return { organizationId: ORG, role: mocks.role };
  });
  mocks.writeVehiclePrice.mockReset();
  mocks.writeVehiclePrice.mockImplementation(async () => {
    mocks.calls.push("write");
    return {
      outcome: "changed",
      vehicle: HILUX,
      from: null,
      to: { amount: "49900.00", currency: "USD" },
    };
  });
  mocks.revalidatePath.mockReset();
});

describe("changeVehiclePrice()", () => {
  it("un seller recibe UNAUTHORIZED_ROLE sin leer el pedido ni llegar a la base", async () => {
    expect(await changeVehiclePrice(null, form(VALID))).toEqual({
      status: "unauthorized_role",
      code: "UNAUTHORIZED_ROLE",
      capability: "vehicle.edit_price",
    });
    // Ni un pedido inválido cambia la respuesta: el rol se decide primero.
    expect(
      await changeVehiclePrice(null, form({ ...VALID, price: "x" })),
    ).toMatchObject({ status: "unauthorized_role" });
    expect(mocks.calls).toEqual(["requireTenant", "requireTenant"]);
    expect(mocks.writeVehiclePrice).not.toHaveBeenCalled();
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });

  it("un admin: requireTenant() → validar → escritura con su contexto → revalidar el ciclo de vida", async () => {
    mocks.role = "admin";
    expect(await changeVehiclePrice(null, form(VALID))).toEqual({
      status: "changed",
      vehicleId: VEHICLE_ID,
      brand: "Toyota",
      model: "Hilux",
      year: 2024,
      priceLabel: "USD 49.900",
    });
    expect(mocks.calls).toEqual(["requireTenant", "write"]);
    expect(mocks.writeVehiclePrice.mock.calls[0]![1]).toEqual({
      vehicleId: VEHICLE_ID,
      price: { amount: "49900.00", currency: "USD" },
    });
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/stock");
  });

  it("un admin con un precio inválido no llega a la base y vuelve con lo cargado", async () => {
    mocks.role = "admin";
    expect(
      await changeVehiclePrice(
        null,
        form({ ...VALID, price: "1.000,50", currency: "PYG" }),
      ),
    ).toEqual({
      status: "invalid",
      errors: { price: "pyg_decimals" },
      values: { price: "1.000,50", currency: "PYG" },
    });
    expect(mocks.writeVehiclePrice).not.toHaveBeenCalled();
  });

  it("si la base lo rechaza por rol, la respuesta es la misma: UNAUTHORIZED_ROLE", async () => {
    mocks.role = "admin";
    mocks.writeVehiclePrice.mockResolvedValue({ outcome: "unauthorized_role" });
    expect(await changeVehiclePrice(null, form(VALID))).toMatchObject({
      status: "unauthorized_role",
      code: "UNAUTHORIZED_ROLE",
    });
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });

  it("una vendida es locked; un id malformado es not_found", async () => {
    mocks.role = "admin";
    mocks.writeVehiclePrice.mockResolvedValue({
      outcome: "locked",
      vehicle: HILUX,
      status: "sold",
    });
    expect(await changeVehiclePrice(null, form(VALID))).toMatchObject({
      status: "locked",
      current: "sold",
    });
    expect(
      await changeVehiclePrice(null, form({ ...VALID, vehicleId: "x" })),
    ).toEqual({ status: "not_found" });
  });
});
