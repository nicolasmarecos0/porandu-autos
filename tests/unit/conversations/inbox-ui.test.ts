import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { conversationHref } from "@/components/inbox/conversation-list";
import { InboxView } from "@/components/inbox/inbox-view";
import { SEND_ENDPOINT } from "@/components/inbox/message-composer";
import {
  NETWORK_NOTICE,
  SENT_NOTICE,
  sendFeedback,
} from "@/components/inbox/send-feedback";
import {
  conversationThread,
  inboxItems,
  threadContact,
  type Inbox,
} from "@/domains/conversations/inbox";
import { SEND_MESSAGE_ERRORS } from "@/domains/conversations/outbound";

/*
 * UI de la bandeja (Hito 8, DEC-040 §1), renderizada en el servidor sin DOM:
 * las dos columnas, la elegida, las burbujas entrantes y salientes, los
 * estados vacíos y el aviso de cada respuesta del endpoint. El envío real
 * se prueba en tests/unit/conversations/send.test.ts y
 * tests/db/whatsapp-outbound.test.ts.
 */

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));

const VIEWER = "00000000-0000-4000-8000-00000000000c";
const OTHER = "00000000-0000-4000-8000-00000000000a";
const SELECTED = "00000000-0000-4000-8000-0000000000c1";
const SECOND = "00000000-0000-4000-8000-0000000000c2";

const conversations = inboxItems([
  {
    id: SELECTED,
    contactName: "Ramón Benítez",
    lastMessageAt: new Date("2026-10-29T15:32:00Z"),
    lastMessagePreview: "Sí, sigue disponible",
  },
  {
    id: SECOND,
    contactName: "Ana Ríos",
    lastMessageAt: null,
    lastMessagePreview: null,
  },
]);

function render(inbox: Inbox): string {
  return renderToStaticMarkup(
    createElement(InboxView, { title: "Conversaciones", inbox }),
  );
}

const found: Inbox = {
  conversations,
  total: 2,
  selectedId: SELECTED,
  thread: {
    kind: "found",
    conversationId: SELECTED,
    contact: threadContact("Ramón Benítez", "+595981555214"),
    messages: conversationThread(
      [
        {
          id: "m1",
          direction: "inbound",
          content: "¿Sigue disponible la Hilux?",
          recordedBy: null,
          sentAt: new Date("2026-10-29T15:30:00Z"),
          createdAt: new Date("2026-10-29T15:30:01Z"),
        },
        {
          id: "m2",
          direction: "outbound",
          content: "Sí, sigue disponible",
          recordedBy: VIEWER,
          sentAt: new Date("2026-10-29T15:31:00Z"),
          createdAt: new Date("2026-10-29T15:31:00Z"),
        },
        {
          id: "m3",
          direction: "outbound",
          content: "Te paso la ficha",
          recordedBy: OTHER,
          sentAt: new Date("2026-10-29T15:32:00Z"),
          createdAt: new Date("2026-10-29T15:32:00Z"),
        },
      ],
      VIEWER,
    ),
    total: 3,
  },
};

describe("bandeja", () => {
  it("dos columnas: la lista con la elegida marcada y el historial con el composer", () => {
    const html = render(found);

    expect(html).toContain("Conversaciones activas");
    expect(html).toContain(`href="${conversationHref(SELECTED)}"`);
    expect(html).toContain(`href="${conversationHref(SECOND)}"`);
    expect(html.match(/aria-current="page"/g)).toHaveLength(1);
    expect(html).toMatch(
      new RegExp(
        `aria-current="page"[^>]*href="/conversations\\?c=${SELECTED}"`,
      ),
    );
    expect(html).toContain("Sí, sigue disponible");
    expect(html).toContain("Sin mensajes todavía");
    expect(html).toContain("29 oct 2026 12:32");

    expect(html).toContain("Historial con Ramón Benítez");
    expect(html).toContain("+595 ··· 214");
    expect(html).not.toContain("595981555214");
    expect(html).toContain("Respuesta por WhatsApp");
    expect(html).toContain("Enviar");
  });

  it("distingue entrantes y salientes: lado, tono, autor y texto para lectores de pantalla", () => {
    const html = render(found);
    const bubbles = [
      ...html.matchAll(/<li data-direction="(\w+)" class="flex ([\w-]+)">/g),
    ].map((match) => [match[1], match[2]]);

    expect(bubbles).toEqual([
      ["inbound", "justify-start"],
      ["outbound", "justify-end"],
      ["outbound", "justify-end"],
    ]);
    expect(html).toContain("Mensaje recibido");
    expect(html).toContain("Mensaje enviado");
    expect(html).toContain("Cliente · 29 oct 2026 12:30");
    expect(html).toContain("Vos · 29 oct 2026 12:31");
    expect(html).toContain("Otro miembro · 29 oct 2026 12:32");
    expect(html).toContain("bg-brand-soft");
    expect(html).toContain("bg-surface-1");
    // Del más viejo al más nuevo.
    expect(html.indexOf("¿Sigue disponible la Hilux?")).toBeLessThan(
      html.indexOf("Te paso la ficha"),
    );
    expect(html).not.toContain(VIEWER);
    expect(html).not.toContain(OTHER);
  });

  it("avisa cuando no muestra todos los mensajes o todas las conversaciones", () => {
    const html = render({
      ...found,
      total: 140,
      thread: { ...found.thread, total: 250 } as Inbox["thread"],
    });
    expect(html).toContain("Mostrando las 2 más recientes de 140.");
    expect(html).toContain("Mostrando los últimos 3 de 250 mensajes.");
  });

  it("sin elección: invita a elegir y no muestra el composer", () => {
    const html = render({
      conversations,
      total: 2,
      selectedId: null,
      thread: { kind: "none" },
    });
    expect(html).toContain("Elegí una conversación");
    expect(html).not.toContain('aria-current="page"');
    expect(html).not.toContain("Respuesta por WhatsApp");
  });

  it("no encontrada: lo dice sin distinguir por qué y no muestra el composer", () => {
    const html = render({
      conversations,
      total: 2,
      selectedId: "00000000-0000-4000-8000-0000000000ff",
      thread: { kind: "not_found" },
    });
    expect(html).toContain("No encontramos la conversación");
    expect(html).not.toContain("Respuesta por WhatsApp");
  });

  it("sin conversaciones: explica de dónde llegan", () => {
    const html = render({
      conversations: [],
      total: 0,
      selectedId: null,
      thread: { kind: "none" },
    });
    expect(html).toContain("Todavía no hay conversaciones");
  });
});

describe("avisos del composer", () => {
  it("envía al endpoint del Hito 8", () => {
    expect(SEND_ENDPOINT).toBe("/api/messages/send");
  });

  it("éxito", () => {
    expect(sendFeedback(true, { outcome: "sent" })).toBe(SENT_NOTICE);
  });

  it("cada error del contrato tiene su aviso, y ninguno es el genérico de red", () => {
    for (const error of SEND_MESSAGE_ERRORS) {
      const notice = sendFeedback(false, { error });
      expect(notice.tone, error).toBe("error");
      expect(notice, error).not.toEqual(NETWORK_NOTICE);
    }
  });

  it("dice si el cliente recibió el mensaje: unrecorded no se reenvía, el resto no se envió o no se confirmó", () => {
    expect(sendFeedback(false, { error: "unrecorded" }).text).toContain(
      "No lo reenvíes",
    );
    for (const error of ["not_found", "no_line", "not_configured", "failed"]) {
      expect(sendFeedback(false, { error }).text, error).toContain(
        "No se envió nada",
      );
    }
    expect(
      sendFeedback(false, { error: "provider_unavailable" }).text,
    ).toContain("No pudimos confirmar");
  });

  it("los errores por campo del servidor", () => {
    expect(
      sendFeedback(false, { error: "invalid", errors: { text: "too_long" } })
        .text,
    ).toBe("El mensaje puede tener hasta 4.096 caracteres.");
    expect(
      sendFeedback(false, { error: "invalid", errors: { text: "empty" } }).text,
    ).toBe("Escribí el mensaje antes de enviarlo.");
    expect(
      sendFeedback(false, {
        error: "invalid",
        errors: { conversationId: "invalid" },
      }).text,
    ).toContain("No encontramos la conversación");
  });

  it("una respuesta desconocida o sin JSON es el aviso de red: no sabemos si salió", () => {
    expect(sendFeedback(false, null)).toBe(NETWORK_NOTICE);
    expect(sendFeedback(false, { error: "otra_cosa" })).toBe(NETWORK_NOTICE);
  });
});
