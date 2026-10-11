import { describe, expect, it } from "vitest";

import type { DemandFact, DemandValues } from "@/domains/demand/facts";
import type {
  DemandSnapshot,
  DemandSnapshotFact,
} from "@/domains/demand/snapshot";
import type { MatchableVehicle } from "@/domains/match";
import { OPPORTUNITY_STAGES, type Stage } from "@/domains/opportunities/stages";
import {
  canChangeVehicleLink,
  canHoldVehicle,
  linkedVehicleCard,
  planVehicleLink,
  VEHICLE_HOLDING_STAGES,
  VEHICLE_LINK_STAGES,
  type VehicleLinkInput,
} from "@/domains/opportunities/vehicle-link";

/*
 * Unidad vinculada a la negociación (Hito 2, DEC-033 §2): en qué etapas se
 * cambia, y el planner que decide sobre la fila bloqueada. La base lo vuelve
 * a exigir con su CHECK y su trigger (tests/db/opportunity-vehicle-link.test.ts
 * cruza las etapas de este módulo con las de la base).
 */

const HILUX = "20000000-0000-4000-8000-000000000101";
const CROSS = "20000000-0000-4000-8000-000000000102";

type DemandInput = { [F in DemandFact]?: DemandValues[F] };

function snapshot(input: DemandInput = {}): DemandSnapshot {
  function fact<F extends DemandFact>(name: F): DemandSnapshotFact<F> {
    const value = input[name] as DemandValues[F] | undefined;
    return value === undefined
      ? { value: null, status: "unknown", factId: null }
      : { value, status: "confirmed", factId: `${name}-1` };
  }
  return {
    desired_vehicle: fact("desired_vehicle"),
    year_range: fact("year_range"),
    budget_max: fact("budget_max"),
    purchase_type: fact("purchase_type"),
    trade_in_intent: fact("trade_in_intent"),
    down_payment: fact("down_payment"),
  };
}

/** Busca una Toyota Hilux: la Hilux disponible es un match de 45 puntos. */
const WANTS_HILUX = snapshot({
  desired_vehicle: { brand: "Toyota", model: "Hilux" },
});

function vehicle(overrides: Partial<MatchableVehicle> = {}): MatchableVehicle {
  return {
    id: HILUX,
    organizationId: "org-1",
    status: "available",
    brand: "Toyota",
    model: "Hilux",
    year: 2025,
    price: { amount: "49900.00", currency: "USD" },
    ...overrides,
  };
}

function plan(overrides: Partial<VehicleLinkInput> = {}) {
  return planVehicleLink({
    stage: "negotiating",
    currentVehicleId: null,
    requestedVehicleId: HILUX,
    vehicle: vehicle(),
    demand: WANTS_HILUX,
    ...overrides,
  });
}

describe("etapas", () => {
  it("la unidad se cambia en En negociación y Ganada; Perdida la conserva", () => {
    expect(VEHICLE_LINK_STAGES).toEqual(["negotiating", "won"]);
    expect(VEHICLE_HOLDING_STAGES).toEqual(["negotiating", "won", "lost"]);
    expect(OPPORTUNITY_STAGES.filter(canChangeVehicleLink)).toEqual([
      "negotiating",
      "won",
    ]);
    expect(OPPORTUNITY_STAGES.filter(canHoldVehicle)).toEqual([
      "negotiating",
      "won",
      "lost",
    ]);
  });
});

describe("planVehicleLink", () => {
  it.each(VEHICLE_LINK_STAGES)(
    "en %s vincula una unidad disponible que es match",
    (stage) => {
      expect(plan({ stage })).toEqual({
        kind: "link",
        vehicleId: HILUX,
        previousVehicleId: null,
      });
    },
  );

  it("cambiar la unidad informa la anterior", () => {
    expect(
      plan({
        currentVehicleId: CROSS,
        requestedVehicleId: HILUX,
      }),
    ).toEqual({ kind: "link", vehicleId: HILUX, previousVehicleId: CROSS });
  });

  it.each(VEHICLE_LINK_STAGES)("en %s quita el vínculo", (stage) => {
    expect(
      plan({
        stage,
        currentVehicleId: HILUX,
        requestedVehicleId: null,
        vehicle: null,
      }),
    ).toEqual({ kind: "unlink", previousVehicleId: HILUX });
  });

  it.each(
    OPPORTUNITY_STAGES.filter(
      (stage): stage is Exclude<Stage, "negotiating" | "won"> =>
        !canChangeVehicleLink(stage),
    ),
  )("en %s no se vincula ni se quita nada", (stage) => {
    expect(plan({ stage })).toEqual({ kind: "stage_not_allowed", stage });
    expect(
      plan({
        stage,
        currentVehicleId: HILUX,
        requestedVehicleId: null,
        vehicle: null,
      }),
    ).toEqual({ kind: "stage_not_allowed", stage });
  });

  it.each(OPPORTUNITY_STAGES)(
    "pedir lo que ya está es unchanged, aun en %s",
    (stage) => {
      expect(
        plan({ stage, currentVehicleId: HILUX, requestedVehicleId: HILUX }),
      ).toEqual({ kind: "unchanged", vehicleId: HILUX });
      expect(
        plan({
          stage,
          currentVehicleId: null,
          requestedVehicleId: null,
          vehicle: null,
        }),
      ).toEqual({ kind: "unchanged", vehicleId: null });
    },
  );

  it("una unidad inexistente en la organización activa es vehicle_not_found", () => {
    expect(plan({ vehicle: null })).toEqual({ kind: "vehicle_not_found" });
    // Defensa: la unidad leída tiene que ser la pedida.
    expect(plan({ vehicle: vehicle({ id: CROSS }) })).toEqual({
      kind: "vehicle_not_found",
    });
  });

  it.each(["inPreparation", "reserved", "sold"] as const)(
    "una unidad %s no se vincula",
    (status) => {
      expect(plan({ vehicle: vehicle({ status }) })).toEqual({
        kind: "vehicle_not_available",
      });
    },
  );

  it("una unidad disponible que no es match de la demanda vigente no se vincula", () => {
    // Otra marca descalifica.
    expect(plan({ vehicle: vehicle({ brand: "Kia" }) })).toEqual({
      kind: "not_a_match",
    });
    // Sin demanda evaluable no hay match posible.
    expect(plan({ demand: snapshot() })).toEqual({ kind: "not_a_match" });
  });
});

describe("linkedVehicleCard", () => {
  it("identidad, precio, km y estado de la unidad", () => {
    expect(
      linkedVehicleCard({
        id: HILUX,
        brand: "Toyota",
        model: "Hilux",
        version: "SRV 2.8 4x4 AT",
        year: 2025,
        km: 0,
        price: { amount: "49900.00", currency: "USD" },
        status: "available",
      }),
    ).toEqual({
      vehicleId: HILUX,
      name: "Toyota Hilux",
      detail: "SRV 2.8 4x4 AT · 2025",
      price: "USD 49.900",
      km: "0 km",
      status: "available",
      statusLabel: "Disponible",
    });
  });

  it("sin precio ni km: sin dato, nunca inventado", () => {
    expect(
      linkedVehicleCard({
        id: HILUX,
        brand: "Hyundai",
        model: "HB20",
        year: 2019,
        price: null,
        status: "reserved",
      }),
    ).toMatchObject({
      detail: "2019",
      price: null,
      km: null,
      statusLabel: "Reservado",
    });
  });
});
