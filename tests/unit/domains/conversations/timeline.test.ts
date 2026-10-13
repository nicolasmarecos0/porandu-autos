import { describe, expect, it } from "vitest";

import type { MessageRow } from "@/domains/conversations/messages";
import { activityTimeline } from "@/domains/conversations/timeline";
import type { NoteRow } from "@/domains/opportunities/notes";

/*
 * Muro de actividad (Hito 4, DEC-036 §11): notas y mensajes juntos, del
 * registro más reciente al más viejo, con autor y fecha de Asunción.
 */

const VIEWER = "00000000-0000-4000-8000-00000000000a";
const OTHER = "00000000-0000-4000-8000-00000000000c";

const note = (id: string, at: string, recordedBy = VIEWER): NoteRow => ({
  id,
  body: `Nota ${id}`,
  recordedBy,
  recordedAt: new Date(at),
});

const message = (
  id: string,
  at: string,
  overrides: Partial<MessageRow> = {},
): MessageRow => ({
  id,
  channel: "whatsapp",
  direction: "inbound",
  content: `Mensaje ${id}`,
  recordedBy: VIEWER,
  createdAt: new Date(at),
  ...overrides,
});

describe("activityTimeline", () => {
  it("intercala notas y mensajes del más reciente al más viejo", () => {
    expect(
      activityTimeline(
        [
          note("n1", "2026-10-11T12:00:00Z"),
          note("n2", "2026-10-13T12:00:00Z"),
        ],
        [
          message("m1", "2026-10-12T12:00:00Z"),
          message("m2", "2026-10-10T12:00:00Z"),
        ],
        VIEWER,
      ).map((entry) => entry.id),
    ).toEqual(["n2", "m1", "n1", "m2"]);
  });

  it("presenta cada tipo con su etiqueta, canal, autor y fecha de Asunción", () => {
    expect(
      activityTimeline(
        [note("n1", "2026-10-11T12:00:00Z")],
        [
          message("m1", "2026-10-11T17:32:00Z", {
            channel: "email",
            direction: "outbound",
            recordedBy: OTHER,
            content: "Te paso la cotización.",
          }),
          message("m2", "2026-10-11T18:00:00Z", { channel: "manual" }),
        ],
        VIEWER,
      ),
    ).toEqual([
      {
        kind: "message",
        id: "m2",
        label: "Mensaje recibido",
        channel: "manual",
        channelLabel: "Otro medio",
        direction: "inbound",
        body: "Mensaje m2",
        author: "Vos",
        at: "11 oct 2026 15:00",
      },
      {
        kind: "message",
        id: "m1",
        label: "Mensaje enviado",
        channel: "email",
        channelLabel: "Email",
        direction: "outbound",
        body: "Te paso la cotización.",
        author: "Otro miembro",
        at: "11 oct 2026 14:32",
      },
      {
        kind: "note",
        id: "n1",
        label: "Nota",
        body: "Nota n1",
        author: "Vos",
        at: "11 oct 2026 09:00",
      },
    ]);
  });

  it("a igual instante, el orden es determinista: mensajes primero y por id", () => {
    const at = "2026-10-11T12:00:00Z";
    expect(
      activityTimeline(
        [note("1", at), note("3", at)],
        [message("2", at), message("4", at)],
        VIEWER,
      ).map((entry) => `${entry.kind}:${entry.id}`),
    ).toEqual(["message:4", "message:2", "note:3", "note:1"]);
  });

  it("sin notas ni mensajes, el muro está vacío", () => {
    expect(activityTimeline([], [], VIEWER)).toEqual([]);
  });

  it("no expone ids de usuario", () => {
    const entries = activityTimeline(
      [note("n", "2026-10-11T12:00:00Z", OTHER)],
      [message("m", "2026-10-11T12:00:00Z", { recordedBy: OTHER })],
      VIEWER,
    );
    expect(JSON.stringify(entries)).not.toContain(OTHER);
    expect(JSON.stringify(entries)).not.toContain(VIEWER);
  });
});
