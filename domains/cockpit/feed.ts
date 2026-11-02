import { vehicleLabel } from "@/domains/calendar/agenda";
import {
  TEST_DRIVE_STATUS_LABELS,
  type TestDriveStatus,
} from "@/domains/calendar/test-drives";
import {
  chatDayKey,
  chatDayLabel,
  chatDaysAgo,
  chatTime,
} from "@/domains/conversations/chat-time";
import { messagePreview } from "@/domains/conversations/conversations";
import { unreadState } from "@/domains/conversations/read-state";
import { formatMoney, type Currency } from "@/domains/money";
import type { Stage } from "@/domains/opportunities/stages";
import { quoteExportability } from "@/domains/quotes/exportability";
import { quoteNumberLabel } from "@/domains/quotes/presentation";
import {
  isQuotableStage,
  quoteDisplayStatus,
  type QuoteDisplayStatus,
  type QuoteStatus,
} from "@/domains/quotes/statuses";

import {
  COCKPIT_TIME_ZONE,
  RECENT_EVENT_LIMIT,
  RECENT_WINDOW_DAYS,
  testDrivePhase,
  type CockpitWindow,
  type TestDrivePhase,
} from "./window";

/*
 * Feed de actividad del Cockpit (Hito 15, DEC-047): lo que el vendedor
 * tiene que ver hoy, de cuatro fuentes, en una sola línea de tiempo. Puro y
 * determinista: recibe las filas que el loader leyó en una transacción
 * (db/queries/cockpit.ts) y el instante de la request, y arma el ViewModel.
 * No carga datos, no conoce rutas (cada acción dice a qué apunta, y la UI
 * arma el enlace) y no escribe nada.
 *
 *   Próximas  · pruebas abiertas en curso o por venir hasta mañana,
 *               de la más cercana a la más lejana
 *   ── ahora ──────────────────────────────────────────────────────────────
 *   Hoy       · chats sin leer, pruebas vencidas, cotizaciones movidas y
 *   Ayer        notas de otros miembros, del más nuevo al más viejo,
 *   …           agrupados por día de Asunción
 *
 * Mezcla exacta. Cada fuente reciente llega ordenada por (instante desc, id
 * desc) al milisegundo y con a lo sumo RECENT_EVENT_LIMIT filas. Los
 * primeros RECENT_EVENT_LIMIT eventos de la unión están, entonces, entre los
 * primeros RECENT_EVENT_LIMIT de cada fuente: ordenar la concatenación con
 * el mismo orden total (y el tipo como desempate entre fuentes) y cortar da
 * exactamente el feed que daría un UNION ALL con un ORDER BY global, sin
 * pedirle a la base que mezcle filas de formas distintas.
 */

/* ── Lo que lee el loader ───────────────────────────────────────────────── */

/** Una fuente: las filas mostradas (ya ordenadas y cortadas) y su total. */
export type FeedSource<Row> = Readonly<{
  rows: readonly Row[];
  /** Cuántas cumplen el filtro, antes del tope (`count(*) over ()`). */
  total: number;
}>;

/**
 * Una conversación abierta con entrantes sin leer para quien mira, con la
 * regla del leído por miembro (DEC-044 §2).
 */
export type UnreadConversationRow = Readonly<{
  conversationId: string;
  contactName: string;
  /** Entrantes sin leer. Siempre > 0. */
  unread: number;
  /** `created_at` (reloj de la base) del entrante sin leer más nuevo. */
  lastUnreadAt: Date;
  /** Texto de ese entrante. */
  lastUnreadContent: string;
}>;

/** Las conversaciones sin leer, con el total de entrantes sin leer. */
export type UnreadConversationSource = FeedSource<UnreadConversationRow> &
  Readonly<{
    /** Entrantes sin leer de todas las conversaciones (`sum() over ()`). */
    unreadMessages: number;
  }>;

/** Una prueba de manejo abierta (`scheduled` o `confirmed`). */
export type CockpitTestDriveRow = Readonly<{
  id: string;
  status: TestDriveStatus;
  scheduledAt: Date;
  opportunityId: string;
  contactName: string;
  vehicleBrand: string;
  vehicleModel: string;
  vehicleYear: number;
}>;

/** Una cotización movida en la ventana: su último cambio es `updated_at`. */
export type CockpitQuoteRow = Readonly<{
  id: string;
  number: number;
  status: QuoteStatus;
  /** Último día de validez, "AAAA-MM-DD". */
  validUntil: string;
  currency: Currency;
  totalPrice: string;
  /** El último cambio de estado (o el alta): lo fija el trigger de la base. */
  updatedAt: Date;
  opportunityId: string;
  opportunityStage: Stage;
  contactName: string;
  vehicleBrand: string;
  vehicleModel: string;
  vehicleYear: number;
}>;

/** Una nota de la bitácora registrada por otro miembro. */
export type CockpitNoteRow = Readonly<{
  id: string;
  opportunityId: string;
  contactName: string;
  body: string;
  recordedAt: Date;
}>;

export type CockpitSources = Readonly<{
  unreadConversations: UnreadConversationSource;
  upcomingTestDrives: FeedSource<CockpitTestDriveRow>;
  overdueTestDrives: FeedSource<CockpitTestDriveRow>;
  quotes: FeedSource<CockpitQuoteRow>;
  notes: FeedSource<CockpitNoteRow>;
}>;

/* ── El evento ──────────────────────────────────────────────────────────── */

export const COCKPIT_EVENT_KINDS = [
  "message",
  "test_drive",
  "quote",
  "note",
] as const;

export type CockpitEventKind = (typeof COCKPIT_EVENT_KINDS)[number];

/**
 * A dónde lleva la acción rápida de un evento. Es un destino, no una URL:
 * las rutas viven en la UI (components/cockpit/links.ts).
 */
export type CockpitTarget =
  /** La conversación abierta en la bandeja (`/conversations?c=`). */
  | Readonly<{ kind: "conversation"; conversationId: string }>
  /** La agenda con ese día en foco (`/calendar?w=`, DEC-045 §2). */
  | Readonly<{ kind: "calendar_day"; day: string }>
  /** El presupuesto de la cotización (DEC-046 §6). */
  | Readonly<{ kind: "quote"; opportunityId: string; quoteId: string }>
  /** El workspace de la oportunidad. */
  | Readonly<{ kind: "opportunity"; opportunityId: string }>;

export type CockpitAction = Readonly<{
  /** Verbo visible: "Responder", "Ver PDF"… */
  label: string;
  target: CockpitTarget;
}>;

type EventBase = Readonly<{
  /** Único en el feed: `tipo:id`. */
  key: string;
  /** Instante que ordena el evento. */
  at: Date;
  /** "14:32" en Recientes; "Hoy 15:00" o "Mañana 10:00" en Próximas. */
  timeLabel: string;
  /** Fecha y hora completas, para el `title`: "Lunes 2 de noviembre de 2026, 14:32". */
  timeTitle: string;
  /** Con quién: el cliente. */
  title: string;
  /** Qué pasó, en una línea. */
  headline: string;
  /** Contexto secundario (preview, unidad, total), o null. */
  detail: string | null;
  action: CockpitAction;
}>;

export type CockpitEvent =
  | (EventBase & Readonly<{ kind: "message"; unread: number }>)
  | (EventBase &
      Readonly<{
        kind: "test_drive";
        status: TestDriveStatus;
        phase: TestDrivePhase;
      }>)
  | (EventBase & Readonly<{ kind: "quote"; status: QuoteDisplayStatus }>)
  | (EventBase & Readonly<{ kind: "note" }>);

/* ── Copy ───────────────────────────────────────────────────────────────── */

/** Verbos de las acciones rápidas. */
export const COCKPIT_ACTION_LABELS = {
  reply: "Responder",
  openAgenda: "Ver en agenda",
  recordOutcome: "Registrar resultado",
  approveQuote: "Revisar y aprobar",
  viewPdf: "Ver PDF",
  viewQuote: "Ver presupuesto",
  viewOpportunity: "Ver oportunidad",
} as const;

/** Rótulos de las fases de una prueba abierta que se muestran como estado. */
export const TEST_DRIVE_PHASE_LABELS: Readonly<
  Record<Exclude<TestDrivePhase, "upcoming">, string>
> = {
  in_progress: "En curso",
  overdue: "Vencida",
};

const TEST_DRIVE_HEADLINE = "Prueba de manejo";
const NOTE_HEADLINE = "Nota de otro miembro";

/* ── Fecha y hora ───────────────────────────────────────────────────────── */

const LONG_DATE = new Intl.DateTimeFormat("es-PY", {
  timeZone: COCKPIT_TIME_ZONE,
  weekday: "long",
  day: "numeric",
  month: "long",
  year: "numeric",
});

function capitalize(text: string): string {
  const [first = "", ...rest] = Array.from(text);
  return `${first.toLocaleUpperCase("es-PY")}${rest.join("")}`;
}

/**
 * "Lunes 2 de noviembre de 2026, 14:32". Se arma con las partes del
 * formato, no con su texto: la puntuación entre partes cambia entre
 * versiones de ICU.
 */
export function fullDateTime(at: Date): string {
  const parts = Object.fromEntries(
    LONG_DATE.formatToParts(at).map((part) => [part.type, part.value]),
  );
  const weekday = capitalize(parts.weekday ?? "");
  return `${weekday} ${parts.day ?? ""} de ${parts.month ?? ""} de ${parts.year ?? ""}, ${chatTime(at)}`;
}

/** Hora de una próxima prueba: "Hoy 15:00", "Mañana 10:00". */
export function upcomingTimeLabel(at: Date, now: Date): string {
  const daysAgo = chatDaysAgo(at, now);
  const day =
    daysAgo === 0 ? "Hoy" : daysAgo === -1 ? "Mañana" : chatDayLabel(at, now);
  return `${day} ${chatTime(at)}`;
}

/* ── Cada fuente, como evento ───────────────────────────────────────────── */

function messageEvent(row: UnreadConversationRow): CockpitEvent {
  const state = unreadState(row.unread);
  return {
    kind: "message",
    key: `message:${row.conversationId}`,
    at: row.lastUnreadAt,
    timeLabel: chatTime(row.lastUnreadAt),
    timeTitle: fullDateTime(row.lastUnreadAt),
    title: row.contactName,
    headline: state.kind === "unread" ? state.description : "Mensajes sin leer",
    detail: messagePreview(row.lastUnreadContent),
    unread: row.unread,
    action: {
      label: COCKPIT_ACTION_LABELS.reply,
      target: { kind: "conversation", conversationId: row.conversationId },
    },
  };
}

function testDriveEvent(
  row: CockpitTestDriveRow,
  now: Date,
  timeLabel: string,
): CockpitEvent {
  const phase = testDrivePhase(row.scheduledAt, now);
  const vehicle = vehicleLabel(
    row.vehicleBrand,
    row.vehicleModel,
    row.vehicleYear,
  );
  return {
    kind: "test_drive",
    key: `test_drive:${row.id}`,
    at: row.scheduledAt,
    timeLabel,
    timeTitle: fullDateTime(row.scheduledAt),
    title: row.contactName,
    headline: TEST_DRIVE_HEADLINE,
    // Por venir, el estado guardado es el chip ("Agendada", "Confirmada").
    // En curso o vencida, el chip es la fase y el estado pasa al detalle.
    detail:
      phase === "upcoming"
        ? vehicle
        : `${vehicle} · ${TEST_DRIVE_STATUS_LABELS[row.status]}`,
    status: row.status,
    phase,
    action: {
      label:
        phase === "overdue"
          ? COCKPIT_ACTION_LABELS.recordOutcome
          : COCKPIT_ACTION_LABELS.openAgenda,
      target: { kind: "calendar_day", day: chatDayKey(row.scheduledAt) },
    },
  };
}

/**
 * La acción de una cotización es su siguiente paso:
 * - un borrador vigente de una oportunidad cotizable se revisa y aprueba
 *   (el paso de aprobación humana obligatorio, DEC-042 §2);
 * - una que se puede entregar abre el presupuesto que se descarga en PDF
 *   (la misma regla del servidor, quoteExportability(), DEC-046 §2);
 * - cualquier otra se mira: vencida, anulada, rechazada o de una
 *   oportunidad cerrada.
 * Las tres llevan a la vista previa: ahí están "Aprobar" y "Descargar PDF",
 * cada una con su confirmación y su regla. El Cockpit no cambia nada.
 */
function quoteAction(row: CockpitQuoteRow, today: string): CockpitAction {
  const target: CockpitTarget = {
    kind: "quote",
    opportunityId: row.opportunityId,
    quoteId: row.id,
  };
  const display = quoteDisplayStatus(row.status, row.validUntil, today);
  if (display === "draft" && isQuotableStage(row.opportunityStage)) {
    return { label: COCKPIT_ACTION_LABELS.approveQuote, target };
  }
  const exportability = quoteExportability(
    {
      status: row.status,
      validUntil: row.validUntil,
      opportunityStage: row.opportunityStage,
    },
    today,
  );
  return {
    label: exportability.exportable
      ? COCKPIT_ACTION_LABELS.viewPdf
      : COCKPIT_ACTION_LABELS.viewQuote,
    target,
  };
}

function quoteEvent(row: CockpitQuoteRow, today: string): CockpitEvent {
  return {
    kind: "quote",
    key: `quote:${row.id}`,
    at: row.updatedAt,
    timeLabel: chatTime(row.updatedAt),
    timeTitle: fullDateTime(row.updatedAt),
    title: row.contactName,
    headline: `Cotización ${quoteNumberLabel(row.number)}`,
    detail: `${vehicleLabel(row.vehicleBrand, row.vehicleModel, row.vehicleYear)} · ${formatMoney({ amount: row.totalPrice, currency: row.currency })}`,
    status: quoteDisplayStatus(row.status, row.validUntil, today),
    action: quoteAction(row, today),
  };
}

function noteEvent(row: CockpitNoteRow): CockpitEvent {
  return {
    kind: "note",
    key: `note:${row.id}`,
    at: row.recordedAt,
    timeLabel: chatTime(row.recordedAt),
    timeTitle: fullDateTime(row.recordedAt),
    title: row.contactName,
    headline: NOTE_HEADLINE,
    detail: messagePreview(row.body),
    action: {
      label: COCKPIT_ACTION_LABELS.viewOpportunity,
      target: { kind: "opportunity", opportunityId: row.opportunityId },
    },
  };
}

/* ── Orden ──────────────────────────────────────────────────────────────── */

/**
 * Desempate entre fuentes a igual milisegundo: primero lo que espera al
 * cliente (un mensaje), después la agenda, las cotizaciones y las notas.
 */
const KIND_ORDER: Readonly<Record<CockpitEventKind, number>> = {
  message: 0,
  test_drive: 1,
  quote: 2,
  note: 3,
};

/** El id del registro que originó el evento (el de su fila). */
function sourceId(event: CockpitEvent): string {
  return event.key.slice(event.key.indexOf(":") + 1);
}

/**
 * Orden de Recientes: del más nuevo al más viejo; a igual milisegundo, por
 * tipo y después por id descendente (el mismo desempate que la base, que
 * ordena cada fuente por (instante desc, id desc)). Los UUID en minúsculas
 * se comparan como texto igual que como bytes. Es un orden total: el feed
 * es determinista.
 */
export function compareRecent(a: CockpitEvent, b: CockpitEvent): number {
  const byTime = b.at.getTime() - a.at.getTime();
  if (byTime !== 0) return byTime;
  const byKind = KIND_ORDER[a.kind] - KIND_ORDER[b.kind];
  if (byKind !== 0) return byKind;
  const idA = sourceId(a);
  const idB = sourceId(b);
  return idA < idB ? 1 : idA > idB ? -1 : 0;
}

/** Orden de Próximas: de la más cercana a la más lejana; a igual hora, por id. */
export function compareUpcoming(a: CockpitEvent, b: CockpitEvent): number {
  const byTime = a.at.getTime() - b.at.getTime();
  if (byTime !== 0) return byTime;
  const idA = sourceId(a);
  const idB = sourceId(b);
  return idA < idB ? -1 : idA > idB ? 1 : 0;
}

/**
 * Los eventos recientes de todas las fuentes, ordenados y cortados en
 * RECENT_EVENT_LIMIT (ver "Mezcla exacta" arriba).
 */
export function mergeRecent(
  sources: CockpitSources,
  window: CockpitWindow,
): CockpitEvent[] {
  return [
    ...sources.unreadConversations.rows.map(messageEvent),
    ...sources.overdueTestDrives.rows.map((row) =>
      testDriveEvent(row, window.now, chatTime(row.scheduledAt)),
    ),
    ...sources.quotes.rows.map((row) => quoteEvent(row, window.today)),
    ...sources.notes.rows.map(noteEvent),
  ]
    .sort(compareRecent)
    .slice(0, RECENT_EVENT_LIMIT);
}

/* ── El ViewModel ───────────────────────────────────────────────────────── */

/** Un día de Recientes: "Hoy", "Ayer", "Lunes 26 de octubre". */
export type CockpitDayGroup = Readonly<{
  /** "AAAA-MM-DD" de Asunción. */
  key: string;
  label: string;
  events: readonly CockpitEvent[];
}>;

/** Agrupa eventos ya ordenados por día de Asunción, conservando el orden. */
export function groupByDay(
  events: readonly CockpitEvent[],
  now: Date,
): CockpitDayGroup[] {
  const groups: { key: string; label: string; events: CockpitEvent[] }[] = [];
  for (const event of events) {
    const key = chatDayKey(event.at);
    const last = groups.at(-1);
    if (last && last.key === key) {
      last.events.push(event);
    } else {
      groups.push({ key, label: chatDayLabel(event.at, now), events: [event] });
    }
  }
  return groups;
}

export const COCKPIT_SUMMARY_KEYS = [
  "unread",
  "upcoming",
  "overdue",
  "quotes",
] as const;

export type CockpitSummaryKey = (typeof COCKPIT_SUMMARY_KEYS)[number];

/** Un número de la franja superior. */
export type CockpitSummaryTile = Readonly<{
  key: CockpitSummaryKey;
  label: string;
  value: number;
  /** El alcance o lo que pide el número, siempre en texto. */
  hint: string;
  /** Un número que pide acción (distinto de 0): se destaca junto a su texto. */
  attention: boolean;
}>;

function plural(count: number, one: string, many: string): string {
  return `${count.toLocaleString("es-PY")} ${count === 1 ? one : many}`;
}

/**
 * La franja: cuatro totales de las mismas lecturas del feed (sin consultas
 * agregadas aparte), así que siempre coinciden con lo que lista. Los totales
 * cuentan todo lo que cumple cada filtro, también lo que no entra en el
 * tope.
 */
export function cockpitSummary(sources: CockpitSources): CockpitSummaryTile[] {
  const unread = sources.unreadConversations;
  const overdue = sources.overdueTestDrives.total;
  return [
    {
      key: "unread",
      label: "Chats sin leer",
      value: unread.total,
      hint:
        unread.total === 0
          ? "Al día"
          : plural(unread.unreadMessages, "mensaje", "mensajes"),
      attention: unread.total > 0,
    },
    {
      key: "upcoming",
      label: "Próximas pruebas",
      value: sources.upcomingTestDrives.total,
      hint: "Hoy y mañana",
      attention: false,
    },
    {
      key: "overdue",
      label: "Pruebas vencidas",
      value: overdue,
      hint: overdue === 0 ? "Al día" : "Registrá el resultado",
      attention: overdue > 0,
    },
    {
      key: "quotes",
      label: "Cotizaciones",
      value: sources.quotes.total,
      hint: `Movidas en ${RECENT_WINDOW_DAYS} días`,
      attention: false,
    },
  ];
}

export type CockpitFeed = Readonly<{
  summary: readonly CockpitSummaryTile[];
  /** Próximas pruebas, de la más cercana a la más lejana. */
  upcoming: readonly CockpitEvent[];
  /** Cuántas próximas hay en total (también las que no entran en el tope). */
  upcomingTotal: number;
  /** Recientes, del más nuevo al más viejo, por día. */
  recent: readonly CockpitDayGroup[];
  /** Cuántos recientes se muestran. */
  recentShown: number;
  /** Cuántos recientes hay en total, sumando todas las fuentes. */
  recentTotal: number;
  /** Instante de la request, ISO: "Actualizado 14:32". */
  generatedAt: string;
  /** "14:32": la hora de Asunción del instante de la request. */
  generatedLabel: string;
}>;

/** El feed completo, desde las fuentes del loader. */
export function cockpitFeed(
  sources: CockpitSources,
  window: CockpitWindow,
): CockpitFeed {
  const recent = mergeRecent(sources, window);
  const upcoming = sources.upcomingTestDrives.rows
    .map((row) =>
      testDriveEvent(
        row,
        window.now,
        upcomingTimeLabel(row.scheduledAt, window.now),
      ),
    )
    .sort(compareUpcoming);
  return {
    summary: cockpitSummary(sources),
    upcoming,
    upcomingTotal: sources.upcomingTestDrives.total,
    recent: groupByDay(recent, window.now),
    recentShown: recent.length,
    recentTotal:
      sources.unreadConversations.total +
      sources.overdueTestDrives.total +
      sources.quotes.total +
      sources.notes.total,
    generatedAt: window.now.toISOString(),
    generatedLabel: chatTime(window.now),
  };
}

/** ¿No hay nada que mostrar? */
export function isCockpitFeedEmpty(feed: CockpitFeed): boolean {
  return feed.upcoming.length === 0 && feed.recentShown === 0;
}
