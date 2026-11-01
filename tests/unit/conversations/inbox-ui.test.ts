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
  inboxItems,
  threadContact,
  threadRead,
  type Inbox,
  type InboxThread,
  type ThreadMessageRow,
} from "@/domains/conversations/inbox";
import { conversationOpportunity } from "@/domains/conversations/opportunity-link";
import { SEND_MESSAGE_ERRORS } from "@/domains/conversations/outbound";
import { NO_READ_CURSOR } from "@/domains/conversations/read-state";
import { threadSections } from "@/domains/conversations/thread-layout";

/*
 * UI de la bandeja (Hito 8, DEC-040 §1; Hito 12, DEC-044), renderizada en el
 * servidor sin DOM: las dos columnas y el maestro/detalle de teléfono, la
 * elegida, las burbujas entrantes y salientes por día y en grupos, el estado
 * de entrega, la oportunidad del contacto, los no leídos (contador de la
 * lista y separador "Mensajes nuevos"), los estados vacíos y el aviso de
 * cada respuesta del endpoint. El envío real se prueba en
 * tests/unit/conversations/send.test.ts y tests/db/whatsapp-outbound.test.ts;
 * marcar visto, en tests/unit/conversations/read-action.test.ts y
 * tests/db/conversation-reads.test.ts.
 */

const mocks = vi.hoisted(() => ({ markConversationRead: vi.fn() }));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
}));
// Marcar visto es una Server Action: renderizar nunca la llama.
vi.mock("@/lib/conversations/read", () => ({
  markConversationRead: mocks.markConversationRead,
}));

const VIEWER = "00000000-0000-4000-8000-00000000000c";
const OTHER = "00000000-0000-4000-8000-00000000000a";
const SELECTED = "00000000-0000-4000-8000-0000000000c1";
const SECOND = "00000000-0000-4000-8000-0000000000c2";
const OPPORTUNITY = "00000000-0000-4000-8000-0000000000e1";
const OPPORTUNITY_2 = "00000000-0000-4000-8000-0000000000e2";
/** 29 oct 2026, 15:00 de Asunción. */
const NOW = new Date("2026-10-29T18:00:00Z");

const conversations = inboxItems(
  [
    {
      id: SELECTED,
      contactName: "Ramón Benítez",
      lastMessageAt: new Date("2026-10-29T15:32:00Z"),
      lastMessagePreview: "Sí, sigue disponible",
      unread: 3,
    },
    {
      id: SECOND,
      contactName: "Ana Ríos",
      lastMessageAt: null,
      lastMessagePreview: null,
      unread: 0,
    },
  ],
  NOW,
);

/** Las clases de la columna (`section`) que titula `heading`. */
function sectionClasses(html: string, heading: string): string[] {
  const match = new RegExp(
    `<section aria-labelledby="${heading}" class="([^"]*)"`,
  ).exec(html);
  return match?.[1]?.split(" ") ?? [];
}

function render(inbox: Inbox): string {
  return renderToStaticMarkup(
    createElement(InboxView, { title: "Conversaciones", inbox }),
  );
}

const THREAD_ROWS: readonly ThreadMessageRow[] = [
  {
    id: "m0",
    direction: "inbound",
    content: "Hola, vi la Hilux en Marketplace",
    recordedBy: null,
    sentAt: new Date("2026-10-28T13:00:00Z"),
    createdAt: new Date("2026-10-28T13:00:01Z"),
  },
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
  {
    id: "m4",
    direction: "outbound",
    content: "Y las fotos",
    recordedBy: OTHER,
    sentAt: new Date("2026-10-29T15:33:00Z"),
    createdAt: new Date("2026-10-29T15:33:00Z"),
  },
];

const foundThread: Extract<InboxThread, { kind: "found" }> = {
  kind: "found",
  conversationId: SELECTED,
  contact: threadContact("Ramón Benítez", "+595981555214"),
  opportunity: conversationOpportunity(
    [
      {
        id: OPPORTUNITY,
        stage: "negotiating",
        lastActivityAt: new Date("2026-10-29T15:32:00Z"),
      },
    ],
    1,
  ),
  sections: threadSections(THREAD_ROWS, VIEWER, NOW),
  // Vos respondiste después de los entrantes: responder es leer.
  read: threadRead(THREAD_ROWS, {
    readUpTo: null,
    lastOwnReplyAt: new Date("2026-10-29T15:31:00Z"),
  }),
  shown: 5,
  total: 5,
};

const found: Inbox = {
  conversations,
  total: 2,
  selectedId: SELECTED,
  thread: foundThread,
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
    // La hora de chat, con la fecha completa en el title.
    expect(html).toMatch(
      /<time dateTime="2026-10-29T15:32:00.000Z" title="29 oct 2026 12:32"[^>]*>12:32<\/time>/,
    );

    expect(html).toContain("Historial con Ramón Benítez");
    expect(html).toContain("+595 ··· 214");
    expect(html).not.toContain("595981555214");
    expect(html).toContain("Respuesta por WhatsApp");
    expect(html).toContain("Enviar");
  });

  it("distingue entrantes y salientes: lado, tono, autor y texto para lectores de pantalla", () => {
    const html = render(found);
    const bubbles = [
      ...html.matchAll(
        /<li data-direction="(\w+)" data-position="(\w+)"[^>]*>.*?(self-start|self-end)/g,
      ),
    ].map((match) => [match[1], match[2], match[3]]);

    expect(bubbles).toEqual([
      ["inbound", "single", "self-start"],
      ["inbound", "single", "self-start"],
      ["outbound", "single", "self-end"],
      // Dos seguidos de "Otro miembro": un grupo.
      ["outbound", "first", "self-end"],
      ["outbound", "last", "self-end"],
    ]);
    expect(html).toContain("Mensaje recibido");
    expect(html).toContain("Mensaje enviado");
    expect(html).toContain(">Cliente<");
    expect(html).toContain(">Vos<");
    expect(html).toContain(">Otro miembro<");
    // Cada burbuja con su hora; la fecha completa, en el title.
    expect(html).toContain('title="29 oct 2026 12:30">12:30</time>');
    expect(html).toContain('title="29 oct 2026 12:31">12:31</time>');
    expect(html).toContain("bg-brand-soft");
    expect(html).toContain("bg-surface-1");
    // Del más viejo al más nuevo.
    expect(html.indexOf("¿Sigue disponible la Hilux?")).toBeLessThan(
      html.indexOf("Te paso la ficha"),
    );
    expect(html).not.toContain(VIEWER);
    expect(html).not.toContain(OTHER);
  });

  it("separa el historial por día de Asunción, con el día fijo arriba", () => {
    const html = render(found);
    const days = [
      ...html.matchAll(/<h3 id="inbox-day-([\d-]+)"[^>]*>([^<]+)<\/h3>/g),
    ].map((match) => [match[1], match[2]]);
    expect(days).toEqual([
      ["2026-10-28", "Ayer"],
      ["2026-10-29", "Hoy"],
    ]);
    expect(html).toContain("sticky top-0");
    expect(html).toContain('role="log"');
  });

  it("cada saliente dice su estado de entrega en texto, junto al ícono", () => {
    const html = render(found);
    expect(html.match(/data-delivery="sent"/g)).toHaveLength(3);
    expect(html.match(/>Enviado<\/span>/g)).toHaveLength(3);
    expect(html).not.toContain('data-delivery="read"');
  });

  it("la franja de la oportunidad: una abierta lleva a ella", () => {
    const html = render(found);
    expect(html).toContain('data-opportunity="linked"');
    expect(html).toContain(`href="/opportunities/${OPPORTUNITY}"`);
    expect(html).toContain("En negociación");
    expect(html).toContain("Los mensajes se suman a su actividad.");
  });

  it("la franja de la oportunidad: con varias abiertas no asocia y las ofrece en un menú", () => {
    const html = render({
      ...found,
      thread: {
        ...foundThread,
        opportunity: conversationOpportunity(
          [
            {
              id: OPPORTUNITY,
              stage: "qualifying",
              lastActivityAt: new Date("2026-10-29T15:32:00Z"),
            },
            {
              id: OPPORTUNITY_2,
              stage: "new",
              lastActivityAt: new Date("2026-10-20T15:32:00Z"),
            },
          ],
          2,
        ),
      },
    });
    expect(html).toContain('data-opportunity="ambiguous"');
    expect(html).toContain("2 oportunidades abiertas");
    expect(html).toContain("Los mensajes no se asocian a ninguna.");
    expect(html).toContain('aria-haspopup="menu"');
    expect(html).toContain("Ver oportunidades");
  });

  it("la franja de la oportunidad: sin ninguna abierta lo dice", () => {
    const html = render({
      ...found,
      thread: { ...foundThread, opportunity: { kind: "none" } },
    });
    expect(html).toContain('data-opportunity="none"');
    expect(html).toContain("Sin oportunidad abierta.");
    expect(html).not.toContain("/opportunities/");
  });

  it("no leídos: el contador de quien mira, con el texto para lectores de pantalla, y el nombre en negrita", () => {
    const html = render({
      conversations,
      total: 2,
      selectedId: null,
      thread: { kind: "none" },
    });
    expect(html.match(/<li data-unread="3"/g)).toHaveLength(1);
    expect(html).toMatch(
      /<span data-unread="3"[^>]*class="[^"]*bg-brand[^"]*"[^>]*><span aria-hidden="true">3<\/span><span class="sr-only">3 mensajes sin leer<\/span><\/span>/,
    );
    // Radix Tooltip: el disparador es el contador, cerrado al renderizar.
    expect(html).toMatch(/<span data-unread="3"[^>]*data-state="closed"/);
    expect(html).toMatch(/font-bold text-text-primary">Ramón Benítez</);
    // Leída: sin contador y sin negrita.
    expect(html).toMatch(/font-medium text-text-primary">Ana Ríos</);
    expect(html.match(/mensajes? sin leer/g)).toHaveLength(1);
  });

  it("no leídos: 99+ desde 100, con la cantidad completa en texto", () => {
    const html = render({
      conversations: inboxItems(
        [
          {
            id: SECOND,
            contactName: "Ana Ríos",
            lastMessageAt: new Date("2026-10-29T15:32:00Z"),
            lastMessagePreview: "¿Y el precio?",
            unread: 142,
          },
        ],
        NOW,
      ),
      total: 1,
      selectedId: null,
      thread: { kind: "none" },
    });
    expect(html).toContain('<span aria-hidden="true">99+</span>');
    expect(html).toContain(
      '<span class="sr-only">142 mensajes sin leer</span>',
    );
  });

  it("no leídos: la elegida no muestra el contador, porque está a la vista", () => {
    const html = render(found);
    expect(html).not.toContain('data-unread="3"');
    expect(html).not.toContain("mensajes sin leer");
    expect(html).toMatch(/font-semibold text-brand-strong">Ramón Benítez</);
  });

  it("el separador Mensajes nuevos va antes del primer entrante sin leer, una sola vez", () => {
    const html = render({
      ...found,
      thread: {
        ...foundThread,
        read: threadRead(THREAD_ROWS, NO_READ_CURSOR),
      },
    });
    expect(
      html.match(/role="separator" aria-label="Mensajes nuevos"/g),
    ).toHaveLength(1);
    const divider = html.indexOf('aria-label="Mensajes nuevos"');
    expect(divider).toBeLessThan(
      html.indexOf("Hola, vi la Hilux en Marketplace"),
    );
    expect(divider).toBeGreaterThan(html.indexOf('id="inbox-day-2026-10-28"'));
    // Renderizar no marca nada: lo hace el historial en el navegador.
    expect(mocks.markConversationRead).not.toHaveBeenCalled();
  });

  it("sin no leídos en la conversación no hay separador", () => {
    const html = render(found);
    expect(html).not.toContain("Mensajes nuevos");
    expect(mocks.markConversationRead).not.toHaveBeenCalled();
  });

  it("teléfono: sin elección se ve solo la lista; con una elegida, solo el chat con Volver", () => {
    const list = render({
      conversations,
      total: 2,
      selectedId: null,
      thread: { kind: "none" },
    });
    expect(list).toContain('data-pane="list"');
    expect(sectionClasses(list, "inbox-list-heading")).toContain("flex");
    expect(sectionClasses(list, "inbox-list-heading")).not.toContain("hidden");
    expect(sectionClasses(list, "inbox-thread-heading")).toEqual(
      expect.arrayContaining(["hidden", "lg:flex"]),
    );

    const chat = render(found);
    expect(chat).toContain('data-pane="thread"');
    expect(sectionClasses(chat, "inbox-list-heading")).toEqual(
      expect.arrayContaining(["hidden", "lg:flex"]),
    );
    expect(sectionClasses(chat, "inbox-thread-heading")).toContain("flex");
    expect(sectionClasses(chat, "inbox-thread-heading")).not.toContain(
      "hidden",
    );
    expect(chat).toContain('href="/conversations"');
    expect(chat).toContain("Volver a las conversaciones");
  });

  it("avisa cuando no muestra todos los mensajes o todas las conversaciones", () => {
    const html = render({
      ...found,
      total: 140,
      thread: { ...foundThread, total: 250 },
    });
    expect(html).toContain("Mostrando las 2 más recientes de 140.");
    expect(html).toContain("Mostrando los últimos 5 de 250 mensajes.");
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
