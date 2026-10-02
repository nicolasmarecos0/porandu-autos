import { drizzle } from "drizzle-orm/postgres-js";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  getStockList,
  statusFromDb,
  toStockVehicle,
  type StockRow,
} from "@/db/queries/vehicles";
import { vehicleStatuses } from "@/db/schema";
import { VEHICLE_STATUSES } from "@/domains/vehicles/stock";

/*
 * Loader de la Stock List (H1.3A), sin base de datos:
 * - la cadena requireTenant() → withTenant() con ese mismo contexto;
 * - el filtro explícito por organización y el orden sobre el SQL generado
 *   (RLS no alcanza para detectar si falta el filtro: lo prueba
 *   tests/db/vehicles.test.ts con un usuario de varias organizaciones);
 * - el mapping fila → ViewModel: lo persistido conserva su forma exacta
 *   (precio como texto decimal) y lo ausente queda "sin dato".
 */

vi.mock("server-only", () => ({}));

const mocks = vi.hoisted(() => ({
  calls: [] as string[],
  queries: [] as { sql: string; params: unknown[] }[],
  rows: [] as unknown[],
  requireTenant: vi.fn(),
  withTenant: vi.fn(),
}));

vi.mock("@/lib/tenant/session", () => ({
  requireTenant: mocks.requireTenant,
}));
vi.mock("@/db/tenant", () => ({ withTenant: mocks.withTenant }));

const ORG = "00000000-0000-4000-8000-000000000001";
const CTX = Object.freeze({ organizationId: ORG, marker: "tenant-context" });

const ROW: StockRow = {
  id: "20000000-0000-4000-8000-000000000101",
  brand: "Toyota",
  model: "Hilux",
  version: "SRV 2.8 4x4 AT",
  year: 2025,
  km: 0,
  price: "49900.00",
  currency: "USD",
  status: "available",
};

beforeEach(() => {
  mocks.calls.length = 0;
  mocks.queries.length = 0;
  mocks.rows = [];
  mocks.requireTenant.mockReset();
  mocks.requireTenant.mockImplementation(async () => {
    mocks.calls.push("requireTenant");
    return CTX;
  });
  mocks.withTenant.mockReset();
  mocks.withTenant.mockImplementation(
    async (
      _ctx: unknown,
      fn: (tx: unknown) => { toSQL(): { sql: string; params: unknown[] } },
    ) => {
      mocks.calls.push("withTenant");
      mocks.queries.push(fn(drizzle.mock()).toSQL());
      return mocks.rows;
    },
  );
});

describe("getStockList: requireTenant() → withTenant()", () => {
  it("obtiene el contexto con requireTenant() y lo pasa tal cual a withTenant()", async () => {
    await getStockList();

    expect(mocks.calls).toEqual(["requireTenant", "withTenant"]);
    expect(mocks.withTenant).toHaveBeenCalledTimes(1);
    expect(mocks.withTenant.mock.calls[0]?.[0]).toBe(CTX);
  });

  it("si requireTenant() redirige (sin sesión, sin acceso), no consulta", async () => {
    mocks.requireTenant.mockRejectedValueOnce(new Error("NEXT_REDIRECT"));

    await expect(getStockList()).rejects.toThrow("NEXT_REDIRECT");
    expect(mocks.withTenant).not.toHaveBeenCalled();
  });

  it("filtra explícitamente por la organización del contexto", async () => {
    await getStockList();

    const [query] = mocks.queries;
    expect(query?.sql).toContain('where "vehicles"."organization_id" = $1');
    expect(query?.params).toEqual([ORG]);
  });

  it("ordena por ingreso, el más reciente primero, y desempata por id", async () => {
    await getStockList();

    const [query] = mocks.queries;
    expect(query?.sql).toMatch(
      /order by "vehicles"\."created_at" desc, "vehicles"\."id" asc$/,
    );
  });

  it("solo selecciona lo persistido que muestra la lista", async () => {
    await getStockList();

    const [query] = mocks.queries;
    expect(query?.sql).toMatch(
      /^select "id", "brand", "model", "version", "year", "km", "price", "currency", "status" from "vehicles" where/,
    );
  });

  it("0 filas: lista vacía válida", async () => {
    expect(await getStockList()).toEqual([]);
  });

  it("mapea cada fila en el orden de la base", async () => {
    mocks.rows = [
      ROW,
      { ...ROW, id: "20000000-0000-4000-8000-000000000102", year: 2023 },
    ];
    expect((await getStockList()).map((v) => [v.id, v.year])).toEqual([
      [ROW.id, 2025],
      ["20000000-0000-4000-8000-000000000102", 2023],
    ]);
  });
});

describe("toStockVehicle: contrato de la Stock List", () => {
  it("lo persistido conserva exactamente su forma; el precio sigue siendo el texto decimal", () => {
    expect(toStockVehicle(ROW)).toStrictEqual({
      id: ROW.id,
      brand: "Toyota",
      model: "Hilux",
      version: "SRV 2.8 4x4 AT",
      year: 2025,
      km: 0,
      price: { amount: "49900.00", currency: "USD" },
      status: "available",
    });
    expect(
      toStockVehicle({ ...ROW, price: "245000000.00", currency: "PYG" }).price,
    ).toStrictEqual({ amount: "245000000.00", currency: "PYG" });
  });

  it("versión, km y precio ausentes son sin dato, nunca inventados", () => {
    const mapped = toStockVehicle({
      ...ROW,
      version: "  ",
      km: null,
      price: null,
      currency: null,
      status: "in_preparation",
    });
    expect(mapped).toStrictEqual({
      id: ROW.id,
      brand: "Toyota",
      model: "Hilux",
      year: 2025,
      status: "inPreparation",
    });
    // 0 km es un dato, no una ausencia.
    expect(toStockVehicle({ ...ROW, km: 0 }).km).toBe(0);
  });

  it("no agrega matches, interesados, fotos, score ni demanda", () => {
    const keys = Object.keys(toStockVehicle(ROW)).sort();
    expect(keys).toEqual(
      [
        "brand",
        "id",
        "km",
        "model",
        "price",
        "status",
        "version",
        "year",
      ].sort(),
    );
  });

  it("cada estado de la base tiene su valor en el dominio, con copy", () => {
    expect(Object.keys(statusFromDb).sort()).toEqual(
      [...vehicleStatuses].sort(),
    );
    expect(vehicleStatuses.map((status) => statusFromDb[status])).toEqual(
      VEHICLE_STATUSES.map((status) => status.id),
    );
  });
});
