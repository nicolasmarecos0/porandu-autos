import { chatDayKey, chatDayLabel, chatTime } from "./chat-time";
import { INITIAL_DELIVERY_STATUS, type DeliveryStatus } from "./delivery";
import {
  compareThreadRows,
  threadInstant,
  threadMessage,
  type ThreadMessage,
  type ThreadMessageRow,
} from "./inbox";

/*
 * El historial como chat (Hito 12, DEC-044 §1): los mensajes de la
 * conversación del más viejo al más nuevo, agrupados por día de calendario
 * de Asunción, y las burbujas seguidas del mismo autor unidas en un grupo.
 * Puro y determinista: el orden es el de compareThreadRows() (`sent_at`,
 * después el registro y el id) y los rótulos de día dependen de `now`.
 */

/**
 * Dos mensajes seguidos del mismo autor, en el mismo día y a lo sumo a
 * esta distancia, forman un grupo: solo el primero lleva el autor y la cola
 * de la burbuja.
 */
export const BUBBLE_GROUP_GAP_MS = 5 * 60 * 1000;

/** Lugar de una burbuja en su grupo. */
export type BubblePosition = "single" | "first" | "middle" | "last";

/** Un mensaje del historial, listo para mostrar como burbuja. */
export type ThreadBubble = ThreadMessage &
  Readonly<{
    /** Hora de Asunción: "14:32". El día lo dice su sección. */
    time: string;
    /** El instante en ISO 8601, para `<time dateTime>`. */
    dateTime: string;
    position: BubblePosition;
    /**
     * Solo en un saliente: su estado de entrega. Hasta que entre la ingesta
     * de estados (DEC-044 §3), todo saliente es INITIAL_DELIVERY_STATUS: la
     * base lo registra después de que Meta lo aceptó (DEC-040 §6).
     */
    delivery: DeliveryStatus | null;
  }>;

/** Los mensajes de un día de Asunción. */
export type ThreadSection = Readonly<{
  /** "2026-10-29": único en el historial. */
  key: string;
  /** "Hoy", "Ayer", "Lunes 26 de octubre" o "26 de octubre de 2025". */
  label: string;
  bubbles: readonly ThreadBubble[];
}>;

type Placed = Readonly<{
  message: ThreadMessage;
  at: Date;
  dayKey: string;
}>;

function joins(previous: Placed | undefined, current: Placed): boolean {
  return (
    previous !== undefined &&
    previous.dayKey === current.dayKey &&
    previous.message.direction === current.message.direction &&
    previous.message.author === current.message.author &&
    current.at.getTime() - previous.at.getTime() <= BUBBLE_GROUP_GAP_MS
  );
}

function positionOf(
  joinsPrevious: boolean,
  joinsNext: boolean,
): BubblePosition {
  if (joinsPrevious) return joinsNext ? "middle" : "last";
  return joinsNext ? "first" : "single";
}

/**
 * El historial de una conversación por día, contra el usuario que mira
 * (autor "Cliente", "Vos" u "Otro miembro") y el instante de la request.
 */
export function threadSections(
  rows: readonly ThreadMessageRow[],
  viewerUserId: string,
  now: Date,
): readonly ThreadSection[] {
  const placed: Placed[] = rows.toSorted(compareThreadRows).map((row) => {
    const at = threadInstant(row);
    return {
      message: threadMessage(row, viewerUserId),
      at,
      dayKey: chatDayKey(at),
    };
  });

  const sections: { key: string; label: string; bubbles: ThreadBubble[] }[] =
    [];
  placed.forEach((item, index) => {
    const joinsPrevious = joins(placed[index - 1], item);
    const next = placed[index + 1];
    const joinsNext = next !== undefined && joins(item, next);
    let section = sections.at(-1);
    if (section === undefined || section.key !== item.dayKey) {
      section = {
        key: item.dayKey,
        label: chatDayLabel(item.at, now),
        bubbles: [],
      };
      sections.push(section);
    }
    section.bubbles.push({
      ...item.message,
      time: chatTime(item.at),
      dateTime: item.at.toISOString(),
      position: positionOf(joinsPrevious, joinsNext),
      delivery:
        item.message.direction === "outbound" ? INITIAL_DELIVERY_STATUS : null,
    });
  });
  return sections;
}
