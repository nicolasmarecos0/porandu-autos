import "server-only";

import { and, desc, eq, sql } from "drizzle-orm";

import {
  conversationThread,
  inboxItems,
  INBOX_CONVERSATION_LIMIT,
  THREAD_MESSAGE_LIMIT,
  threadContact,
  type Inbox,
  type InboxThread,
} from "@/domains/conversations/inbox";
import { requireTenant } from "@/lib/tenant/session";

import { contacts, conversations, messages } from "../schema";
import { withTenant } from "../tenant";

/*
 * Bandeja de /conversations (Hito 8, DEC-040 §1). Solo lee:
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
 *   conversación, con su total. Los ordena para el chat el dominio
 *   (conversationThread()).
 * - Todo en la misma transacción. Leer no cambia nada.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Loader de /conversations. `selected` es el `?c=` de la URL, sin validar. */
export async function getInbox(selected: string | undefined): Promise<Inbox> {
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
        thread = {
          kind: "found",
          conversationId: conversation.id,
          contact: threadContact(
            conversation.contactName,
            conversation.contactPhone,
          ),
          messages: conversationThread(rows, ctx.userId),
          total: rows[0]?.total ?? 0,
        };
      }
    }

    return {
      conversations: inboxItems(list),
      total: list[0]?.total ?? 0,
      selectedId,
      thread,
    };
  });
}
