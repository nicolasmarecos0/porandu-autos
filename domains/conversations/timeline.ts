import { authorLabel, formatDemandDate } from "@/domains/demand/presentation";
import type { NoteRow } from "@/domains/opportunities/notes";

import {
  MESSAGE_CHANNEL_LABELS,
  type MessageChannel,
  type MessageDirection,
  type MessageRow,
} from "./messages";

/*
 * Muro de actividad de una oportunidad (Hito 4, DEC-036 §11): las notas de
 * la bitácora (DEC-033) y los mensajes registrados, juntos y en orden
 * cronológico. Puro y determinista: la presentación (autor "Vos" u "Otro
 * miembro", fecha de Asunción) se arma contra el usuario que mira y no
 * expone ids de usuario.
 */

/** Una entrada del muro, lista para mostrar. */
export type ActivityEntry =
  | Readonly<{
      kind: "note";
      id: string;
      /** "Nota". */
      label: string;
      body: string;
      /** "Vos" u "Otro miembro", contra el usuario que mira. */
      author: string;
      /** Fecha y hora de Asunción: "11 oct 2026 14:32". */
      at: string;
    }>
  | Readonly<{
      kind: "message";
      id: string;
      /** "Mensaje recibido" o "Mensaje enviado". */
      label: string;
      channel: MessageChannel;
      /** "WhatsApp", "Email" u "Otro medio". */
      channelLabel: string;
      direction: MessageDirection;
      body: string;
      author: string;
      at: string;
    }>;

const MESSAGE_LABELS: Readonly<Record<MessageDirection, string>> = {
  inbound: "Mensaje recibido",
  outbound: "Mensaje enviado",
};

type Dated = Readonly<{ entry: ActivityEntry; instant: Date }>;

/**
 * Notas y mensajes de una oportunidad en un solo muro, del registro más
 * reciente al más viejo (el orden de la bitácora, DEC-033 §8). A igual
 * instante el orden es determinista: primero los mensajes, y dentro de cada
 * tipo, por id descendente.
 */
export function activityTimeline(
  notes: readonly NoteRow[],
  messages: readonly MessageRow[],
  viewerUserId: string,
): readonly ActivityEntry[] {
  const dated: Dated[] = [
    ...notes.map((note) => ({
      instant: note.recordedAt,
      entry: {
        kind: "note" as const,
        id: note.id,
        label: "Nota",
        body: note.body,
        author: authorLabel(note.recordedBy, viewerUserId),
        at: formatDemandDate(note.recordedAt),
      },
    })),
    ...messages.map((message) => ({
      instant: message.createdAt,
      entry: {
        kind: "message" as const,
        id: message.id,
        label: MESSAGE_LABELS[message.direction],
        channel: message.channel,
        channelLabel: MESSAGE_CHANNEL_LABELS[message.channel],
        direction: message.direction,
        body: message.content,
        author: authorLabel(message.recordedBy, viewerUserId),
        at: formatDemandDate(message.createdAt),
      },
    })),
  ];
  return dated
    .toSorted(
      (a, b) =>
        b.instant.getTime() - a.instant.getTime() ||
        a.entry.kind.localeCompare(b.entry.kind) ||
        b.entry.id.localeCompare(a.entry.id),
    )
    .map(({ entry }) => entry);
}
