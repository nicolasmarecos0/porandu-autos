import { describe, expect, it } from "vitest";

import {
  conversationThread,
  CUSTOMER_AUTHOR,
  EMPTY_PREVIEW,
  inboxItems,
  threadContact,
  threadRead,
  type ThreadMessageRow,
} from "@/domains/conversations/inbox";
import { NO_READ_CURSOR } from "@/domains/conversations/read-state";

/*
 * Bandeja (Hito 8, DEC-040 §1; Hito 12B, DEC-044 §2): lista de
 * conversaciones e historial listos para mostrar, puros y deterministas,
 * contra el usuario que mira (también sus no leídos).
 */

const VIEWER = "00000000-0000-4000-8000-00000000000c";
const OTHER = "00000000-0000-4000-8000-00000000000a";
/** 29 oct 2026, 15:00 de Asunción. */
const NOW = new Date("2026-10-29T18:00:00Z");

function row(overrides: Partial<ThreadMessageRow>): ThreadMessageRow {
  return {
    id: "00000000-0000-4000-8000-000000000101",
    direction: "inbound",
    content: "Hola",
    recordedBy: null,
    sentAt: new Date("2026-10-29T15:00:00Z"),
    createdAt: new Date("2026-10-29T15:00:05Z"),
    ...overrides,
  };
}

describe("inboxItems", () => {
  it("mantiene el orden de la capa de datos y arma contacto, iniciales, preview y fecha de Asunción", () => {
    expect(
      inboxItems(
        [
          {
            id: "c1",
            contactName: "Ramón Benítez",
            lastMessageAt: new Date("2026-10-29T15:32:00Z"),
            lastMessagePreview: "¿Sigue disponible?",
            unread: 2,
          },
          {
            id: "c2",
            contactName: "Contacto de WhatsApp",
            lastMessageAt: null,
            lastMessagePreview: null,
            unread: 0,
          },
        ],
        NOW,
      ),
    ).toEqual([
      {
        id: "c1",
        contactName: "Ramón Benítez",
        initials: "RB",
        preview: "¿Sigue disponible?",
        at: "29 oct 2026 12:32",
        time: "12:32",
        dateTime: "2026-10-29T15:32:00.000Z",
        unread: {
          kind: "unread",
          count: 2,
          label: "2",
          description: "2 mensajes sin leer",
        },
      },
      {
        id: "c2",
        contactName: "Contacto de WhatsApp",
        initials: "CW",
        preview: EMPTY_PREVIEW,
        at: null,
        time: null,
        dateTime: null,
        unread: { kind: "read" },
      },
    ]);
  });

  it("el contador de no leídos de quien mira: 99+ desde 100, con el texto completo", () => {
    const [many] = inboxItems(
      [
        {
          id: "c1",
          contactName: "Ana Ríos",
          lastMessageAt: new Date("2026-10-29T15:32:00Z"),
          lastMessagePreview: "Hola",
          unread: 142,
        },
      ],
      NOW,
    );
    expect(many?.unread).toEqual({
      kind: "unread",
      count: 142,
      label: "99+",
      description: "142 mensajes sin leer",
    });
  });

  it("la hora de chat depende del día de Asunción, no del de UTC", () => {
    const [yesterday, older] = inboxItems(
      [
        {
          id: "c1",
          contactName: "Ana Ríos",
          // 28 oct, 22:30 de Asunción: ya es 29 en UTC.
          lastMessageAt: new Date("2026-10-29T01:30:00Z"),
          lastMessagePreview: "Gracias",
          unread: 0,
        },
        {
          id: "c2",
          contactName: "Juan Pérez",
          lastMessageAt: new Date("2026-10-10T15:00:00Z"),
          lastMessagePreview: "Hola",
          unread: 0,
        },
      ],
      NOW,
    );
    expect(yesterday?.time).toBe("Ayer");
    expect(older?.time).toBe("10 oct");
  });
});

describe("threadContact", () => {
  it("nunca muestra el teléfono completo", () => {
    expect(threadContact("Ramón Benítez", "+595981555214")).toEqual({
      name: "Ramón Benítez",
      initials: "RB",
      maskedPhone: "+595 ··· 214",
    });
    expect(threadContact("Sin teléfono", null).maskedPhone).toBeNull();
  });
});

describe("conversationThread", () => {
  it("ordena como un chat: del más viejo al más nuevo por sent_at", () => {
    const thread = conversationThread(
      [
        row({ id: "m3", sentAt: new Date("2026-10-29T15:10:00Z") }),
        row({ id: "m1", sentAt: new Date("2026-10-29T15:00:00Z") }),
        row({ id: "m2", sentAt: new Date("2026-10-29T15:05:00Z") }),
      ],
      VIEWER,
    );
    expect(thread.map((message) => message.id)).toEqual(["m1", "m2", "m3"]);
  });

  it("a igual sent_at desempata por registro y después por id", () => {
    const at = new Date("2026-10-29T15:00:00Z");
    const thread = conversationThread(
      [
        row({
          id: "b",
          sentAt: at,
          createdAt: new Date("2026-10-29T15:00:09Z"),
        }),
        row({
          id: "c",
          sentAt: at,
          createdAt: new Date("2026-10-29T15:00:01Z"),
        }),
        row({
          id: "a",
          sentAt: at,
          createdAt: new Date("2026-10-29T15:00:09Z"),
        }),
      ],
      VIEWER,
    );
    expect(thread.map((message) => message.id)).toEqual(["c", "a", "b"]);
  });

  it("distingue entrantes y salientes: Cliente, Vos u Otro miembro, sin ids de usuario", () => {
    const thread = conversationThread(
      [
        row({ id: "in", content: "Hola" }),
        row({
          id: "mine",
          direction: "outbound",
          recordedBy: VIEWER,
          content: "Buenas",
          sentAt: new Date("2026-10-29T15:01:00Z"),
        }),
        row({
          id: "theirs",
          direction: "outbound",
          recordedBy: OTHER,
          content: "Te paso precio",
          sentAt: new Date("2026-10-29T15:02:00Z"),
        }),
      ],
      VIEWER,
    );
    expect(thread).toEqual([
      {
        id: "in",
        direction: "inbound",
        body: "Hola",
        author: CUSTOMER_AUTHOR,
        at: "29 oct 2026 12:00",
      },
      {
        id: "mine",
        direction: "outbound",
        body: "Buenas",
        author: "Vos",
        at: "29 oct 2026 12:01",
      },
      {
        id: "theirs",
        direction: "outbound",
        body: "Te paso precio",
        author: "Otro miembro",
        at: "29 oct 2026 12:02",
      },
    ]);
    expect(JSON.stringify(thread)).not.toContain(VIEWER);
    expect(JSON.stringify(thread)).not.toContain(OTHER);
  });

  it("sin sent_at usa el registro (no ocurre en una conversación, pero no falla)", () => {
    const [message] = conversationThread(
      [row({ sentAt: null, createdAt: new Date("2026-10-29T15:00:00Z") })],
      VIEWER,
    );
    expect(message?.at).toBe("29 oct 2026 12:00");
  });
});

describe("threadRead (Hito 12B, DEC-044 §2)", () => {
  const read = (
    id: string,
    at: string,
    overrides: Partial<ThreadMessageRow> = {},
  ) =>
    row({
      id,
      sentAt: new Date(at),
      createdAt: new Date(at),
      ...overrides,
    });

  it("sin cursor ni respuesta propia, todo entrante está sin leer y el separador va antes del primero, en el orden del chat", () => {
    expect(
      threadRead(
        [
          read("in-2", "2026-10-29T15:02:00Z"),
          read("in-1", "2026-10-29T15:01:00Z"),
          read("out", "2026-10-29T15:03:00Z", {
            direction: "outbound",
            recordedBy: OTHER,
          }),
        ],
        NO_READ_CURSOR,
      ),
    ).toEqual({ unread: 2, firstUnreadId: "in-1", upToMessageId: "out" });
  });

  it("marca hasta el registrado más tarde, aunque el proveedor lo haya entregado tarde y se muestre al medio", () => {
    const late = read("late", "2026-10-29T14:00:00Z", {
      // Enviado a las 11:00 de Asunción, registrado a las 12:10.
      createdAt: new Date("2026-10-29T15:10:00Z"),
    });
    expect(
      threadRead([read("in-1", "2026-10-29T15:01:00Z"), late], {
        readUpTo: new Date("2026-10-29T15:05:00Z"),
        lastOwnReplyAt: null,
      }),
    ).toEqual({ unread: 1, firstUnreadId: "late", upToMessageId: "late" });
  });

  it("responder es leer: lo anterior a la última respuesta propia ya no cuenta", () => {
    expect(
      threadRead(
        [
          read("in-1", "2026-10-29T15:01:00Z"),
          read("in-2", "2026-10-29T15:04:00Z"),
        ],
        {
          readUpTo: null,
          lastOwnReplyAt: new Date("2026-10-29T15:02:00Z"),
        },
      ),
    ).toEqual({ unread: 1, firstUnreadId: "in-2", upToMessageId: "in-2" });
  });

  it("sin mensajes no hay nada que marcar", () => {
    expect(threadRead([], NO_READ_CURSOR)).toEqual({
      unread: 0,
      firstUnreadId: null,
      upToMessageId: null,
    });
  });
});
