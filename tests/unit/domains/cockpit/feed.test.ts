import { describe, expect, it } from "vitest";

import {
  cockpitFeed,
  cockpitSummary,
  compareRecent,
  groupByDay,
  isCockpitFeedEmpty,
  mergeRecent,
  upcomingTimeLabel,
  type CockpitEvent,
  type CockpitNoteRow,
  type CockpitQuoteRow,
  type CockpitSources,
  type CockpitTestDriveRow,
  type UnreadConversationRow,
} from "@/domains/cockpit/feed";
import {
  cockpitWindow,
  RECENT_EVENT_LIMIT,
  TEST_DRIVE_SLOT_MS,
  testDrivePhase,
} from "@/domains/cockpit/window";

/*
 * Feed del Cockpit (Hito 15, DEC-047), puro: la ventana de tiempo, la fase
 * de una prueba abierta, cada fuente como evento (copy, estado y acción),
 * el orden total, la mezcla exacta de fuentes cortadas, los días y la
 * franja. Las lecturas se prueban contra PostgreSQL en tests/db/cockpit.test.ts
 * y la vista en tests/unit/cockpit/cockpit-view.test.ts.
 */

// Miércoles 4 de noviembre de 2026, 10:00 en Asunción (UTC-3).
const NOW = new Date("2026-11-04T13:00:00Z");
const WINDOW = cockpitWindow(NOW);

const id = (n: number) =>
  `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const at = (iso: string) => new Date(iso);

function conversation(
  n: number,
  lastUnreadAt: string,
  unread = 1,
): UnreadConversationRow {
  return {
    conversationId: id(n),
    contactName: `Cliente ${n}`,
    unread,
    lastUnreadAt: at(lastUnreadAt),
    lastUnreadContent: "¿Tienen la Hilux en blanco?\nLa quiero para el sábado.",
  };
}

function testDrive(
  n: number,
  scheduledAt: string,
  status: CockpitTestDriveRow["status"] = "confirmed",
): CockpitTestDriveRow {
  return {
    id: id(n),
    status,
    scheduledAt: at(scheduledAt),
    opportunityId: id(100 + n),
    contactName: `Cliente ${n}`,
    vehicleBrand: "Toyota",
    vehicleModel: "Hilux",
    vehicleYear: 2025,
  };
}

function quote(
  n: number,
  updatedAt: string,
  overrides: Partial<CockpitQuoteRow> = {},
): CockpitQuoteRow {
  return {
    id: id(n),
    number: n,
    status: "approved",
    validUntil: "2026-11-10",
    currency: "USD",
    totalPrice: "46157.50",
    updatedAt: at(updatedAt),
    opportunityId: id(100 + n),
    opportunityStage: "negotiating",
    contactName: `Cliente ${n}`,
    vehicleBrand: "Toyota",
    vehicleModel: "Corolla Cross",
    vehicleYear: 2024,
    ...overrides,
  };
}

function note(n: number, recordedAt: string): CockpitNoteRow {
  return {
    id: id(n),
    opportunityId: id(100 + n),
    contactName: `Cliente ${n}`,
    body: "Pidió cotizar con\n\nentrega de su Corolla 2018.",
    recordedAt: at(recordedAt),
  };
}

const source = <Row>(rows: readonly Row[], total = rows.length) => ({
  rows,
  total,
});

function sources(overrides: Partial<CockpitSources> = {}): CockpitSources {
  return {
    unreadConversations: { ...source([]), unreadMessages: 0 },
    upcomingTestDrives: source([]),
    overdueTestDrives: source([]),
    quotes: source([]),
    notes: source([]),
    ...overrides,
  };
}

describe("cockpitWindow()", () => {
  it("mira hoy y los 6 días anteriores desde su primer instante, y hasta el fin de mañana", () => {
    expect(WINDOW.today).toBe("2026-11-04");
    // Jueves 29 de octubre, 00:00 en Asunción.
    expect(WINDOW.recentFrom).toEqual(at("2026-10-29T03:00:00Z"));
    // Viernes 6 de noviembre, 00:00 en Asunción: el fin de mañana, exclusivo.
    expect(WINDOW.upcomingUntil).toEqual(at("2026-11-06T03:00:00Z"));
  });

  it("separa vencidas de próximas por la franja de 60 minutos", () => {
    expect(WINDOW.upcomingFrom).toEqual(at("2026-11-04T12:00:00Z"));
    expect(NOW.getTime() - WINDOW.upcomingFrom.getTime()).toBe(
      TEST_DRIVE_SLOT_MS,
    );
  });

  it("usa el día de Asunción aunque en UTC ya sea el día siguiente", () => {
    // 23:30 del martes 3 en Asunción = 02:30 UTC del miércoles 4.
    const late = cockpitWindow(at("2026-11-04T02:30:00Z"));
    expect(late.today).toBe("2026-11-03");
    expect(late.upcomingUntil).toEqual(at("2026-11-05T03:00:00Z"));
  });
});

describe("testDrivePhase()", () => {
  const scheduled = at("2026-11-04T13:00:00Z");

  it("por venir antes de la hora, en curso durante la franja y vencida al terminarla", () => {
    expect(testDrivePhase(scheduled, at("2026-11-04T12:59:59.999Z"))).toBe(
      "upcoming",
    );
    expect(testDrivePhase(scheduled, scheduled)).toBe("in_progress");
    expect(testDrivePhase(scheduled, at("2026-11-04T13:59:59.999Z"))).toBe(
      "in_progress",
    );
    expect(testDrivePhase(scheduled, at("2026-11-04T14:00:00Z"))).toBe(
      "overdue",
    );
  });

  it("coincide con la frontera de la ventana: lo de upcomingFrom o antes ya venció", () => {
    expect(testDrivePhase(WINDOW.upcomingFrom, NOW)).toBe("overdue");
    expect(
      testDrivePhase(new Date(WINDOW.upcomingFrom.getTime() + 1), NOW),
    ).toBe("in_progress");
  });
});

describe("cada fuente como evento", () => {
  it("un chat sin leer: cuántos, el preview en una línea y Responder", () => {
    const [event] = mergeRecent(
      sources({
        unreadConversations: {
          ...source([conversation(1, "2026-11-04T12:32:00Z", 3)]),
          unreadMessages: 3,
        },
      }),
      WINDOW,
    );
    expect(event).toMatchObject({
      kind: "message",
      key: `message:${id(1)}`,
      timeLabel: "09:32",
      timeTitle: "Miércoles 4 de noviembre de 2026, 09:32",
      title: "Cliente 1",
      headline: "3 mensajes sin leer",
      detail: "¿Tienen la Hilux en blanco? La quiero para el sábado.",
      unread: 3,
      action: {
        label: "Responder",
        target: { kind: "conversation", conversationId: id(1) },
      },
    });
  });

  it("una prueba vencida: chip Vencida, el estado en el detalle y Registrar resultado en su día", () => {
    const [event] = mergeRecent(
      sources({
        overdueTestDrives: source([
          testDrive(2, "2026-11-03T21:00:00Z", "scheduled"),
        ]),
      }),
      WINDOW,
    );
    expect(event).toMatchObject({
      kind: "test_drive",
      phase: "overdue",
      status: "scheduled",
      timeLabel: "18:00",
      headline: "Prueba de manejo",
      detail: "Toyota Hilux 2025 · Agendada",
      action: {
        label: "Registrar resultado",
        target: { kind: "calendar_day", day: "2026-11-03" },
      },
    });
  });

  it("una próxima: Hoy o Mañana con la hora, en curso con su chip, y Ver en agenda", () => {
    const feed = cockpitFeed(
      sources({
        upcomingTestDrives: source([
          testDrive(4, "2026-11-05T13:00:00Z", "scheduled"),
          testDrive(3, "2026-11-04T12:30:00Z"),
          testDrive(5, "2026-11-04T18:00:00Z"),
        ]),
      }),
      WINDOW,
    );
    expect(
      feed.upcoming.map((event) => [
        event.timeLabel,
        event.kind === "test_drive" ? event.phase : null,
        event.detail,
        event.action.label,
      ]),
    ).toEqual([
      [
        "Hoy 09:30",
        "in_progress",
        "Toyota Hilux 2025 · Confirmada",
        "Ver en agenda",
      ],
      ["Hoy 15:00", "upcoming", "Toyota Hilux 2025", "Ver en agenda"],
      ["Mañana 10:00", "upcoming", "Toyota Hilux 2025", "Ver en agenda"],
    ]);
  });

  it("upcomingTimeLabel() rotula con la fecha lo que no es hoy ni mañana", () => {
    expect(upcomingTimeLabel(at("2026-11-06T13:00:00Z"), NOW)).toBe(
      "Viernes 6 de noviembre 10:00",
    );
  });

  it.each([
    [
      "un borrador vigente se revisa y aprueba",
      {},
      "draft",
      "Revisar y aprobar",
    ],
    [
      "un borrador de una oportunidad que ya no se cotiza solo se mira",
      { opportunityStage: "won" },
      "draft",
      "Ver presupuesto",
    ],
    ["una aprobada vigente abre el PDF", {}, "approved", "Ver PDF"],
    ["una enviada vigente abre el PDF", {}, "sent", "Ver PDF"],
    [
      "una aceptada abre el PDF aunque haya vencido",
      { validUntil: "2026-11-01", opportunityStage: "won" },
      "accepted",
      "Ver PDF",
    ],
    ["una rechazada solo se mira", {}, "rejected", "Ver presupuesto"],
    ["una anulada solo se mira", {}, "withdrawn", "Ver presupuesto"],
  ] as const)("%s", (_case, overrides, status, label) => {
    const [event] = mergeRecent(
      sources({
        quotes: source([
          quote(7, "2026-11-04T11:02:00Z", { ...overrides, status }),
        ]),
      }),
      WINDOW,
    );
    expect(event).toMatchObject({
      kind: "quote",
      headline: "Cotización N.º 0007",
      detail: "Toyota Corolla Cross 2024 · USD 46.157,50",
      action: {
        label,
        target: { kind: "quote", opportunityId: id(107), quoteId: id(7) },
      },
    });
  });

  it("una abierta con la validez vencida se muestra Vencida y solo se mira", () => {
    const [event] = mergeRecent(
      sources({
        quotes: source([
          quote(8, "2026-11-01T14:00:00Z", {
            status: "sent",
            validUntil: "2026-11-03",
          }),
        ]),
      }),
      WINDOW,
    );
    expect(event).toMatchObject({
      kind: "quote",
      status: "expired",
      action: { label: "Ver presupuesto" },
    });
  });

  it("una nota de otro miembro: el texto en una línea y Ver oportunidad", () => {
    const [event] = mergeRecent(
      sources({ notes: source([note(9, "2026-11-04T10:15:00Z")]) }),
      WINDOW,
    );
    expect(event).toMatchObject({
      kind: "note",
      headline: "Nota de otro miembro",
      detail: "Pidió cotizar con entrega de su Corolla 2018.",
      action: {
        label: "Ver oportunidad",
        target: { kind: "opportunity", opportunityId: id(109) },
      },
    });
  });
});

describe("orden y mezcla", () => {
  it("del más nuevo al más viejo; a igual milisegundo, mensaje, prueba, cotización y nota", () => {
    const same = "2026-11-04T12:00:00.000Z";
    const keys = mergeRecent(
      sources({
        notes: source([note(4, same)]),
        quotes: source([quote(3, same)]),
        overdueTestDrives: source([testDrive(2, "2026-11-04T11:00:00Z")]),
        unreadConversations: {
          ...source([
            conversation(1, same),
            conversation(5, "2026-11-04T12:40:00Z"),
          ]),
          unreadMessages: 2,
        },
      }),
      WINDOW,
    ).map((event) => event.key);
    expect(keys).toEqual([
      `message:${id(5)}`,
      `message:${id(1)}`,
      `quote:${id(3)}`,
      `note:${id(4)}`,
      `test_drive:${id(2)}`,
    ]);
  });

  it("a igual milisegundo y tipo, por id descendente, como la base", () => {
    const same = "2026-11-04T12:00:00.000Z";
    const keys = mergeRecent(
      sources({ notes: source([note(1, same), note(2, same)]) }),
      WINDOW,
    ).map((event) => event.key);
    expect(keys).toEqual([`note:${id(2)}`, `note:${id(1)}`]);
  });

  it("es exacta: cortar cada fuente en el tope da lo mismo que ordenar todo y cortar", () => {
    // Un generador determinista: 4 fuentes con 45 filas cada una, en
    // instantes que se mezclan y se repiten entre fuentes.
    let seed = 7;
    const next = () => {
      seed = (seed * 1103515245 + 12345) % 2 ** 31;
      return seed;
    };
    const instant = () =>
      new Date(
        WINDOW.recentFrom.getTime() + (next() % (6 * 24 * 60)) * 60_000,
      ).toISOString();
    const all = {
      conversations: Array.from({ length: 45 }, (_, i) =>
        conversation(1000 + i, instant()),
      ),
      drives: Array.from({ length: 45 }, (_, i) =>
        testDrive(2000 + i, instant()),
      ),
      quotes: Array.from({ length: 45 }, (_, i) => quote(3000 + i, instant())),
      notes: Array.from({ length: 45 }, (_, i) => note(4000 + i, instant())),
    };
    const full = sources({
      unreadConversations: { ...source(all.conversations), unreadMessages: 45 },
      overdueTestDrives: source(all.drives),
      quotes: source(all.quotes),
      notes: source(all.notes),
    });

    // Lo que haría la base: cada fuente ordenada con el mismo orden y cortada.
    const top = <T>(rows: readonly T[], toEvent: (row: T) => CockpitEvent) =>
      [...rows]
        .sort((a, b) => compareRecent(toEvent(a), toEvent(b)))
        .slice(0, RECENT_EVENT_LIMIT);
    const eventOf = (s: CockpitSources) => mergeRecent(s, WINDOW)[0]!;
    const cut = sources({
      unreadConversations: {
        ...source(
          top(all.conversations, (row) =>
            eventOf(
              sources({
                unreadConversations: { ...source([row]), unreadMessages: 1 },
              }),
            ),
          ),
          45,
        ),
        unreadMessages: 45,
      },
      overdueTestDrives: source(
        top(all.drives, (row) =>
          eventOf(sources({ overdueTestDrives: source([row]) })),
        ),
        45,
      ),
      quotes: source(
        top(all.quotes, (row) => eventOf(sources({ quotes: source([row]) }))),
        45,
      ),
      notes: source(
        top(all.notes, (row) => eventOf(sources({ notes: source([row]) }))),
        45,
      ),
    });

    const fromCut = mergeRecent(cut, WINDOW).map((event) => event.key);
    const fromAll = mergeRecent(full, WINDOW).map((event) => event.key);
    expect(fromCut).toHaveLength(RECENT_EVENT_LIMIT);
    expect(fromCut).toEqual(fromAll);
  });

  it("agrupa por día de Asunción conservando el orden: Hoy, Ayer y la fecha", () => {
    const groups = groupByDay(
      mergeRecent(
        sources({
          notes: source([
            note(1, "2026-11-04T12:00:00Z"),
            // 00:30 del miércoles en UTC es todavía martes en Asunción.
            note(2, "2026-11-04T00:30:00Z"),
            note(3, "2026-11-02T15:00:00Z"),
          ]),
        }),
        WINDOW,
      ),
      NOW,
    );
    expect(
      groups.map((group) => [group.key, group.label, group.events.length]),
    ).toEqual([
      ["2026-11-04", "Hoy", 1],
      ["2026-11-03", "Ayer", 1],
      ["2026-11-02", "Lunes 2 de noviembre", 1],
    ]);
  });
});

describe("cockpitFeed() y la franja", () => {
  it("los totales cuentan todo lo que cumple el filtro, también lo que no entra", () => {
    const feed = cockpitFeed(
      sources({
        unreadConversations: {
          ...source([conversation(1, "2026-11-04T12:00:00Z", 2)], 4),
          unreadMessages: 11,
        },
        upcomingTestDrives: source([testDrive(2, "2026-11-04T18:00:00Z")], 12),
        overdueTestDrives: source([testDrive(3, "2026-11-03T13:00:00Z")], 3),
        quotes: source([quote(4, "2026-11-02T13:00:00Z")], 40),
        notes: source([note(5, "2026-11-01T13:00:00Z")], 2),
      }),
      WINDOW,
    );
    expect(feed.summary).toEqual([
      {
        key: "unread",
        label: "Chats sin leer",
        value: 4,
        hint: "11 mensajes",
        attention: true,
      },
      {
        key: "upcoming",
        label: "Próximas pruebas",
        value: 12,
        hint: "Hoy y mañana",
        attention: false,
      },
      {
        key: "overdue",
        label: "Pruebas vencidas",
        value: 3,
        hint: "Registrá el resultado",
        attention: true,
      },
      {
        key: "quotes",
        label: "Cotizaciones",
        value: 40,
        hint: "Movidas en 7 días",
        attention: false,
      },
    ]);
    expect(feed.upcomingTotal).toBe(12);
    expect(feed.recentShown).toBe(4);
    expect(feed.recentTotal).toBe(4 + 3 + 40 + 2);
    expect(feed.generatedAt).toBe(NOW.toISOString());
    expect(feed.generatedLabel).toBe("10:00");
    expect(isCockpitFeedEmpty(feed)).toBe(false);
  });

  it("sin nada pendiente: la franja al día y el feed vacío", () => {
    const empty = sources();
    expect(
      cockpitSummary(empty).map((tile) => [
        tile.value,
        tile.hint,
        tile.attention,
      ]),
    ).toEqual([
      [0, "Al día", false],
      [0, "Hoy y mañana", false],
      [0, "Al día", false],
      [0, "Movidas en 7 días", false],
    ]);
    expect(isCockpitFeedEmpty(cockpitFeed(empty, WINDOW))).toBe(true);
  });

  it("un chat sin leer en singular", () => {
    const [tile] = cockpitSummary(
      sources({
        unreadConversations: {
          ...source([conversation(1, "2026-11-04T12:00:00Z")]),
          unreadMessages: 1,
        },
      }),
    );
    expect(tile?.hint).toBe("1 mensaje");
  });
});
