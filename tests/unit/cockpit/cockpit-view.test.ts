import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { CockpitView } from "@/components/cockpit/cockpit-view";
import {
  cockpitFeed,
  type CockpitSources,
  type CockpitTestDriveRow,
} from "@/domains/cockpit/feed";
import { cockpitWindow } from "@/domains/cockpit/window";

/*
 * Cockpit (Hito 15, DEC-047), renderizado en el servidor sin DOM: la franja
 * de cuatro números, la línea de tiempo con Próximas, el marcador "Ahora" y
 * los días, el ícono y el tipo de cada evento, cada acción rápida como
 * enlace a su módulo, los avisos de lo que no entra y los estados vacíos.
 * Las reglas del feed se prueban en tests/unit/domains/cockpit/feed.test.ts.
 */

// Miércoles 4 de noviembre de 2026, 10:00 en Asunción (UTC-3).
const NOW = new Date("2026-11-04T13:00:00Z");
const WINDOW = cockpitWindow(NOW);

const id = (n: number) =>
  `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

function drive(
  n: number,
  scheduledAt: string,
  status: CockpitTestDriveRow["status"],
): CockpitTestDriveRow {
  return {
    id: id(n),
    status,
    scheduledAt: new Date(scheduledAt),
    opportunityId: id(100 + n),
    contactName: `Cliente ${n}`,
    vehicleBrand: "Toyota",
    vehicleModel: "Hilux",
    vehicleYear: 2025,
  };
}

const SOURCES: CockpitSources = {
  unreadConversations: {
    rows: [
      {
        conversationId: id(1),
        contactName: "Ramón Benítez",
        unread: 3,
        lastUnreadAt: new Date("2026-11-04T12:32:00Z"),
        lastUnreadContent: "¿Tienen financiación en 36 cuotas?",
      },
    ],
    total: 1,
    unreadMessages: 3,
  },
  upcomingTestDrives: {
    rows: [
      drive(2, "2026-11-04T18:00:00Z", "confirmed"),
      drive(3, "2026-11-05T13:00:00Z", "scheduled"),
    ],
    total: 2,
  },
  overdueTestDrives: {
    rows: [drive(4, "2026-11-03T21:00:00Z", "scheduled")],
    total: 1,
  },
  quotes: {
    rows: [
      {
        id: id(5),
        number: 7,
        status: "approved",
        validUntil: "2026-11-10",
        currency: "USD",
        totalPrice: "46157.50",
        updatedAt: new Date("2026-11-04T11:02:00Z"),
        opportunityId: id(105),
        opportunityStage: "negotiating",
        contactName: "Celeste Báez",
        vehicleBrand: "Toyota",
        vehicleModel: "Corolla Cross",
        vehicleYear: 2024,
      },
    ],
    total: 1,
  },
  notes: {
    rows: [
      {
        id: id(6),
        opportunityId: id(106),
        contactName: "Óscar Brítez",
        body: "Vuelve el viernes con la esposa.",
        recordedAt: new Date("2026-11-02T15:00:00Z"),
      },
    ],
    total: 1,
  },
};

function render(sources: CockpitSources = SOURCES): string {
  return renderToStaticMarkup(
    createElement(CockpitView, {
      title: "Cockpit",
      feed: cockpitFeed(sources, WINDOW),
    }),
  );
}

/** El texto visible, sin etiquetas ni espacios repetidos. */
function text(html: string): string {
  return html
    .replace(/<[^>]+>/g, " ")
    .replace(/&#x27;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
}

describe("CockpitView", () => {
  it("muestra la franja con los cuatro totales y su alcance", () => {
    const html = render();
    expect(html).toContain('aria-label="Resumen del día"');
    const visible = text(html);
    expect(visible).toContain("Chats sin leer 1 3 mensajes");
    expect(visible).toContain("Próximas pruebas 2 Hoy y mañana");
    expect(visible).toContain("Pruebas vencidas 1 Registrá el resultado");
    expect(visible).toContain("Cotizaciones 1 Movidas en 7 días");
  });

  it("ordena la línea de tiempo: próximas, ahora y los días de lo más nuevo a lo más viejo", () => {
    const visible = text(render());
    const order = [
      "Actualizado 10:00",
      "Próximas pruebas",
      "Hoy 15:00",
      "Mañana 10:00",
      "Ahora · 10:00",
      "Hoy",
      "09:32",
      "08:02",
      "Ayer",
      "18:00",
      "Lunes 2 de noviembre",
      "12:00",
    ];
    let cursor = -1;
    for (const fragment of order) {
      const found = visible.indexOf(fragment, cursor + 1);
      expect(found, fragment).toBeGreaterThan(cursor);
      cursor = found;
    }
  });

  it("cada evento lleva su acción rápida como enlace a su módulo", () => {
    const html = render();
    expect(html).toContain(`href="/conversations?c=${id(1)}"`);
    expect(html).toContain('href="/calendar?w=2026-11-04"');
    expect(html).toContain('href="/calendar?w=2026-11-05"');
    expect(html).toContain('href="/calendar?w=2026-11-03"');
    expect(html).toContain(`href="/opportunities/${id(105)}/quotes/${id(5)}"`);
    expect(html).toContain(`href="/opportunities/${id(106)}"`);
    const visible = text(html);
    expect(visible).toContain("Responder : Ramón Benítez");
    expect(visible).toContain("Registrar resultado : Cliente 4");
    expect(visible).toContain("Ver PDF : Celeste Báez");
    expect(visible).toContain("Ver oportunidad : Óscar Brítez");
    expect(visible.match(/Ver en agenda/g)).toHaveLength(2);
  });

  it("dice el tipo y el estado de cada evento en texto, no solo con color", () => {
    const visible = text(render());
    expect(visible).toContain("WhatsApp: Ramón Benítez");
    expect(visible).toContain("3 mensajes sin leer");
    expect(visible).toContain("¿Tienen financiación en 36 cuotas?");
    expect(visible).toContain("Agenda: Cliente 4 Vencida");
    expect(visible).toContain("Toyota Hilux 2025 · Agendada");
    expect(visible).toContain("Agenda: Cliente 2 Confirmada");
    expect(visible).toContain("Cotización: Celeste Báez Aprobada");
    expect(visible).toContain("Cotización N.º 0007");
    expect(visible).toContain("Toyota Corolla Cross 2024 · USD 46.157,50");
    expect(visible).toContain("Bitácora: Óscar Brítez");
    expect(visible).toContain("Nota de otro miembro");
  });

  it("cada hora es un <time> con el instante y la fecha completa", () => {
    const html = render();
    expect(html).toContain(
      'dateTime="2026-11-04T12:32:00.000Z" title="Miércoles 4 de noviembre de 2026, 09:32"',
    );
  });

  it("avisa lo que no entra en el tope y enlaza a los módulos", () => {
    const visible = text(
      render({
        ...SOURCES,
        upcomingTestDrives: { ...SOURCES.upcomingTestDrives, total: 14 },
        quotes: { ...SOURCES.quotes, total: 40 },
      }),
    );
    expect(visible).toContain(
      "Hay 12 pruebas más hasta mañana. Ver calendario",
    );
    expect(visible).toContain(
      "Se muestran los 4 eventos más recientes de 43. El resto sigue en Conversaciones , Calendario y cada oportunidad.",
    );
  });

  it("sin nada: los dos vacíos y la franja al día", () => {
    const visible = text(
      render({
        unreadConversations: { rows: [], total: 0, unreadMessages: 0 },
        upcomingTestDrives: { rows: [], total: 0 },
        overdueTestDrives: { rows: [], total: 0 },
        quotes: { rows: [], total: 0 },
        notes: { rows: [], total: 0 },
      }),
    );
    expect(visible).toContain("Sin pruebas de manejo hoy ni mañana.");
    expect(visible).toContain(
      "Nada nuevo: sin chats sin leer, pruebas vencidas ni movimientos en los últimos 7 días.",
    );
    expect(visible).toContain("Chats sin leer 0 Al día");
    expect(visible).not.toContain("Se muestran");
  });
});
