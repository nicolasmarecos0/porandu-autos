import { describe, expect, it } from "vitest";

import type { ThreadMessageRow } from "@/domains/conversations/inbox";
import {
  BUBBLE_GROUP_GAP_MS,
  threadSections,
} from "@/domains/conversations/thread-layout";

/*
 * El historial como chat (Hito 12, DEC-044 §1): del más viejo al más nuevo,
 * por día de Asunción y con las burbujas seguidas del mismo autor en grupo.
 */

const VIEWER = "00000000-0000-4000-8000-00000000000c";
const OTHER = "00000000-0000-4000-8000-00000000000a";
/** 29 oct 2026, 15:00 de Asunción. */
const NOW = new Date("2026-10-29T18:00:00Z");

function row(
  id: string,
  sentAt: string,
  overrides: Partial<ThreadMessageRow> = {},
): ThreadMessageRow {
  return {
    id,
    direction: "inbound",
    content: `Mensaje ${id}`,
    recordedBy: null,
    sentAt: new Date(sentAt),
    createdAt: new Date(sentAt),
    ...overrides,
  };
}

function positions(rows: readonly ThreadMessageRow[]) {
  return threadSections(rows, VIEWER, NOW).flatMap((section) =>
    section.bubbles.map((bubble) => [bubble.id, bubble.position]),
  );
}

describe("threadSections", () => {
  it("ordena del más viejo al más nuevo y separa por día de Asunción", () => {
    const sections = threadSections(
      [
        row("today", "2026-10-29T15:00:00Z"),
        // 28 oct, 22:30 de Asunción: ya es 29 en UTC, pero es ayer.
        row("late-yesterday", "2026-10-29T01:30:00Z"),
        row("monday", "2026-10-26T15:00:00Z"),
      ],
      VIEWER,
      NOW,
    );
    expect(
      sections.map((section) => [
        section.key,
        section.label,
        section.bubbles.map((bubble) => bubble.id),
      ]),
    ).toEqual([
      ["2026-10-26", "Lunes 26 de octubre", ["monday"]],
      ["2026-10-28", "Ayer", ["late-yesterday"]],
      ["2026-10-29", "Hoy", ["today"]],
    ]);
  });

  it("cada burbuja lleva su hora de Asunción, el instante ISO y la fecha completa", () => {
    const [section] = threadSections(
      [row("m1", "2026-10-29T15:32:00Z")],
      VIEWER,
      NOW,
    );
    expect(section?.bubbles[0]).toMatchObject({
      id: "m1",
      time: "12:32",
      dateTime: "2026-10-29T15:32:00.000Z",
      at: "29 oct 2026 12:32",
      author: "Cliente",
    });
  });

  it("agrupa los seguidos del mismo autor a lo sumo a 5 minutos", () => {
    expect(
      positions([
        row("a", "2026-10-29T15:00:00Z"),
        row("b", "2026-10-29T15:01:00Z"),
        row("c", "2026-10-29T15:02:00Z"),
        // Más de 5 minutos después: otro grupo.
        row("d", "2026-10-29T15:08:00Z"),
      ]),
    ).toEqual([
      ["a", "first"],
      ["b", "middle"],
      ["c", "last"],
      ["d", "single"],
    ]);
    expect(BUBBLE_GROUP_GAP_MS).toBe(5 * 60 * 1000);
  });

  it("un cambio de autor o de día corta el grupo", () => {
    expect(
      positions([
        row("in", "2026-10-29T15:00:00Z"),
        row("mine", "2026-10-29T15:01:00Z", {
          direction: "outbound",
          recordedBy: VIEWER,
        }),
        row("theirs", "2026-10-29T15:02:00Z", {
          direction: "outbound",
          recordedBy: OTHER,
        }),
      ]),
    ).toEqual([
      ["in", "single"],
      ["mine", "single"],
      ["theirs", "single"],
    ]);
    expect(
      positions([
        // 23:58 y 00:01 de Asunción: tres minutos, pero otro día.
        row("before", "2026-10-29T02:58:00Z"),
        row("after", "2026-10-29T03:01:00Z"),
      ]),
    ).toEqual([
      ["before", "single"],
      ["after", "single"],
    ]);
  });

  it("solo los salientes tienen estado de entrega: enviado hasta que se ingieran estados", () => {
    const bubbles = threadSections(
      [
        row("in", "2026-10-29T15:00:00Z"),
        row("out", "2026-10-29T15:01:00Z", {
          direction: "outbound",
          recordedBy: VIEWER,
        }),
      ],
      VIEWER,
      NOW,
    ).flatMap((section) => section.bubbles);
    expect(bubbles.map((bubble) => [bubble.id, bubble.delivery])).toEqual([
      ["in", null],
      ["out", "sent"],
    ]);
  });

  it("sin mensajes no hay secciones", () => {
    expect(threadSections([], VIEWER, NOW)).toEqual([]);
  });
});
