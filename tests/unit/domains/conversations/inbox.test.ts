import { describe, expect, it } from "vitest";

import {
  conversationThread,
  CUSTOMER_AUTHOR,
  EMPTY_PREVIEW,
  inboxItems,
  threadContact,
  type ThreadMessageRow,
} from "@/domains/conversations/inbox";

/*
 * Bandeja (Hito 8, DEC-040 §1): lista de conversaciones e historial listos
 * para mostrar, puros y deterministas, contra el usuario que mira.
 */

const VIEWER = "00000000-0000-4000-8000-00000000000c";
const OTHER = "00000000-0000-4000-8000-00000000000a";

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
      inboxItems([
        {
          id: "c1",
          contactName: "Ramón Benítez",
          lastMessageAt: new Date("2026-10-29T15:32:00Z"),
          lastMessagePreview: "¿Sigue disponible?",
        },
        {
          id: "c2",
          contactName: "Contacto de WhatsApp",
          lastMessageAt: null,
          lastMessagePreview: null,
        },
      ]),
    ).toEqual([
      {
        id: "c1",
        contactName: "Ramón Benítez",
        initials: "RB",
        preview: "¿Sigue disponible?",
        at: "29 oct 2026 12:32",
      },
      {
        id: "c2",
        contactName: "Contacto de WhatsApp",
        initials: "CW",
        preview: EMPTY_PREVIEW,
        at: null,
      },
    ]);
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
