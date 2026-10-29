import "server-only";

import { and, eq, sql } from "drizzle-orm";

import { contacts, conversations, whatsappLines } from "../schema";
import { withTenant, type TenantContext } from "../tenant";

/*
 * Envío de un mensaje de WhatsApp desde la bandeja (Hito 8, DEC-040). La
 * única puerta es POST /api/messages/send (lib/conversations/send.ts), que
 * obtiene el contexto con resolveRequestTenant() y valida el pedido antes de
 * llegar acá; ESLint impide importar este módulo desde cualquier otro lado.
 *
 *   selectSendTarget(): withTenant() → la conversación abierta en la
 *   organización activa (y el teléfono de su contacto) → la línea activa de
 *   la organización → COMMIT
 *   … Meta acepta el mensaje (lib/whatsapp/api.ts), sin transacción abierta …
 *   recordOutboundMessage(): withTenant() →
 *   private.record_outbound_whatsapp_message() (SECURITY DEFINER): miembro
 *   activo de la organización → conversación abierta → oportunidad abierta
 *   única → INSERT del mensaje (idempotente por el id de Meta) → último
 *   mensaje de la conversación → trigger de actividad → COMMIT
 *
 * - La organización sale del TenantContext, nunca del pedido: la lectura la
 *   usa como filtro explícito (sobre RLS) y la función la vuelve a validar
 *   contra las memberships activas del usuario de los claims.
 * - Una conversación de otra organización, inexistente o cerrada es
 *   `not_found`, sin revelar cuál, y no se envía nada.
 * - El autor (`auth.uid()`) y el reloj (`now()`) los pone la base.
 */

export type SendTarget =
  | Readonly<{
      outcome: "ready";
      /** `phone_number_id` de la línea activa de la organización. */
      phoneNumberId: string;
      /** El teléfono E.164 del contacto, sin el "+". */
      to: string;
    }>
  /** No existe, es de otra organización o está cerrada. */
  | Readonly<{ outcome: "not_found" }>
  /** La organización no tiene exactamente una línea activa (DEC-040 §4). */
  | Readonly<{ outcome: "no_line" }>
  /** El contacto no tiene teléfono E.164. */
  | Readonly<{ outcome: "no_recipient" }>;

/** Lee a quién y desde qué línea responder. No escribe nada. */
export async function selectSendTarget(
  ctx: TenantContext,
  conversationId: string,
): Promise<SendTarget> {
  return withTenant(ctx, async (tx) => {
    // Ya validado por withTenant(): un contexto emitido por Tenant Resolution.
    const { organizationId } = ctx;

    const [conversation] = await tx
      .select({ phone: contacts.phoneNormalized })
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
          eq(conversations.id, conversationId),
          eq(conversations.status, "open"),
        ),
      )
      .limit(1);
    if (!conversation) return { outcome: "not_found" };

    // Dos alcanzan para saber si hay más de una.
    const lines = await tx
      .select({ phoneNumberId: whatsappLines.phoneNumberId })
      .from(whatsappLines)
      .where(
        and(
          eq(whatsappLines.organizationId, organizationId),
          eq(whatsappLines.active, true),
        ),
      )
      .limit(2);
    const [line] = lines;
    if (!line || lines.length > 1) return { outcome: "no_line" };

    if (!conversation.phone) return { outcome: "no_recipient" };
    return {
      outcome: "ready",
      phoneNumberId: line.phoneNumberId,
      to: conversation.phone.replace(/^\+/, ""),
    };
  });
}

export type OutboundMessageWrite = Readonly<{
  conversationId: string;
  /** Id del mensaje en Meta (el wamid). */
  externalId: string;
  /** Texto normalizado (1 a 4096 caracteres), el mismo que se envió. */
  content: string;
  /** El texto en una línea, para la conversación (1 a 160 caracteres). */
  preview: string;
}>;

export type OutboundMessageOutcome =
  | Readonly<{
      /** Registrado, o ya registrado antes con el mismo id de Meta. */
      outcome: "recorded" | "duplicate";
      messageId: string;
      /** La oportunidad abierta única del contacto, o null (DEC-039 §9). */
      opportunityId: string | null;
    }>
  /** La conversación ya no está abierta en la organización. Nada se escribió. */
  | Readonly<{ outcome: "not_found" }>;

type RecordRow = {
  outcome: string;
  message_id: string | null;
  contact_id: string | null;
  opportunity_id: string | null;
};

/** Registra un mensaje que Meta ya aceptó. */
export async function recordOutboundMessage(
  ctx: TenantContext,
  message: OutboundMessageWrite,
): Promise<OutboundMessageOutcome> {
  return withTenant(ctx, async (tx) => {
    const [row] = await tx.execute<RecordRow>(
      sql`SELECT * FROM private.record_outbound_whatsapp_message(${ctx.organizationId}::uuid, ${message.conversationId}::uuid, ${message.externalId}, ${message.content}, ${message.preview})`,
    );
    if (!row) throw new Error("record returned no row");
    if (row.outcome === "not_found") return { outcome: "not_found" };
    if (
      (row.outcome !== "recorded" && row.outcome !== "duplicate") ||
      !row.message_id
    ) {
      throw new Error("record returned an unexpected row");
    }
    return {
      outcome: row.outcome,
      messageId: row.message_id,
      opportunityId: row.opportunity_id,
    };
  });
}
