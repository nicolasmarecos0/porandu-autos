import "server-only";

import { and, desc, eq, inArray, sql } from "drizzle-orm";

import {
  inboxItems,
  INBOX_CONVERSATION_LIMIT,
  THREAD_MESSAGE_LIMIT,
  threadContact,
  threadRead,
  type Inbox,
  type InboxThread,
} from "@/domains/conversations/inbox";
import {
  conversationOpportunity,
  LINKABLE_STAGES,
  OPPORTUNITY_LINK_LIMIT,
} from "@/domains/conversations/opportunity-link";
import { threadSections } from "@/domains/conversations/thread-layout";
import { requireTenant } from "@/lib/tenant/session";

import { contacts, conversations, messages, opportunities } from "../schema";
import { withTenant } from "../tenant";
import { selectReadCursor, selectUnreadCounts } from "./conversation-reads";

/*
 * Bandeja de /conversations (Hito 8, DEC-040 §1; Hito 12, DEC-044). Solo lee:
 *
 *   request → requireTenant() → TenantContext → withTenant() → las
 *   conversaciones activas y el historial de la elegida, filtrados por la
 *   organización activa → RLS → domains/conversations/inbox.ts → ViewModel
 *
 * - La lista: las conversaciones `open` con su contacto, por
 *   `last_message_at` descendente (sin mensajes al final, por alta), a lo
 *   sumo INBOX_CONVERSATION_LIMIT, con el total en la misma lectura
 *   (`count(*) over ()`).
 * - La elegida: un id que no es UUID no llega a la base. Una de otra
 *   organización (aun con membership activa en ella), inexistente o cerrada
 *   es `not_found`, sin revelar cuál.
 * - El historial: los THREAD_MESSAGE_LIMIT mensajes más recientes de la
 *   conversación, con su total. Los ordena y agrupa por día de Asunción el
 *   dominio (threadSections()).
 * - La oportunidad (DEC-044 §4): las abiertas del contacto en la
 *   organización activa (a lo sumo OPPORTUNITY_LINK_LIMIT, por actividad
 *   más reciente) con su total. El dominio dice si hay una, ninguna o
 *   varias: la misma regla con la que la base asocia cada mensaje.
 * - Los no leídos de quien mira (Hito 12B, DEC-044 §2): el contador de cada
 *   conversación de la lista y, en la elegida, su cursor y su última
 *   respuesta, de los que el dominio saca el separador "Mensajes nuevos" y
 *   hasta dónde marcar visto (./conversation-reads.ts).
 * - Todo en la misma transacción. Leer no cambia nada: tampoco marca leído
 *   (un prefetch de la lista no puede marcar una conversación como vista).
 *   Marcar visto es la Server Action markConversationRead().
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Loader de /conversations. `selected` es el `?c=` de la URL, sin validar;
 * `now`, el instante de la request (rotula "Hoy", "Ayer" y la hora de chat).
 */
export async function getInbox(
  selected: string | undefined,
  now: Date = new Date(),
): Promise<Inbox> {
  const ctx = await requireTenant();
  const selectedId =
    selected !== undefined && UUID.test(selected)
      ? selected.toLowerCase()
      : null;

  return withTenant(ctx, async (tx) => {
    const { organizationId } = ctx;

    const list = await tx
      .select({
        id: conversations.id,
        contactName: contacts.name,
        lastMessageAt: conversations.lastMessageAt,
        lastMessagePreview: conversations.lastMessagePreview,
        total: sql<number>`count(*) over ()`.mapWith(Number),
      })
      .from(conversations)
      .innerJoin(
        contacts,
        and(
          eq(contacts.organizationId, conversations.organizationId),
          eq(contacts.id, conversations.contactId),
        ),
      )
      .where(
        and(
          eq(conversations.organizationId, organizationId),
          eq(conversations.status, "open"),
        ),
      )
      .orderBy(
        sql`${conversations.lastMessageAt} DESC NULLS LAST`,
        desc(conversations.createdAt),
        desc(conversations.id),
      )
      .limit(INBOX_CONVERSATION_LIMIT);

    const unread = await selectUnreadCounts(
      tx,
      ctx,
      list.map((row) => row.id),
    );

    let thread: InboxThread = { kind: "none" };
    if (selected !== undefined) thread = { kind: "not_found" };
    if (selectedId !== null) {
      const [conversation] = await tx
        .select({
          id: conversations.id,
          contactId: conversations.contactId,
          contactName: contacts.name,
          contactPhone: contacts.phone,
        })
        .from(conversations)
        .innerJoin(
          contacts,
          and(
            eq(contacts.organizationId, conversations.organizationId),
            eq(contacts.id, conversations.contactId),
          ),
        )
        .where(
          and(
            eq(conversations.organizationId, organizationId),
            eq(conversations.id, selectedId),
            eq(conversations.status, "open"),
          ),
        )
        .limit(1);

      if (conversation) {
        const rows = await tx
          .select({
            id: messages.id,
            direction: messages.direction,
            content: messages.content,
            recordedBy: messages.recordedBy,
            sentAt: messages.sentAt,
            createdAt: messages.createdAt,
            total: sql<number>`count(*) over ()`.mapWith(Number),
          })
          .from(messages)
          .where(
            and(
              eq(messages.organizationId, organizationId),
              // El contacto usa el índice (organization_id, contact_id, …).
              eq(messages.contactId, conversation.contactId),
              eq(messages.conversationId, conversation.id),
            ),
          )
          .orderBy(
            desc(messages.sentAt),
            desc(messages.createdAt),
            desc(messages.id),
          )
          .limit(THREAD_MESSAGE_LIMIT);

        const candidates = await tx
          .select({
            id: opportunities.id,
            stage: opportunities.stage,
            lastActivityAt: opportunities.lastActivityAt,
            total: sql<number>`count(*) over ()`.mapWith(Number),
          })
          .from(opportunities)
          .where(
            and(
              eq(opportunities.organizationId, organizationId),
              // Usa el índice (organization_id, contact_id).
              eq(opportunities.contactId, conversation.contactId),
              inArray(opportunities.stage, [...LINKABLE_STAGES]),
            ),
          )
          .orderBy(desc(opportunities.lastActivityAt), desc(opportunities.id))
          .limit(OPPORTUNITY_LINK_LIMIT);

        const cursor = await selectReadCursor(tx, ctx, conversation.id);

        thread = {
          kind: "found",
          conversationId: conversation.id,
          contact: threadContact(
            conversation.contactName,
            conversation.contactPhone,
          ),
          opportunity: conversationOpportunity(
            candidates,
            candidates[0]?.total ?? 0,
          ),
          sections: threadSections(rows, ctx.userId, now),
          read: threadRead(rows, cursor),
          shown: rows.length,
          total: rows[0]?.total ?? 0,
        };
      }
    }

    return {
      conversations: inboxItems(
        list.map((row) => ({ ...row, unread: unread.get(row.id) ?? 0 })),
        now,
      ),
      total: list[0]?.total ?? 0,
      selectedId,
      thread,
    };
  });
}
