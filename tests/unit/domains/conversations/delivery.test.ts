import { describe, expect, it } from "vitest";

import {
  currentDeliveryStatus,
  DELIVERY_STATUS_LABELS,
  DELIVERY_STATUSES,
  INITIAL_DELIVERY_STATUS,
  isDeliveryStatus,
  type DeliveryStatus,
} from "@/domains/conversations/delivery";

/*
 * Estado de entrega de un saliente (Hito 12, DEC-044 §3): el vigente es el
 * de mayor precedencia entre los recibidos, sin importar el orden de
 * llegada ni las repeticiones.
 */

function permutations<T>(items: readonly T[]): T[][] {
  if (items.length <= 1) return [[...items]];
  return items.flatMap((item, index) =>
    permutations([...items.slice(0, index), ...items.slice(index + 1)]).map(
      (rest) => [item, ...rest],
    ),
  );
}

describe("currentDeliveryStatus", () => {
  it("sin estados recibidos, el saliente está enviado: Meta lo aceptó antes de registrarlo", () => {
    expect(INITIAL_DELIVERY_STATUS).toBe("sent");
    expect(currentDeliveryStatus([])).toBe("sent");
  });

  it("avanza enviado → entregado → leído", () => {
    expect(currentDeliveryStatus(["sent"])).toBe("sent");
    expect(currentDeliveryStatus(["sent", "delivered"])).toBe("delivered");
    expect(currentDeliveryStatus(["sent", "delivered", "read"])).toBe("read");
  });

  it("no depende del orden de llegada ni de las repeticiones", () => {
    const received: DeliveryStatus[] = ["sent", "delivered", "read", "read"];
    for (const order of permutations(received)) {
      expect(currentDeliveryStatus(order), order.join(",")).toBe("read");
    }
  });

  it("una falla solo pisa a un enviado: lo entregado o leído no deja de serlo", () => {
    expect(currentDeliveryStatus(["sent", "failed"])).toBe("failed");
    expect(currentDeliveryStatus(["failed", "delivered"])).toBe("delivered");
    expect(currentDeliveryStatus(["read", "failed"])).toBe("read");
  });
});

describe("isDeliveryStatus y copy", () => {
  it("reconoce solo los estados del contrato", () => {
    for (const status of DELIVERY_STATUSES) {
      expect(isDeliveryStatus(status)).toBe(true);
    }
    expect(isDeliveryStatus("deleted")).toBe(false);
    expect(isDeliveryStatus(1)).toBe(false);
  });

  it("cada estado tiene su texto es-PY", () => {
    expect(DELIVERY_STATUS_LABELS).toEqual({
      sent: "Enviado",
      delivered: "Entregado",
      read: "Leído",
      failed: "No entregado",
    });
  });
});
