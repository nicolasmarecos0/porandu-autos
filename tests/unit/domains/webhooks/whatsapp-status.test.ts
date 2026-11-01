import { describe, expect, it } from "vitest";

import {
  currentDeliveryStatus,
  DELIVERY_STATUSES,
} from "@/domains/conversations/delivery";
import {
  parseDeliveryStatusEvent,
  readDeliveryStatus,
  type DeliveryStatusEvent,
} from "@/domains/webhooks/whatsapp-status";

import { rawStatus, TEST_LINE_ID } from "../../support/whatsapp-payload";

/*
 * Estados de entrega del webhook de la WhatsApp Cloud API (Hito 12C, DEC-044
 * §3.3): cada `statuses[]` del payload se traduce al contrato propio, se
 * ignora si no es uno de los cuatro estados del contrato o se descarta si
 * tiene un campo inválido. El vigente lo decide la precedencia de
 * domains/conversations/delivery.ts, sin importar el orden de llegada.
 */

const AT = 1_792_600_000;

function event(
  overrides: Partial<DeliveryStatusEvent> = {},
): DeliveryStatusEvent {
  return {
    lineId: TEST_LINE_ID,
    externalId: "wamid.OUT00000001",
    status: "delivered",
    occurredAt: new Date(AT * 1000),
    ...overrides,
  };
}

describe("readDeliveryStatus", () => {
  it.each(DELIVERY_STATUSES)(
    "traduce un estado %s de Meta al contrato propio, con la línea del sobre",
    (status) => {
      expect(
        readDeliveryStatus(
          rawStatus({ id: "wamid.OUT00000001", status, timestamp: AT }),
          TEST_LINE_ID,
        ),
      ).toEqual(event({ status }));
    },
  );

  it("tolera campos nuevos del proveedor: un campo de más no pierde el estado", () => {
    expect(
      readDeliveryStatus(
        {
          ...rawStatus({
            id: "wamid.OUT00000001",
            status: "read",
            timestamp: AT,
          }),
          biz_opaque_callback_data: "x",
          type: "message",
        },
        TEST_LINE_ID,
      ),
    ).toEqual(event({ status: "read" }));
  });

  it("no lee recipient_id, conversation, pricing ni errors: no son parte del contrato", () => {
    const parsed = readDeliveryStatus(
      rawStatus({ id: "wamid.OUT00000001", status: "failed", timestamp: AT }),
      TEST_LINE_ID,
    );
    expect(parsed).toEqual(event({ status: "failed" }));
    expect(Object.keys(parsed as DeliveryStatusEvent).sort()).toEqual([
      "externalId",
      "lineId",
      "occurredAt",
      "status",
    ]);
  });

  it.each(["deleted", "warning", "played", "accepted"])(
    "ignora un estado del proveedor que no es del contrato (%s)",
    (status) => {
      expect(
        readDeliveryStatus(
          rawStatus({ id: "wamid.OUT00000001", status, timestamp: AT }),
          TEST_LINE_ID,
        ),
      ).toBe("ignored");
    },
  );

  it.each([
    ["sin status", { id: "wamid.OUT", timestamp: String(AT) }],
    ["status vacío", { id: "wamid.OUT", status: "", timestamp: String(AT) }],
    [
      "status en mayúsculas",
      { id: "wamid.OUT", status: "READ", timestamp: String(AT) },
    ],
    ["status que no es texto", { id: "wamid.OUT", status: 3, timestamp: "1" }],
    ["sin id", { status: "read", timestamp: String(AT) }],
    ["id vacío", { id: "", status: "read", timestamp: String(AT) }],
    [
      "id con espacios",
      { id: "wamid. x", status: "read", timestamp: String(AT) },
    ],
    [
      "id de más de 256",
      { id: `wamid.${"x".repeat(251)}`, status: "read", timestamp: String(AT) },
    ],
    ["sin timestamp", { id: "wamid.OUT", status: "read" }],
    ["timestamp numérico", { id: "wamid.OUT", status: "read", timestamp: AT }],
    [
      "timestamp con letras",
      { id: "wamid.OUT", status: "read", timestamp: "17926e5" },
    ],
    [
      "timestamp anterior a 2000",
      { id: "wamid.OUT", status: "read", timestamp: "946684799" },
    ],
    [
      "timestamp desde 2100",
      { id: "wamid.OUT", status: "read", timestamp: "4102444800" },
    ],
    ["no es un objeto", "read"],
    ["null", null],
  ])("descarta un estado con %s (invalid)", (_, raw) => {
    expect(readDeliveryStatus(raw, TEST_LINE_ID)).toBe("invalid");
  });

  it("acepta un id de exactamente 256 caracteres", () => {
    const id = `wamid.${"x".repeat(250)}`;
    expect(id).toHaveLength(256);
    expect(
      readDeliveryStatus(
        rawStatus({ id, status: "sent", timestamp: AT }),
        TEST_LINE_ID,
      ),
    ).toEqual(event({ externalId: id, status: "sent" }));
  });
});

describe("parseDeliveryStatusEvent (contrato propio)", () => {
  it("acepta un estado válido", () => {
    expect(parseDeliveryStatusEvent(event())).toEqual(event());
  });

  it.each([
    ["un campo de más", { ...event(), organizationId: "org" }],
    ["una línea con letras", event({ lineId: "line-1" })],
    ["un estado fuera del contrato", { ...event(), status: "deleted" }],
    ["un instante inválido", event({ occurredAt: new Date(Number.NaN) })],
  ])("rechaza %s", (_, candidate) => {
    expect(parseDeliveryStatusEvent(candidate)).toBeNull();
  });

  it("la organización no es parte del contrato: la decide la línea en la base", () => {
    expect(Object.keys(event())).not.toContain("organizationId");
  });
});

describe("regla estricta: un estado inferior nunca pisa uno superior", () => {
  it("un lote fuera de orden, con un No entregado tardío y repeticiones, deja el saliente Leído", () => {
    const raws = [
      rawStatus({ id: "wamid.OUT", status: "read", timestamp: AT + 30 }),
      rawStatus({ id: "wamid.OUT", status: "failed", timestamp: AT + 60 }),
      rawStatus({ id: "wamid.OUT", status: "sent", timestamp: AT }),
      rawStatus({ id: "wamid.OUT", status: "delivered", timestamp: AT + 5 }),
      rawStatus({ id: "wamid.OUT", status: "read", timestamp: AT + 30 }),
    ];
    const received = raws.flatMap((raw) => {
      const parsed = readDeliveryStatus(raw, TEST_LINE_ID);
      return typeof parsed === "string" ? [] : [parsed.status];
    });
    expect(received).toEqual(["read", "failed", "sent", "delivered", "read"]);
    expect(currentDeliveryStatus(received)).toBe("read");
  });

  it("No entregado solo vale sobre un Enviado", () => {
    expect(currentDeliveryStatus(["sent", "failed"])).toBe("failed");
    expect(currentDeliveryStatus(["failed", "sent"])).toBe("failed");
    expect(currentDeliveryStatus(["delivered", "failed"])).toBe("delivered");
  });
});
