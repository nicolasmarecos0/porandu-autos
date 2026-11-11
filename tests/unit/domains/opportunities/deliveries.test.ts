import { describe, expect, it } from "vitest";

import {
  canTransitionDelivery,
  checklistIncompleteMessage,
  checklistItemsPhrase,
  checklistProgress,
  COMPLETE_DELIVERY_LABEL,
  DELIVERY_ALREADY_COMPLETED_MESSAGE,
  DELIVERY_CHECKLIST_COPY,
  DELIVERY_CHECKLIST_FIELDS,
  DELIVERY_CHECKLIST_ITEMS,
  DELIVERY_COMPLETION_FIELDS,
  DELIVERY_FAILED_MESSAGE,
  DELIVERY_NOT_FOUND_MESSAGE,
  DELIVERY_PANEL_TITLE,
  DELIVERY_RECORD_STATUS_LABELS,
  DELIVERY_RECORD_STATUSES,
  DELIVERY_SCHEDULE_FIELDS,
  DELIVERY_TRANSITIONS,
  deliveryCompletedMessage,
  deliveryVehicleConflictMessage,
  EMPTY_DELIVERY_CHECKLIST,
  isChecklistVerified,
  isDeliveryChecklistItem,
  isDeliveryRecordStatus,
  missingChecklistItems,
  parseDeliveryScheduledAt,
  planDeliveryChecklistChange,
  planDeliveryCompletion,
  planDeliveryReschedule,
  planDeliverySchedule,
  VERIFIED_DELIVERY_CHECKLIST,
  withChecklistItem,
  type DeliveryTarget,
} from "@/domains/opportunities/deliveries";
import { OPPORTUNITY_STAGES } from "@/domains/opportunities/stages";
import { VEHICLE_STATUSES } from "@/domains/vehicles/stock";

/*
 * Logística y entregas (Hito 21, DEC-053): la matriz de la entrega, el
 * checklist físico, las reglas del fundador (solo se programa con la
 * oportunidad Ganada y la unidad Vendida; no se completa sin el checklist
 * entero), los planes sobre las filas bloqueadas y el copy es-PY. La base
 * exige lo mismo con su trigger y sus CHECKs (tests/db/deliveries.test.ts).
 */

const NOW = new Date("2026-11-11T13:00:00.000Z"); // 10:00 en Asunción.

function target(overrides: Partial<DeliveryTarget> = {}): DeliveryTarget {
  return {
    status: "pending",
    scheduledAt: new Date("2026-11-13T13:30:00.000Z"),
    checklist: EMPTY_DELIVERY_CHECKLIST,
    ...overrides,
  };
}

describe("estados y matriz", () => {
  it("pendiente y completada, con su copy en femenino", () => {
    expect(DELIVERY_RECORD_STATUSES).toEqual(["pending", "completed"]);
    expect(DELIVERY_RECORD_STATUS_LABELS).toEqual({
      pending: "Entrega programada",
      completed: "Entregada",
    });
  });

  it("una pendiente se completa; una completada es terminal; quedarse no es un pase", () => {
    expect(DELIVERY_TRANSITIONS).toEqual({
      pending: ["completed"],
      completed: [],
    });
    const pairs = DELIVERY_RECORD_STATUSES.flatMap((from) =>
      DELIVERY_RECORD_STATUSES.map((to) => [from, to] as const),
    );
    expect(
      pairs.filter(([from, to]) => canTransitionDelivery(from, to)),
    ).toEqual([["pending", "completed"]]);
  });

  it.each([
    ["pending", true],
    ["completed", true],
    ["delivered", false],
    ["scheduled", false],
    ["", false],
    [null, false],
  ] as const)("%j es un estado: %s", (value, known) => {
    expect(isDeliveryRecordStatus(value)).toBe(known);
  });
});

describe("checklist físico", () => {
  it("llaves, manuales, auxilio, limpieza y documentos, en ese orden y con su copy", () => {
    expect(DELIVERY_CHECKLIST_ITEMS).toEqual([
      "keys",
      "manuals",
      "spareTire",
      "cleaning",
      "documents",
    ]);
    expect(
      DELIVERY_CHECKLIST_ITEMS.map(
        (item) => DELIVERY_CHECKLIST_COPY[item].label,
      ),
    ).toEqual([
      "Llaves",
      "Manuales",
      "Rueda de auxilio",
      "Limpieza",
      "Documentos",
    ]);
    for (const item of DELIVERY_CHECKLIST_ITEMS) {
      expect(DELIVERY_CHECKLIST_COPY[item].hint).toMatch(/\.$/);
    }
  });

  it("nace sin nada verificado; completar exige todo", () => {
    expect(Object.values(EMPTY_DELIVERY_CHECKLIST)).toEqual(
      Array(5).fill(false),
    );
    expect(isChecklistVerified(EMPTY_DELIVERY_CHECKLIST)).toBe(false);
    expect(isChecklistVerified(VERIFIED_DELIVERY_CHECKLIST)).toBe(true);
    const almost = withChecklistItem(
      VERIFIED_DELIVERY_CHECKLIST,
      "documents",
      false,
    );
    expect(isChecklistVerified(almost)).toBe(false);
    expect(missingChecklistItems(almost)).toEqual(["documents"]);
    expect(checklistProgress(almost)).toEqual({ done: 4, total: 5 });
    expect(checklistProgress(EMPTY_DELIVERY_CHECKLIST)).toEqual({
      done: 0,
      total: 5,
    });
  });

  it("withChecklistItem no muta el checklist", () => {
    const next = withChecklistItem(EMPTY_DELIVERY_CHECKLIST, "keys", true);
    expect(next.keys).toBe(true);
    expect(EMPTY_DELIVERY_CHECKLIST.keys).toBe(false);
  });

  it.each([
    ["keys", true],
    ["spareTire", true],
    ["spare_tire", false],
    ["KEYS", false],
    ["", false],
    [undefined, false],
  ] as const)("%j es un ítem: %s", (value, known) => {
    expect(isDeliveryChecklistItem(value)).toBe(known);
  });
});

describe("fecha pactada: input no confiable, hora de Asunción", () => {
  it("una fecha y hora válidas, desde ahora hasta el horizonte", () => {
    expect(parseDeliveryScheduledAt("2026-11-13T10:30", NOW)).toEqual({
      ok: true,
      scheduledAt: new Date("2026-11-13T13:30:00.000Z"),
    });
  });

  it.each([
    ["", "required"],
    ["   ", "required"],
    ["13/11/2026 10:30", "invalid"],
    ["2026-02-30T10:00", "invalid"],
    ["2026-11-13T25:00", "invalid"],
    ["2026-11-10T10:00", "in_the_past"],
    ["2027-12-01T10:00", "too_far"],
  ] as const)("%j → %s", (raw, error) => {
    expect(parseDeliveryScheduledAt(raw, NOW)).toEqual({ ok: false, error });
  });

  it("el pedido no trae organización, unidad, estado ni sello", () => {
    expect(DELIVERY_SCHEDULE_FIELDS).toEqual({
      opportunityId: "opportunityId",
      scheduledAt: "scheduledAt",
    });
    expect(DELIVERY_CHECKLIST_FIELDS).toEqual({
      deliveryId: "deliveryId",
      item: "item",
      checked: "checked",
    });
    expect(DELIVERY_COMPLETION_FIELDS).toEqual({ deliveryId: "deliveryId" });
  });
});

describe("planDeliverySchedule(): solo una ganada con su unidad vendida, una vez", () => {
  it("ganada con la unidad vendida: se programa con esa unidad", () => {
    expect(
      planDeliverySchedule({
        stage: "won",
        vehicleId: "v1",
        vehicleStatus: "sold",
        delivery: null,
      }),
    ).toEqual({ kind: "schedule", vehicleId: "v1" });
  });

  it.each(OPPORTUNITY_STAGES.filter((stage) => stage !== "won"))(
    "con la oportunidad %s no hay venta que entregar",
    (stage) => {
      expect(
        planDeliverySchedule({
          stage,
          vehicleId: "v1",
          vehicleStatus: "available",
          delivery: null,
        }),
      ).toEqual({ kind: "opportunity_not_won", stage });
    },
  );

  it.each(VEHICLE_STATUSES.map(({ id }) => id).filter((s) => s !== "sold"))(
    "una unidad %s no se entrega",
    (status) => {
      expect(
        planDeliverySchedule({
          stage: "won",
          vehicleId: "v1",
          vehicleStatus: status,
          delivery: null,
        }),
      ).toEqual({
        kind: "vehicle_conflict",
        current: status,
        reason: status === "delivered" ? "already_delivered" : "not_sold",
      });
    },
  );

  it("ya programada: se reprograma o se completa esa", () => {
    expect(
      planDeliverySchedule({
        stage: "won",
        vehicleId: "v1",
        vehicleStatus: "sold",
        delivery: { id: "d1", status: "pending" },
      }),
    ).toEqual({
      kind: "already_scheduled",
      deliveryId: "d1",
      status: "pending",
    });
  });

  it("sin unidad vinculada no hay qué entregar", () => {
    expect(
      planDeliverySchedule({
        stage: "won",
        vehicleId: null,
        vehicleStatus: null,
        delivery: null,
      }),
    ).toEqual({ kind: "vehicle_required" });
  });
});

describe("planes sobre la entrega bloqueada", () => {
  it("reprogramar una pendiente; misma fecha es unchanged; una completada no se reprograma", () => {
    const later = new Date("2026-11-14T13:00:00.000Z");
    expect(planDeliveryReschedule(target(), later)).toEqual({
      kind: "reschedule",
      scheduledAt: later,
    });
    expect(
      planDeliveryReschedule(target(), new Date("2026-11-13T13:30:00.000Z")),
    ).toEqual({ kind: "unchanged" });
    expect(
      planDeliveryReschedule(target({ status: "completed" }), later),
    ).toEqual({ kind: "already_completed" });
  });

  it("tildar cambia solo ese ítem, sobre el checklist leído", () => {
    const current = target({
      checklist: withChecklistItem(EMPTY_DELIVERY_CHECKLIST, "manuals", true),
    });
    expect(planDeliveryChecklistChange(current, "keys", true)).toEqual({
      kind: "change",
      checklist: { ...EMPTY_DELIVERY_CHECKLIST, manuals: true, keys: true },
    });
    expect(planDeliveryChecklistChange(current, "manuals", true)).toEqual({
      kind: "unchanged",
      checklist: current.checklist,
    });
    expect(
      planDeliveryChecklistChange(
        target({ status: "completed" }),
        "keys",
        false,
      ),
    ).toEqual({ kind: "already_completed" });
  });

  it("la regla del fundador: sin el checklist entero, no se completa", () => {
    expect(planDeliveryCompletion(target(), "sold")).toEqual({
      kind: "checklist_incomplete",
      missing: [...DELIVERY_CHECKLIST_ITEMS],
    });
    expect(
      planDeliveryCompletion(
        target({
          checklist: withChecklistItem(
            VERIFIED_DELIVERY_CHECKLIST,
            "spareTire",
            false,
          ),
        }),
        "sold",
      ),
    ).toEqual({ kind: "checklist_incomplete", missing: ["spareTire"] });
  });

  it("todo verificado y la unidad vendida: se completa", () => {
    expect(
      planDeliveryCompletion(
        target({ checklist: VERIFIED_DELIVERY_CHECKLIST }),
        "sold",
      ),
    ).toEqual({ kind: "complete" });
  });

  it("la unidad que ya no está Vendida en el salón: conflicto, nada cambia", () => {
    const verified = target({ checklist: VERIFIED_DELIVERY_CHECKLIST });
    expect(planDeliveryCompletion(verified, "delivered")).toEqual({
      kind: "vehicle_conflict",
      current: "delivered",
      reason: "already_delivered",
    });
    expect(planDeliveryCompletion(verified, "reserved")).toEqual({
      kind: "vehicle_conflict",
      current: "reserved",
      reason: "not_sold",
    });
  });

  it("completada: idempotente, antes que cualquier otra regla", () => {
    expect(
      planDeliveryCompletion(target({ status: "completed" }), "delivered"),
    ).toEqual({ kind: "already_completed" });
  });
});

describe("copy es-PY", () => {
  it("los nombres que pidió el fundador", () => {
    expect(DELIVERY_PANEL_TITLE).toBe("Coordinación de Entrega");
    expect(COMPLETE_DELIVERY_LABEL).toBe(
      "Completar Entrega y Dar Salida al Vehículo",
    );
  });

  it("lo que falta verificar, en una frase", () => {
    expect(checklistItemsPhrase(["keys"])).toBe("llaves");
    expect(checklistItemsPhrase(["keys", "documents"])).toBe(
      "llaves y documentos",
    );
    expect(checklistIncompleteMessage(["keys", "manuals", "cleaning"])).toBe(
      "Falta verificar llaves, manuales y limpieza. La entrega no se completa sin el checklist entero.",
    );
  });

  it("la entrega completada nombra la unidad y la salida del salón", () => {
    expect(deliveryCompletedMessage("Toyota Hilux 2025")).toBe(
      "Entrega completada: Toyota Hilux 2025 salió del salón y ya no figura en el stock.",
    );
  });

  it("los avisos de falla nunca exponen la base y dicen que no cambió nada", () => {
    for (const message of [
      deliveryVehicleConflictMessage("not_sold"),
      deliveryVehicleConflictMessage("already_delivered"),
      DELIVERY_ALREADY_COMPLETED_MESSAGE,
      DELIVERY_NOT_FOUND_MESSAGE,
      DELIVERY_FAILED_MESSAGE,
    ]) {
      expect(message).toMatch(/No se hizo ningún cambio/);
      expect(message).not.toMatch(/sql|23514|constraint|deliveries_/i);
    }
  });
});
