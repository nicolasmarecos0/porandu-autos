import { describe, expect, it } from "vitest";

import {
  formatKm,
  formatPrice,
  VEHICLE_STATUSES,
  vehicleName,
  vehicleStatusLabel,
  type Currency,
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
