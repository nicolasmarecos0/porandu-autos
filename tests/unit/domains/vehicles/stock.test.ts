import { describe, expect, it } from "vitest";

import {
  countByStatus,
  formatKm,
  formatPrice,
  groupByStatus,
  STOCK_GROUPS,
  unitsLabel,
  VEHICLE_STATUSES,
  vehicleDetail,
  vehicleName,
  vehicleStatusLabel,
  type Currency,
  type StockVehicle,
} from "@/domains/vehicles/stock";

describe("formatPrice: exacto, sin float", () => {
  it.each([
    ["49900.00", "USD", "USD 49.900"],
    ["49900", "USD", "USD 49.900"],
    ["49900.50", "USD", "USD 49.900,50"],
    ["49900.5", "USD", "USD 49.900,50"],
    ["14290.99", "USD", "USD 14.290,99"],
    ["950.00", "USD", "USD 950"],
    ["150000000.00", "PYG", "Gs. 150.000.000"],
    ["1250000", "PYG", "Gs. 1.250.000"],
    ["999999999999.99", "USD", "USD 999.999.999.999,99"],
    ["0049900.00", "USD", "USD 49.900"],
  ] as [string, Currency, string][])(
    "%s %s → %s",
    (amount, currency, expected) => {
      expect(formatPrice({ amount, currency })).toBe(expected);
    },
  );

  it("conserva dígitos que un float perdería", () => {
    // 2^53 + 1: como number sería 9007199254740992.
    expect(
      formatPrice({ amount: "9007199254740993.01", currency: "USD" }),
    ).toBe("USD 9.007.199.254.740.993,01");
  });

  it("rechaza un monto que no es un decimal", () => {
    for (const amount of ["", "-1", "1e5", "12,5", "USD 10", "NaN"]) {
      expect(() => formatPrice({ amount, currency: "USD" })).toThrow(
        /invalid decimal/,
      );
    }
  });
});

describe("formatKm", () => {
  it.each([
    [0, "0 km"],
    [8000, "8.000 km"],
    [142000, "142.000 km"],
    [1234567, "1.234.567 km"],
  ])("%s → %s", (km, expected) => {
    expect(formatKm(km)).toBe(expected);
  });

  it("rechaza valores que no son kilometraje", () => {
    for (const km of [-1, 1.5, Number.NaN]) {
      expect(() => formatKm(km)).toThrow(/invalid km/);
    }
  });
});

describe("estados de stock", () => {
  it("son los cuatro mínimos de P1, con su copy es-PY", () => {
    expect(VEHICLE_STATUSES).toEqual([
      { id: "inPreparation", label: "En preparación" },
      { id: "available", label: "Disponible" },
      { id: "reserved", label: "Reservado" },
      { id: "sold", label: "Vendido" },
    ]);
    expect(vehicleStatusLabel("available")).toBe("Disponible");
  });
});

describe("vehicleName", () => {
  it("marca y modelo", () => {
    expect(vehicleName({ brand: "Toyota", model: "Hilux" })).toBe(
      "Toyota Hilux",
    );
  });
});

describe("Stock Surface v0.1: identidad, conteos y grupos", () => {
  const unit = (
    id: string,
    status: StockVehicle["status"],
    version?: string,
  ): StockVehicle => ({
    id,
    brand: "Toyota",
    model: "Hilux",
    ...(version ? { version } : {}),
    year: 2025,
    status,
  });

  it("vehicleDetail: versión y año, o solo el año", () => {
    expect(vehicleDetail({ version: "SRV 2.8 4x4 AT", year: 2025 })).toBe(
      "SRV 2.8 4x4 AT · 2025",
    );
    expect(vehicleDetail({ year: 2019 })).toBe("2019");
  });

  it("unitsLabel: singular y plural", () => {
    expect(unitsLabel(0)).toBe("0 unidades");
    expect(unitsLabel(1)).toBe("1 unidad");
    expect(unitsLabel(12)).toBe("12 unidades");
  });

  it("countByStatus: deriva los conteos de la lista, con ceros", () => {
    expect(
      countByStatus([
        unit("1", "available"),
        unit("2", "sold"),
        unit("3", "available"),
      ]),
    ).toEqual({ inPreparation: 0, available: 2, reserved: 0, sold: 1 });
    expect(countByStatus([])).toEqual({
      inPreparation: 0,
      available: 0,
      reserved: 0,
      sold: 0,
    });
  });

  it("los grupos van de lo vendible a lo cerrado y cubren los cuatro estados", () => {
    expect(STOCK_GROUPS.map((group) => [group.status, group.title])).toEqual([
      ["available", "Disponibles"],
      ["inPreparation", "En preparación"],
      ["reserved", "Reservadas"],
      ["sold", "Vendidas"],
    ]);
    expect(STOCK_GROUPS.map((group) => group.status).sort()).toEqual(
      VEHICLE_STATUSES.map((status) => status.id).sort(),
    );
  });

  it("groupByStatus: omite grupos vacíos, conserva el orden del loader y no filtra vendidas", () => {
    const vehicles = [
      unit("a", "sold"),
      unit("b", "available"),
      unit("c", "reserved"),
      unit("d", "available"),
      unit("e", "sold"),
    ];
    const groups = groupByStatus(vehicles);
    expect(
      groups.map((group) => [group.status, group.vehicles.map((v) => v.id)]),
    ).toEqual([
      ["available", ["b", "d"]],
      ["reserved", ["c"]],
      ["sold", ["a", "e"]],
    ]);
    expect(groups.flatMap((group) => group.vehicles)).toHaveLength(
      vehicles.length,
    );
    expect(groupByStatus([])).toEqual([]);
  });
});
