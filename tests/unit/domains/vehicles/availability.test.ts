import { describe, expect, it } from "vitest";

import {
  AVAILABILITY_TRANSITION,
  canMarkAvailable,
  MARK_AVAILABLE_FIELD,
} from "@/domains/vehicles/availability";
import { VEHICLE_STATUSES } from "@/domains/vehicles/stock";

describe("disponibilidad de una unidad (H1.3C)", () => {
  it("la única transición es en preparación → disponible", () => {
    expect(AVAILABILITY_TRANSITION).toEqual({
      from: "inPreparation",
      to: "available",
    });
  });

  it("solo una unidad en preparación se puede marcar disponible", () => {
    expect(
      VEHICLE_STATUSES.map(({ id }) => [id, canMarkAvailable(id)]),
    ).toEqual([
      ["inPreparation", true],
      ["available", false],
      ["reserved", false],
      ["sold", false],
    ]);
  });

  it("el pedido solo identifica la unidad", () => {
    expect(MARK_AVAILABLE_FIELD).toBe("vehicleId");
  });
});
