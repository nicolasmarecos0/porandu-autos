import { describe, expect, it } from "vitest";

import { BODY_TYPE_LABELS, bodyTypeOf } from "@/domains/vehicles/body-type";

/*
 * Carrocería por modelo (DEC-058): solo elige la representación genérica.
 * Un modelo desconocido es null: no se inventa una carrocería.
 */

describe("bodyTypeOf", () => {
  it.each([
    ["Hilux", "pickup"],
    ["Hilux SRV 2.8 4x4", "pickup"],
    ["Frontier", "pickup"],
    ["Amarok", "pickup"],
    ["Sportage", "suv"],
    ["Corolla Cross", "suv"],
    ["Tucson", "suv"],
    ["Kicks", "suv"],
    ["Corolla", "sedan"],
    ["Sentra", "sedan"],
    ["Yaris", "hatch"],
    ["Yaris Sedan", "sedan"],
    ["Yaris Cross", "suv"],
    ["Onix", "hatch"],
    ["Onix Plus", "sedan"],
    ["  corolla   CROSS ", "suv"],
    ["Ránger", "pickup"],
  ] as const)("%s → %s", (model, body) => {
    expect(bodyTypeOf({ model })).toBe(body);
  });

  it("un modelo fuera de la tabla, o sin modelo, es null", () => {
    expect(bodyTypeOf({ model: "Modelo X" })).toBeNull();
    expect(bodyTypeOf({ model: "Rangers" })).toBeNull();
    expect(bodyTypeOf({ model: "" })).toBeNull();
    expect(bodyTypeOf({})).toBeNull();
  });

  it("cada carrocería tiene su nombre", () => {
    expect(BODY_TYPE_LABELS).toEqual({
      pickup: "Pickup",
      suv: "SUV",
      sedan: "Sedán",
      hatch: "Hatchback",
    });
  });
});
