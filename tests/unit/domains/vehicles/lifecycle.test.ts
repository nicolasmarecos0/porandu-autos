import { describe, expect, it } from "vitest";

import {
  canTransitionVehicle,
  catalogTransitionFor,
  isStockTransitionId,
  isTerminalVehicleStatus,
  isVehicleTransitionId,
  optimisticStatusOf,
  planVehicleSale,
  planVehicleStatusChange,
  SALE_NOTICE_TEXT,
  SALE_REQUIRES_CLOSURE_MESSAGE,
  saleConflictMessage,
  saleNoticeFor,
  SELLABLE_VEHICLE_STATUSES,
  statusPhrase,
  STOCK_TRANSITION_IDS,
  stockTransitionFor,
  transitionBetween,
  transitionConflictMessage,
  transitionSuccessMessage,
  transitionUnchangedMessage,
  VEHICLE_CHANGE_FAILED_MESSAGE,
  VEHICLE_LIFECYCLE,
  VEHICLE_NOT_FOUND_MESSAGE,
  VEHICLE_STATUS_CHANGE_FIELDS,
  VEHICLE_TRANSITION_COPY,
  VEHICLE_TRANSITION_IDS,
  VEHICLE_TRANSITIONS,
  type StockTransitionId,
} from "@/domains/vehicles/lifecycle";
import { VEHICLE_STATUSES, type VehicleStatus } from "@/domains/vehicles/stock";

/*
 * Ciclo de vida de una unidad (Hito 19, DEC-051): la máquina de
 * estados de vehicles.status, las reglas de Stock y de la venta al cerrar
 * Ganada, las acciones de cada vista y el copy es-PY. La base exige la
 * misma matriz con el trigger vehicles_status_transition (el cruce de los
 * 16 pares está en tests/db/vehicle-lifecycle.test.ts).
 */

const STATUSES = VEHICLE_STATUSES.map(({ id }) => id);

/** Los 16 pares (origen, destino), en el orden de VEHICLE_STATUSES. */
const PAIRS = STATUSES.flatMap((from) =>
  STATUSES.map((to) => [from, to] as const),
);

/** Los pases que aprobó el fundador para el Hito 19. */
const APPROVED: readonly (readonly [VehicleStatus, VehicleStatus])[] = [
  ["inPreparation", "available"],
  ["available", "reserved"],
  ["reserved", "available"],
  ["available", "sold"],
  ["reserved", "sold"],
];

describe("máquina de estados de vehicles.status", () => {
  it("los estados son los cuatro de DEC-025 §4, en el orden del flujo", () => {
    expect(STATUSES).toEqual([
      "inPreparation",
      "available",
      "reserved",
      "sold",
    ]);
    expect(Object.keys(VEHICLE_LIFECYCLE)).toEqual(STATUSES);
  });

  it("exactamente los cinco pases aprobados existen: los 16 pares cruzados", () => {
    const allowed = PAIRS.filter(([from, to]) =>
      canTransitionVehicle(from, to),
    );
    expect(allowed).toEqual([
      ["inPreparation", "available"],
      ["available", "reserved"],
      ["available", "sold"],
      ["reserved", "available"],
      ["reserved", "sold"],
    ]);
    expect(new Set(allowed.map((pair) => pair.join("→")))).toEqual(
      new Set(APPROVED.map((pair) => pair.join("→"))),
    );
  });

  it("pedir el mismo estado no es un pase", () => {
    for (const status of STATUSES) {
      expect(canTransitionVehicle(status, status)).toBe(false);
    }
  });

  it("sin saltos ni vuelta atrás: de preparación no se reserva ni se vende, y nada vuelve a preparación", () => {
    expect(canTransitionVehicle("inPreparation", "reserved")).toBe(false);
    expect(canTransitionVehicle("inPreparation", "sold")).toBe(false);
    for (const from of STATUSES) {
      expect(canTransitionVehicle(from, "inPreparation")).toBe(false);
    }
  });

  it("vendida es terminal: no se vuelve a vender, reservar, liberar ni preparar", () => {
    expect(isTerminalVehicleStatus("sold")).toBe(true);
    expect(VEHICLE_LIFECYCLE.sold).toEqual([]);
    for (const to of STATUSES) {
      expect(canTransitionVehicle("sold", to)).toBe(false);
    }
    for (const status of ["inPreparation", "available", "reserved"] as const) {
      expect(isTerminalVehicleStatus(status)).toBe(false);
    }
  });

  it("la matriz y las transiciones con nombre dicen lo mismo", () => {
    const named = VEHICLE_TRANSITION_IDS.flatMap((id) =>
      VEHICLE_TRANSITIONS[id].from.map(
        (from) => `${from}→${VEHICLE_TRANSITIONS[id].to}`,
      ),
    );
    const matrix = PAIRS.filter(([from, to]) =>
      canTransitionVehicle(from, to),
    ).map(([from, to]) => `${from}→${to}`);
    expect(new Set(named)).toEqual(new Set(matrix));
    expect(named).toHaveLength(matrix.length);
    for (const id of VEHICLE_TRANSITION_IDS) {
      expect(VEHICLE_TRANSITIONS[id].id).toBe(id);
    }
  });

  it("cada pase tiene una sola transición con nombre", () => {
    expect(
      PAIRS.map(([from, to]) => [from, to, transitionBetween(from, to)]),
    ).toEqual(
      PAIRS.map(([from, to]) => [
        from,
        to,
        (
          {
            "inPreparation→available": "put_on_floor",
            "available→reserved": "reserve",
            "reserved→available": "release",
            "available→sold": "sell",
            "reserved→sold": "sell",
          } as Record<string, string>
        )[`${from}→${to}`] ?? null,
      ]),
    );
  });

  it("vender es solo del cierre; poner en salón, reservar y liberar, de Stock", () => {
    expect(
      VEHICLE_TRANSITION_IDS.map((id) => [id, VEHICLE_TRANSITIONS[id].channel]),
    ).toEqual([
      ["put_on_floor", "stock"],
      ["reserve", "stock"],
      ["release", "stock"],
      ["sell", "closure"],
    ]);
    expect(STOCK_TRANSITION_IDS).toEqual([
      "put_on_floor",
      "reserve",
      "release",
    ]);
    expect(SELLABLE_VEHICLE_STATUSES).toEqual(["available", "reserved"]);
  });
});

describe("pedido de Stock: input no confiable", () => {
  it("el pedido solo identifica la unidad y la transición", () => {
    expect(VEHICLE_STATUS_CHANGE_FIELDS).toEqual({
      vehicleId: "vehicleId",
      transition: "transition",
    });
  });

  it.each([
    ["put_on_floor", true, true],
    ["reserve", true, true],
    ["release", true, true],
    ["sell", true, false],
    ["available", false, false],
    ["sold", false, false],
    ["PUT_ON_FLOOR", false, false],
    ["", false, false],
    [" reserve", false, false],
    [null, false, false],
    [42, false, false],
  ] as const)("%j: transición %s, de Stock %s", (value, known, stock) => {
    expect(isVehicleTransitionId(value)).toBe(known);
    expect(isStockTransitionId(value)).toBe(stock);
  });
});

describe("planVehicleStatusChange(): sobre la fila bloqueada", () => {
  it.each([
    ["put_on_floor", "inPreparation", "available"],
    ["reserve", "available", "reserved"],
    ["release", "reserved", "available"],
  ] as const)("%s desde %s escribe el pase a %s", (transition, from, to) => {
    expect(planVehicleStatusChange(from, transition)).toEqual({
      kind: "change",
      transition,
      from,
      to,
    });
  });

  it.each([
    ["put_on_floor", "available"],
    ["reserve", "reserved"],
    ["release", "available"],
  ] as const)(
    "%s cuando la unidad ya está %s es idempotente: unchanged",
    (transition, status) => {
      expect(planVehicleStatusChange(status, transition)).toEqual({
        kind: "unchanged",
        transition,
        status,
      });
    },
  );

  it("un pedido viejo no deshace lo que hizo otra persona: conflicto con el estado real", () => {
    // Alguien la puso en el salón y otro la reservó: "poner en salón" no la
    // libera.
    expect(planVehicleStatusChange("reserved", "put_on_floor")).toEqual({
      kind: "conflict",
      transition: "put_on_floor",
      current: "reserved",
    });
    // Liberar una que ya no está reservada (o nunca lo estuvo).
    expect(planVehicleStatusChange("inPreparation", "release")).toEqual({
      kind: "conflict",
      transition: "release",
      current: "inPreparation",
    });
    // Reservar una en preparación: sin saltos.
    expect(planVehicleStatusChange("inPreparation", "reserve")).toEqual({
      kind: "conflict",
      transition: "reserve",
      current: "inPreparation",
    });
  });

  it.each(STOCK_TRANSITION_IDS)(
    "una unidad vendida no acepta %s: conflicto, nunca un pase",
    (transition) => {
      expect(planVehicleStatusChange("sold", transition)).toEqual({
        kind: "conflict",
        transition,
        current: "sold",
      });
    },
  );

  it.each(STATUSES)(
    "vender desde Stock no existe, aunque la unidad esté %s: sale_requires_closure",
    (current) => {
      expect(planVehicleStatusChange(current, "sell")).toEqual({
        kind: "sale_requires_closure",
        current,
      });
    },
  );

  it("todo plan `change` es un pase de la máquina", () => {
    for (const status of STATUSES) {
      for (const transition of VEHICLE_TRANSITION_IDS) {
        const plan = planVehicleStatusChange(status, transition);
        if (plan.kind === "change") {
          expect(canTransitionVehicle(plan.from, plan.to)).toBe(true);
          expect(VEHICLE_TRANSITIONS[transition].channel).toBe("stock");
        }
      }
    }
  });
});

describe("planVehicleSale(): la unidad vinculada al ganar", () => {
  it.each(["available", "reserved"] as const)(
    "una unidad %s se vende en el cierre",
    (status) => {
      expect(planVehicleSale(status)).toEqual({ kind: "sell", from: status });
      expect(canTransitionVehicle(status, "sold")).toBe(true);
    },
  );

  it("una ya vendida es un conflicto: no se vende dos veces", () => {
    expect(planVehicleSale("sold")).toEqual({
      kind: "conflict",
      current: "sold",
      reason: "already_sold",
    });
  });

  it("una en preparación es un conflicto: primero va al salón", () => {
    expect(planVehicleSale("inPreparation")).toEqual({
      kind: "conflict",
      current: "inPreparation",
      reason: "in_preparation",
    });
  });
});

describe("acciones de cada vista", () => {
  it("Inventario: una acción rápida por estado, ninguna para una vendida", () => {
    expect(
      STATUSES.map((status) => [status, stockTransitionFor(status)]),
    ).toEqual([
      ["inPreparation", "put_on_floor"],
      ["available", "reserve"],
      ["reserved", "release"],
      ["sold", null],
    ]);
  });

  it("catálogo: reservar o liberar, nunca poner en salón ni vender", () => {
    expect(
      STATUSES.map((status) => [status, catalogTransitionFor(status)]),
    ).toEqual([
      ["inPreparation", null],
      ["available", "reserve"],
      ["reserved", "release"],
      ["sold", null],
    ]);
  });

  it("la acción ofrecida siempre es un pase válido desde ese estado", () => {
    for (const status of STATUSES) {
      for (const transition of [
        stockTransitionFor(status),
        catalogTransitionFor(status),
      ]) {
        if (transition === null) continue;
        expect(planVehicleStatusChange(status, transition).kind).toBe("change");
      }
    }
  });

  it("mientras guarda se muestra el destino", () => {
    expect(STOCK_TRANSITION_IDS.map(optimisticStatusOf)).toEqual([
      "available",
      "reserved",
      "available",
    ]);
  });

  it("el aviso de la confirmación Ganada: pasa a vendida o por qué no puede", () => {
    expect(saleNoticeFor("available")).toEqual({
      kind: "will_sell",
      from: "available",
      to: "sold",
    });
    expect(saleNoticeFor("reserved")).toEqual({
      kind: "will_sell",
      from: "reserved",
      to: "sold",
    });
    expect(saleNoticeFor("sold")).toEqual({
      kind: "conflict",
      current: "sold",
      reason: "already_sold",
      message: saleConflictMessage("already_sold"),
    });
    expect(saleNoticeFor("inPreparation")).toMatchObject({
      kind: "conflict",
      reason: "in_preparation",
    });
  });
});

describe("copy es-PY", () => {
  it("los nombres que pidió el fundador", () => {
    expect(
      STOCK_TRANSITION_IDS.map((id) => VEHICLE_TRANSITION_COPY[id].label),
    ).toEqual(["Poner en salón", "Reservar unidad", "Liberar reserva"]);
    expect(
      STOCK_TRANSITION_IDS.map((id) => VEHICLE_TRANSITION_COPY[id].short),
    ).toEqual(["Poner en salón", "Reservar", "Liberar"]);
  });

  it("cada confirmación tiene título, consecuencia y botón", () => {
    for (const id of STOCK_TRANSITION_IDS) {
      const copy = VEHICLE_TRANSITION_COPY[id];
      expect(copy.title.length).toBeGreaterThan(0);
      expect(copy.description).toMatch(/\.$/);
      expect(copy.confirm.length).toBeGreaterThan(0);
    }
  });

  it("los estados en una oración, en femenino como la unidad", () => {
    expect(STATUSES.map(statusPhrase)).toEqual([
      "en preparación",
      "disponible",
      "reservada",
      "vendida",
    ]);
  });

  const UNIT = "Toyota Hilux 2025";

  it.each([
    [
      "put_on_floor",
      "Toyota Hilux 2025 ya está en el salón: disponible para vender.",
    ],
    [
      "reserve",
      "Toyota Hilux 2025 quedó reservada. Para volver a ofrecerla, liberá la reserva.",
    ],
    [
      "release",
      "Se liberó la reserva de Toyota Hilux 2025: está disponible para vender.",
    ],
  ] as [StockTransitionId, string][])("éxito de %s", (transition, message) => {
    expect(transitionSuccessMessage(transition, UNIT)).toBe(message);
  });

  it("unchanged dice el estado real y que no cambió nada", () => {
    expect(transitionUnchangedMessage("reserved", UNIT)).toBe(
      "Toyota Hilux 2025 ya estaba reservada. No se hizo ningún cambio.",
    );
  });

  it("un conflicto dice qué se intentó, el estado real y que no cambió nada", () => {
    expect(transitionConflictMessage("reserve", "sold", UNIT)).toBe(
      "No se pudo reservar: Toyota Hilux 2025 ya está vendida y una venta no se deshace. No se hizo ningún cambio.",
    );
    expect(transitionConflictMessage("put_on_floor", "reserved", UNIT)).toBe(
      "No se pudo poner en el salón: Toyota Hilux 2025 está reservada. No se hizo ningún cambio.",
    );
    expect(transitionConflictMessage("release", "available", UNIT)).toBe(
      "No se pudo liberar la reserva: Toyota Hilux 2025 está disponible. No se hizo ningún cambio.",
    );
  });

  it("los avisos de falla nunca exponen la base y dicen que no cambió nada", () => {
    for (const message of [
      SALE_REQUIRES_CLOSURE_MESSAGE,
      VEHICLE_NOT_FOUND_MESSAGE,
      VEHICLE_CHANGE_FAILED_MESSAGE,
    ]) {
      expect(message).toMatch(/No se hizo ningún cambio/);
      expect(message).not.toMatch(/sql|23514|constraint|vehicles_/i);
    }
  });

  it("los conflictos de la venta nombran el estado del stock y qué hacer", () => {
    expect(saleConflictMessage("already_sold")).toMatch(
      /ya figura como Vendida.*Vinculá otra unidad/,
    );
    expect(saleConflictMessage("in_preparation")).toMatch(
      /En preparación.*ponela en el salón/,
    );
    expect(SALE_NOTICE_TEXT).toMatch(/«Vendida» en el stock/);
  });
});
