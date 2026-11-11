import { describe, expect, it } from "vitest";

import {
  isPriceEditable,
  parseVehiclePrice,
  planVehiclePriceChange,
} from "@/domains/vehicles/price";
import { VEHICLE_STATUSES } from "@/domains/vehicles/stock";

/* Precio publicado de una unidad (Hito 22, DEC-054 §3). */

describe("parseVehiclePrice()", () => {
  it("lee montos es-PY a decimal canónico, con su moneda", () => {
    expect(
      parseVehiclePrice({ price: "150.000.000", currency: "PYG" }),
    ).toEqual({ ok: true, price: { amount: "150000000.00", currency: "PYG" } });
    expect(parseVehiclePrice({ price: "32.990,50", currency: "USD" })).toEqual({
      ok: true,
      price: { amount: "32990.50", currency: "USD" },
    });
  });

  it.each([
    [{ price: "", currency: "USD" }, { price: "required" }],
    [{ price: "0", currency: "USD" }, { price: "not_positive" }],
    [{ price: "1.5", currency: "USD" }, { price: "invalid_price" }],
    [{ price: "-10", currency: "USD" }, { price: "invalid_price" }],
    [{ price: "1.000,50", currency: "PYG" }, { price: "pyg_decimals" }],
    [{ price: "1.000", currency: "EUR" }, { currency: "invalid_currency" }],
    [{ price: "1.000", currency: "" }, { currency: "required" }],
    [{ price: "1234567890123", currency: "USD" }, { price: "invalid_price" }],
  ])("%o → %o", (values, errors) => {
    expect(parseVehiclePrice(values)).toEqual({ ok: false, errors });
  });
});

describe("planVehiclePriceChange()", () => {
  const NEXT = { amount: "50000.00", currency: "USD" } as const;

  it("en preparación, disponible o reservada el precio cambia; vendida o entregada, no", () => {
    for (const { id } of VEHICLE_STATUSES) {
      const plan = planVehiclePriceChange({ status: id, price: null }, NEXT);
      if (isPriceEditable(id)) {
        expect(plan).toEqual({ kind: "change", from: null, to: NEXT });
      } else {
        expect(plan).toEqual({ kind: "locked", status: id });
      }
    }
    expect(isPriceEditable("sold")).toBe(false);
    expect(isPriceEditable("delivered")).toBe(false);
  });

  it("el mismo precio y la misma moneda no se reescriben; otra moneda sí es un cambio", () => {
    expect(
      planVehiclePriceChange({ status: "available", price: NEXT }, NEXT),
    ).toEqual({ kind: "unchanged", price: NEXT });
    const pyg = { amount: "50000.00", currency: "PYG" } as const;
    expect(
      planVehiclePriceChange({ status: "available", price: pyg }, NEXT),
    ).toEqual({ kind: "change", from: pyg, to: NEXT });
  });
});
