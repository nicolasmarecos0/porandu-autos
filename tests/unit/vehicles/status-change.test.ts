import { beforeEach, describe, expect, it, vi } from "vitest";

import { changeVehicleStatus } from "@/lib/vehicles/actions";
import { parseVehicleStatusChange } from "@/lib/vehicles/status-change";

/*
 * changeVehicleStatus() (Hito 19, propuesta DEC-051) sin base de datos: el
 * orden de la cadena (requireTenant() → leer el pedido → escribir con ese
 * mismo contexto → revalidar), qué llega a la escritura y qué vuelve al
 * navegador. La escritura real, RLS, el trigger, la concurrencia y el
 * aislamiento se prueban contra PostgreSQL en
 * tests/db/vehicle-lifecycle.test.ts.
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
vi.mock("@/db/queries/change-vehicle-status", () => ({
  transitionVehicleStatus: mocks.transition,
}));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));

const ORG = "00000000-0000-4000-8000-000000000001";
const OTHER_ORG = "00000000-0000-4000-8000-000000000002";
const CTX = Object.freeze({ organizationId: ORG, marker: "tenant-context" });
const VEHICLE_ID = "20000000-0000-4000-8000-000000000001";
const HILUX = { id: VEHICLE_ID, brand: "Toyota", model: "Hilux", year: 2025 };
const UNIT = {
  vehicleId: VEHICLE_ID,
  brand: "Toyota",
  model: "Hilux",
  year: 2025,
};

/** Las vistas que leen vehicles.status, en el orden en que se revalidan. */
const LIFECYCLE_PATHS = [
  "/stock",
  "/stock/catalog",
  "/opportunities",
  "/opportunities/pipeline",
  "/cockpit",
  "/cockpit/metrics",
];

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
      vehicle: HILUX,
      transition: "reserve",
      from: "available",
      to: "reserved",
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

describe("parseVehicleStatusChange(): input no confiable", () => {
  it.each(["put_on_floor", "reserve", "release"] as const)(
    "%s con un UUID es un pedido de Stock",
    (transition) => {
      expect(
        parseVehicleStatusChange(form({ vehicleId: VEHICLE_ID, transition })),
      ).toEqual({ kind: "ok", vehicleId: VEHICLE_ID, transition });
    },
  );

  it("normaliza el id (espacios, mayúsculas) y la transición (espacios)", () => {
    expect(
      parseVehicleStatusChange(
        form({
          vehicleId: `  ${VEHICLE_ID.toUpperCase()} `,
          transition: " release ",
        }),
      ),
    ).toEqual({ kind: "ok", vehicleId: VEHICLE_ID, transition: "release" });
  });

  it("vender no es una transición de Stock", () => {
    expect(
      parseVehicleStatusChange(
        form({ vehicleId: VEHICLE_ID, transition: "sell" }),
      ),
    ).toEqual({ kind: "sale_requires_closure" });
  });

  it.each([
    ["sin id", { transition: "reserve" }],
    ["id vacío", { vehicleId: "", transition: "reserve" }],
    ["id que no es un UUID", { vehicleId: "2000-0000", transition: "reserve" }],
    [
      "inyección en el id",
      { vehicleId: `${VEHICLE_ID}' OR '1'='1`, transition: "reserve" },
    ],
  ])("%s: not_found", (_, fields) => {
    expect(parseVehicleStatusChange(form(fields))).toEqual({
      kind: "not_found",
    });
  });

  it.each(["", "available", "sold", "Reserve", "liberar"])(
    "transición %j: invalid",
    (transition) => {
      expect(
        parseVehicleStatusChange(form({ vehicleId: VEHICLE_ID, transition })),
      ).toEqual({ kind: "invalid" });
    },
  );

  it("un archivo en lugar del id o de la transición no es un pedido", () => {
    const data = new FormData();
    data.append("vehicleId", new Blob([VEHICLE_ID]), "id.txt");
    data.append("transition", "reserve");
    expect(parseVehicleStatusChange(data)).toEqual({ kind: "not_found" });
    const other = new FormData();
    other.append("vehicleId", VEHICLE_ID);
    other.append("transition", new Blob(["reserve"]), "t.txt");
    expect(parseVehicleStatusChange(other)).toEqual({ kind: "invalid" });
  });
});

describe("changeVehicleStatus()", () => {
  it("requireTenant() → escritura con ese contexto, la unidad y la transición → revalidar las seis vistas", async () => {
    const state = await changeVehicleStatus(
      null,
      form({ vehicleId: VEHICLE_ID, transition: "reserve" }),
    );

    expect(mocks.calls).toEqual([
      "requireTenant",
      "transition",
      ...LIFECYCLE_PATHS.map(() => "revalidatePath"),
    ]);
    expect(mocks.transition).toHaveBeenCalledWith(CTX, {
      vehicleId: VEHICLE_ID,
      transition: "reserve",
    });
    expect(mocks.revalidatePath.mock.calls).toEqual(
      LIFECYCLE_PATHS.map((path) => [path]),
    );
    expect(state).toEqual({
      status: "changed",
      ...UNIT,
      transition: "reserve",
      from: "available",
      to: "reserved",
    });
  });

  it("sin tenant (redirect) no lee el pedido ni escribe", async () => {
    mocks.requireTenant.mockImplementation(async () => {
      throw new RedirectSignal("/no-access");
    });
    await expect(
      changeVehicleStatus(
        null,
        form({ vehicleId: VEHICLE_ID, transition: "reserve" }),
      ),
    ).rejects.toThrow(RedirectSignal);
    expect(mocks.transition).not.toHaveBeenCalled();
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });

  it("organización, estado de destino y datos del pedido no llegan a la escritura", async () => {
    await changeVehicleStatus(
      null,
      form({
        vehicleId: VEHICLE_ID,
        transition: "release",
        organizationId: OTHER_ORG,
        organization_id: OTHER_ORG,
        status: "sold",
        to: "sold",
        brand: "Pisada",
      }),
    );
    expect(mocks.transition.mock.calls).toEqual([
      [CTX, { vehicleId: VEHICLE_ID, transition: "release" }],
    ]);
  });

  it.each([
    [
      "vender",
      { vehicleId: VEHICLE_ID, transition: "sell" },
      { status: "sale_requires_closure" },
    ],
    [
      "una transición desconocida",
      { vehicleId: VEHICLE_ID, transition: "sold" },
      { status: "invalid" },
    ],
    [
      "un id malformado",
      { vehicleId: "x", transition: "reserve" },
      { status: "not_found" },
    ],
  ])("%s no llega a la base ni revalida", async (_, fields, expected) => {
    expect(await changeVehicleStatus(null, form(fields))).toEqual(expected);
    expect(mocks.calls).toEqual(["requireTenant"]);
  });

  it.each([
    [
      "unchanged",
      {
        outcome: "unchanged",
        vehicle: HILUX,
        transition: "reserve",
        status: "reserved",
      },
      {
        status: "unchanged",
        ...UNIT,
        transition: "reserve",
        current: "reserved",
      },
    ],
    [
      "conflict",
      {
        outcome: "conflict",
        vehicle: HILUX,
        transition: "reserve",
        current: "sold",
      },
      { status: "conflict", ...UNIT, transition: "reserve", current: "sold" },
    ],
    ["not_found", { outcome: "not_found" }, { status: "not_found" }],
  ])(
    "%s devuelve el estado real y revalida para mostrarlo",
    async (_, outcome, expected) => {
      mocks.transition.mockImplementation(async () => outcome);
      expect(
        await changeVehicleStatus(
          null,
          form({ vehicleId: VEHICLE_ID, transition: "reserve" }),
        ),
      ).toEqual(expected);
      expect(mocks.revalidatePath.mock.calls).toEqual(
        LIFECYCLE_PATHS.map((path) => [path]),
      );
    },
  );

  it("el estado previo que manda el cliente no se usa", async () => {
    const forgedPrevious = {
      status: "changed",
      ...UNIT,
      transition: "reserve",
      from: "available",
      to: "reserved",
    } as const;
    expect(await changeVehicleStatus(forgedPrevious, form({}))).toEqual({
      status: "not_found",
    });
    expect(mocks.transition).not.toHaveBeenCalled();
  });

  it("una falla al guardar no revalida ni expone detalles: solo el tipo, el SQLSTATE y la constraint", async () => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    mocks.transition.mockImplementation(async () => {
      throw new Error(
        `Failed query: update "vehicles" … params: reserved,${VEHICLE_ID}`,
        {
          cause: {
            code: "23514",
            constraint_name: "vehicles_status_transition",
            detail: "secreto",
          },
        },
      );
    });
    try {
      expect(
        await changeVehicleStatus(
          null,
          form({ vehicleId: VEHICLE_ID, transition: "reserve" }),
        ),
      ).toEqual({ status: "failed" });
      expect(mocks.revalidatePath).not.toHaveBeenCalled();
      expect(errors).toHaveBeenCalledWith("[vehicles] change status failed", {
        name: "Error",
        code: "23514",
        constraint_name: "vehicles_status_transition",
      });
      expect(JSON.stringify(errors.mock.calls)).not.toContain(VEHICLE_ID);
    } finally {
      errors.mockRestore();
    }
  });

  it("un error del COMMIT (sin envoltorio de Drizzle) también se registra con su SQLSTATE", async () => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    const commitError = Object.assign(new Error("commit failed"), {
      code: "40001",
    });
    mocks.transition.mockImplementation(async () => {
      throw commitError;
    });
    try {
      expect(
        await changeVehicleStatus(
          null,
          form({ vehicleId: VEHICLE_ID, transition: "release" }),
        ),
      ).toEqual({ status: "failed" });
      expect(errors).toHaveBeenCalledWith("[vehicles] change status failed", {
        name: "Error",
        code: "40001",
        constraint_name: undefined,
      });
    } finally {
      errors.mockRestore();
    }
  });
});
