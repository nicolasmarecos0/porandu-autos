import "server-only";

import {
  and,
  desc,
  eq,
  gt,
  gte,
  inArray,
  max,
  sql,
  type SQL,
} from "drizzle-orm";

import type { UnreadConversationSource } from "@/domains/cockpit/feed";
import type {
  MarkReadRequest,
  ReadCursor,
} from "@/domains/conversations/read-state";

import {
  contacts,
  conversationReads,
  conversations,
  messages,
} from "../schema";
import {
  withTenant,
  type ScopedTransaction,
  type TenantContext,
} from "../tenant";

/*
 * Leído interno de la bandeja (Hito 12B, DEC-044 §2): el cursor de cada
 * miembro por conversación.
 *
 * Lectura, dentro de la transacción del loader de /conversations
 * (getInbox(): requireTenant() → withTenant()):
 *   - selectUnreadCounts(): los entrantes sin leer de cada conversación de
 *     la lista, con `count(*) FILTER` sobre el índice parcial
 *     (organization_id, conversation_id, created_at).
 *   - selectReadCursor(): el cursor y la última respuesta propia de la
 *     conversación elegida, para el separador "Mensajes nuevos".
 * Y dentro de la del loader del Cockpit (getCockpitFeed(), Hito 15):
 *   - selectUnreadConversations(): las conversaciones con entrantes sin leer
 *     para quien mira, con la misma regla.
 *
 * Escritura: recordConversationRead() → withTenant() →
 *   private.mark_conversation_read() (SECURITY DEFINER): usuario en los
 *   claims → membership activa → conversación abierta de la organización y
 *   un mensaje de ella → cursor = created_at de ese mensaje, con GREATEST →
 *   COMMIT. La única puerta es la Server Action markConversationRead()
 *   (lib/conversations/read.ts); ESLint impide importar esta función desde
 *   cualquier otro módulo. Leer nunca marca nada.
 *
 * La regla es la de domains/conversations/read-state.ts:
 *   - el cursor es por miembro (`auth.uid()` = ctx.userId): que un vendedor
 *     lea no marca leído para otro;
 *   - solo cuentan los entrantes;
 *   - hasta dónde leyó es el más nuevo entre el cursor y su última
 *     respuesta en la conversación (responder es leer);
 *   - sin cursor ni respuesta propia, todo entrante está sin leer;
 *   - todo se mide con `created_at`, el reloj de la base, y se compara al
 *     milisegundo: la precisión con la que el dominio (`Date`) arma el
 *     separador y elige hasta dónde marcar. Así la lista y el historial
 *     cuentan lo mismo, y marcar el mensaje más nuevo en pantalla siempre
 *     deja la conversación en cero (la base guarda el instante completo).
 * La organización sale del TenantContext, nunca del pedido: las lecturas la
 * usan como filtro explícito (sobre RLS, que además deja ver solo los
 * cursores propios) y la función la vuelve a validar.
 */

/*
 * Las dos piezas de la regla, compartidas por las lecturas que cuentan no
 * leídos (la lista de /conversations y el feed del Cockpit): las dos se
 * usan sobre una fila externa de `conversations` unida a
 * `conversation_reads` del miembro y a ownReplyOf() como LATERAL.
 */

/**
 * La última respuesta de `userId` en la conversación de la fila externa:
 * responder es leer (DEC-044 §2.4). Va como LATERAL; la recorre hacia atrás
 * el índice parcial (organization_id, conversation_id, created_at).
 */
function ownReplyOf(tx: ScopedTransaction, userId: string) {
  return tx
    .select({ at: max(messages.createdAt).as("at") })
    .from(messages)
    .where(
      and(
        eq(messages.organizationId, conversations.organizationId),
        eq(messages.conversationId, conversations.id),
        eq(messages.direction, "outbound"),
        eq(messages.recordedBy, userId),
      ),
    )
    .as("own_reply");
}

/**
 * El primer instante sin leer: el milisegundo siguiente al de hasta dónde
 * leyó (el más nuevo entre el cursor y la respuesta propia). Sin cursor ni
 * respuesta propia, todo está sin leer (DEC-044 §2.6).
 */
function unreadFrom(): SQL {
  return sql`coalesce(date_trunc('milliseconds', greatest(${conversationReads.readUpTo}, ${sql.identifier("own_reply")}.${sql.identifier("at")})) + interval '1 millisecond', '-infinity'::timestamptz)`;
}

/**
 * Los entrantes sin leer para quien mira de cada conversación pedida, de la
 * organización activa. Una conversación sin no leídos (o que no es de la
 * organización) queda en 0. Solo lee.
 */
export async function selectUnreadCounts(
  tx: ScopedTransaction,
  ctx: TenantContext,
  conversationIds: readonly string[],
): Promise<ReadonlyMap<string, number>> {
  if (conversationIds.length === 0) return new Map();
  const { organizationId, userId } = ctx;

  const ownReply = ownReplyOf(tx, userId);

  // Los entrantes registrados desde el primer instante sin leer, por
  // conversación. Como subconsulta LATERAL el instante llega como parámetro:
  // el índice parcial recorre solo el rango sin leer, no toda la
  // conversación.
  const unread = tx
    .select({
      count:
        sql<number>`count(*) FILTER (WHERE ${messages.direction} = 'inbound')`
          .mapWith(Number)
          .as("unread_count"),
    })
    .from(messages)
    .where(
      and(
        eq(messages.organizationId, conversations.organizationId),
        eq(messages.conversationId, conversations.id),
        gte(messages.createdAt, unreadFrom()),
      ),
    )
    .as("unread");

  const rows = await tx
    .select({ conversationId: conversations.id, unread: unread.count })
    .from(conversations)
    .leftJoin(
      conversationReads,
      and(
        eq(conversationReads.organizationId, conversations.organizationId),
        eq(conversationReads.conversationId, conversations.id),
        eq(conversationReads.userId, userId),
      ),
    )
    .leftJoinLateral(ownReply, sql`true`)
    .leftJoinLateral(unread, sql`true`)
    .where(
      and(
        eq(conversations.organizationId, organizationId),
        inArray(conversations.id, [...conversationIds]),
      ),
    );

  return new Map(rows.map((row) => [row.conversationId, row.unread]));
}

/**
 * Las conversaciones abiertas de la organización activa con entrantes sin
 * leer para quien mira (Hito 15, DEC-047 §2): las `limit` con el entrante
 * sin leer más nuevo, de la más reciente a la más vieja, con el total de
 * conversaciones y de entrantes sin leer en la misma lectura (`over ()`, se
 * calcula antes del LIMIT). Misma regla y mismos LATERAL que
 * selectUnreadCounts(), sobre el índice parcial (organization_id,
 * conversation_id, created_at): por conversación abierta, una búsqueda de
 * la respuesta propia, una del rango sin leer y una del más nuevo.
 *
 * El orden es (entrante sin leer más nuevo al milisegundo desc, id desc): el
 * del feed (domains/cockpit/feed.ts), para que la mezcla de fuentes sea
 * exacta. Solo lee: el Cockpit nunca marca nada como visto (DEC-044 §2.7).
 */
export async function selectUnreadConversations(
  tx: ScopedTransaction,
  ctx: TenantContext,
  limit: number,
): Promise<UnreadConversationSource> {
  const { organizationId, userId } = ctx;

  const ownReply = ownReplyOf(tx, userId);

  const unread = tx
    .select({
      count:
        sql<number>`count(*) FILTER (WHERE ${messages.direction} = 'inbound')`
          .mapWith(Number)
          .as("unread_count"),
      lastAt:
        sql<Date | null>`max(${messages.createdAt}) FILTER (WHERE ${messages.direction} = 'inbound')`
          .mapWith(messages.createdAt)
          .as("last_unread_at"),
    })
    .from(messages)
    .where(
      and(
        eq(messages.organizationId, conversations.organizationId),
        eq(messages.conversationId, conversations.id),
        gte(messages.createdAt, unreadFrom()),
      ),
    )
    .as("unread");

  // El texto del entrante sin leer más nuevo (el preview del feed).
  const latest = tx
    .select({ content: messages.content })
    .from(messages)
    .where(
      and(
        eq(messages.organizationId, conversations.organizationId),
        eq(messages.conversationId, conversations.id),
        eq(messages.direction, "inbound"),
        gte(messages.createdAt, unreadFrom()),
      ),
    )
    .orderBy(desc(messages.createdAt), desc(messages.id))
    .limit(1)
    .as("latest_unread");

  const rows = await tx
    .select({
      conversationId: conversations.id,
      contactName: contacts.name,
      unread: unread.count,
      lastUnreadAt: unread.lastAt,
      lastUnreadContent: latest.content,
      total: sql<number>`count(*) over ()`.mapWith(Number),
      unreadMessages: sql<number>`sum(${unread.count}) over ()`.mapWith(Number),
    })
    .from(conversations)
    .innerJoin(
      contacts,
      and(
        eq(contacts.organizationId, conversations.organizationId),
        eq(contacts.id, conversations.contactId),
      ),
    )
    .leftJoin(
      conversationReads,
      and(
        eq(conversationReads.organizationId, conversations.organizationId),
        eq(conversationReads.conversationId, conversations.id),
        eq(conversationReads.userId, userId),
      ),
    )
    .leftJoinLateral(ownReply, sql`true`)
    .leftJoinLateral(unread, sql`true`)
    .leftJoinLateral(latest, sql`true`)
    .where(
      and(
        eq(conversations.organizationId, organizationId),
        eq(conversations.status, "open"),
        gt(unread.count, 0),
      ),
    )
    .orderBy(
      sql`date_trunc('milliseconds', ${unread.lastAt}) DESC`,
      desc(conversations.id),
    )
    .limit(limit);

  const shown = rows.flatMap((row) =>
    row.lastUnreadAt !== null && row.lastUnreadContent !== null
      ? [
          {
            conversationId: row.conversationId,
            contactName: row.contactName,
            unread: row.unread,
            lastUnreadAt: row.lastUnreadAt,
            lastUnreadContent: row.lastUnreadContent,
          },
        ]
      : [],
  );
  return {
    rows: shown,
    total: rows[0]?.total ?? 0,
    unreadMessages: rows[0]?.unreadMessages ?? 0,
  };
}

/**
 * Hasta dónde leyó quien mira una conversación de la organización activa:
 * su cursor y su última respuesta, sin combinarlos (lo hace el dominio).
 * Solo lee.
 */
export async function selectReadCursor(
  tx: ScopedTransaction,
  ctx: TenantContext,
  conversationId: string,
): Promise<ReadCursor> {
  const { organizationId, userId } = ctx;

  const [cursor] = await tx
    .select({ readUpTo: conversationReads.readUpTo })
    .from(conversationReads)
    .where(
      and(
        eq(conversationReads.organizationId, organizationId),
        eq(conversationReads.conversationId, conversationId),
        eq(conversationReads.userId, userId),
      ),
    )
    .limit(1);

  const [reply] = await tx
    .select({ at: max(messages.createdAt) })
    .from(messages)
    .where(
      and(
        eq(messages.organizationId, organizationId),
        eq(messages.conversationId, conversationId),
        eq(messages.direction, "outbound"),
        eq(messages.recordedBy, userId),
      ),
    );

  return {
    readUpTo: cursor?.readUpTo ?? null,
    lastOwnReplyAt: reply?.at ?? null,
  };
}

export type ConversationReadOutcome =
  /** El cursor avanzó hasta el mensaje. */
  | Readonly<{ outcome: "marked"; readUpTo: Date }>
  /** Ya estaba en ese mensaje o más adelante: no se escribió nada. */
  | Readonly<{ outcome: "unchanged"; readUpTo: Date }>
  /**
   * La conversación no está abierta en la organización activa, o el
   * mensaje no es de ella. Nada se escribió.
   */
  | Readonly<{ outcome: "not_found" }>;

type MarkRow = {
  outcome: string;
  read_up_to: Date | string | null;
};

function instant(value: Date | string | null): Date | null {
  if (value === null) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

/**
 * Marca visto hasta un mensaje de la conversación, como el miembro de los
 * claims. El pedido ya viene validado (parseMarkRead()); que los ids sean
 * UUIDs no significa que sean de la organización activa: eso lo decide la
 * función. Idempotente.
 */
export async function recordConversationRead(
  ctx: TenantContext,
  request: MarkReadRequest,
): Promise<ConversationReadOutcome> {
  return withTenant(ctx, async (tx) => {
    const [row] = await tx.execute<MarkRow>(
      sql`SELECT * FROM private.mark_conversation_read(${ctx.organizationId}::uuid, ${request.conversationId}::uuid, ${request.upToMessageId}::uuid)`,
    );
    if (!row) throw new Error("mark returned no row");
    if (row.outcome === "not_found") return { outcome: "not_found" };
    const readUpTo = instant(row.read_up_to);
    if (
      (row.outcome !== "marked" && row.outcome !== "unchanged") ||
      readUpTo === null
    ) {
      throw new Error("mark returned an unexpected row");
    }
    return { outcome: row.outcome, readUpTo };
  });
}
