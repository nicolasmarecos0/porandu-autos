import { describe, expect, it } from "vitest";

import {
  advanceReadCursor,
  countUnread,
  effectiveReadUpTo,
  firstUnreadId,
  isUnread,
  NO_READ_CURSOR,
  parseMarkRead,
  unreadState,
  type ReadableMessage,
} from "@/domains/conversations/read-state";

/*
 * Leído y no leído de la bandeja (Hito 12, DEC-044 §2): cursor por miembro,
 * medido con el reloj de la base, que solo avanza; responder es leer.
 */

const at = (iso: string) => new Date(iso);

function inbound(id: string, createdAt: string): ReadableMessage {
  return { id, direction: "inbound", createdAt: at(createdAt) };
}

function outbound(id: string, createdAt: string): ReadableMessage {
  return { id, direction: "outbound", createdAt: at(createdAt) };
}

const CONVERSATION = "00000000-0000-4000-8000-0000000000c1";
const MESSAGE = "00000000-0000-4000-8000-0000000000a1";

describe("isUnread", () => {
  it("sin cursor ni respuesta propia, todo entrante está sin leer", () => {
    expect(
      isUnread(inbound("m1", "2026-10-29T15:00:00Z"), NO_READ_CURSOR),
    ).toBe(true);
  });

  it("lo que envía el equipo nunca está sin leer", () => {
    expect(
      isUnread(outbound("m1", "2026-10-29T15:00:00Z"), NO_READ_CURSOR),
    ).toBe(false);
  });

  it("se mide por el registro (created_at): un entrante registrado después del cursor sigue sin leer", () => {
    const cursor = {
      readUpTo: at("2026-10-29T15:00:00Z"),
      lastOwnReplyAt: null,
    };
    expect(isUnread(inbound("m1", "2026-10-29T15:00:00Z"), cursor)).toBe(false);
    expect(isUnread(inbound("m2", "2026-10-29T15:00:01Z"), cursor)).toBe(true);
  });

  it("responder es leer: la última respuesta propia también es cursor", () => {
    const cursor = {
      readUpTo: at("2026-10-29T14:00:00Z"),
      lastOwnReplyAt: at("2026-10-29T15:00:00Z"),
    };
    expect(effectiveReadUpTo(cursor)).toEqual(at("2026-10-29T15:00:00Z"));
    expect(isUnread(inbound("m1", "2026-10-29T14:30:00Z"), cursor)).toBe(false);
    expect(isUnread(inbound("m2", "2026-10-29T15:30:00Z"), cursor)).toBe(true);
  });
});

describe("advanceReadCursor", () => {
  it("solo avanza: marcar un mensaje más viejo no cambia el cursor", () => {
    const later = at("2026-10-29T15:00:00Z");
    const earlier = at("2026-10-29T14:00:00Z");
    expect(advanceReadCursor(null, earlier)).toBe(earlier);
    expect(advanceReadCursor(earlier, later)).toBe(later);
    expect(advanceReadCursor(later, earlier)).toBe(later);
  });
});

describe("countUnread y firstUnreadId", () => {
  const messages = [
    inbound("m1", "2026-10-29T14:00:00Z"),
    outbound("m2", "2026-10-29T14:05:00Z"),
    // Entregado tarde por el proveedor: viejo en el chat, nuevo para el vendedor.
    inbound("late", "2026-10-29T15:10:00Z"),
    inbound("m3", "2026-10-29T15:05:00Z"),
  ];
  const cursor = { readUpTo: at("2026-10-29T15:00:00Z"), lastOwnReplyAt: null };

  it("cuenta solo los entrantes registrados después del cursor", () => {
    expect(countUnread(messages, cursor)).toBe(2);
    expect(countUnread(messages, NO_READ_CURSOR)).toBe(3);
  });

  it("el separador de mensajes nuevos va antes del primero sin leer, en el orden del chat", () => {
    expect(firstUnreadId(messages, cursor)).toBe("late");
    expect(
      firstUnreadId(messages, {
        readUpTo: at("2026-10-29T16:00:00Z"),
        lastOwnReplyAt: null,
      }),
    ).toBeNull();
  });
});

describe("unreadState", () => {
  it("sin no leídos no hay contador", () => {
    expect(unreadState(0)).toEqual({ kind: "read" });
    expect(unreadState(-1)).toEqual({ kind: "read" });
    expect(unreadState(Number.NaN)).toEqual({ kind: "read" });
  });

  it("el contador se abrevia desde 100 y se describe en texto", () => {
    expect(unreadState(1)).toEqual({
      kind: "unread",
      count: 1,
      label: "1",
      description: "1 mensaje sin leer",
    });
    expect(unreadState(3)).toMatchObject({
      label: "3",
      description: "3 mensajes sin leer",
    });
    expect(unreadState(99)).toMatchObject({ label: "99" });
    expect(unreadState(1500)).toMatchObject({
      label: "99+",
      description: "1.500 mensajes sin leer",
    });
  });
});

describe("parseMarkRead", () => {
  it("acepta la conversación y el mensaje, normalizados, e ignora el resto", () => {
    expect(
      parseMarkRead({
        conversationId: ` ${CONVERSATION.toUpperCase()} `,
        upToMessageId: MESSAGE,
        organizationId: "otra",
        readAt: "2026-10-29T15:00:00Z",
      }),
    ).toEqual({ conversationId: CONVERSATION, upToMessageId: MESSAGE });
  });

  it("un pedido inválido es null, sin errores por campo", () => {
    expect(parseMarkRead(null)).toBeNull();
    expect(parseMarkRead({ conversationId: CONVERSATION })).toBeNull();
    expect(
      parseMarkRead({ conversationId: "c1", upToMessageId: MESSAGE }),
    ).toBeNull();
  });
});
