import "server-only";

import { and, eq } from "drizzle-orm";

import type { NewMessage } from "@/domains/conversations/messages";

import { messages, opportunities } from "../schema";
import { withTenant, type TenantContext } from "../tenant";

/*
 * Alta de un mensaje registrado en una oportunidad (Hito 4, DEC-036 §6). La
 * única puerta es la Server Action addMessage()
 * (lib/conversations/actions.ts), que obtiene el contexto con
 * requireTenant() y valida el pedido antes de llegar acá; ESLint impide
 * importar este módulo desde cualquier otro lado.
 *
 *   TenantContext → withTenant() → la oportunidad en la organización activa
 *   (y su contacto) → INSERT (append-only) → RLS (WITH CHECK) + FKs
 *   compuestas + CHECKs → trigger de actividad → COMMIT
 *
 * - El cliente solo identifica la oportunidad y aporta canal, dirección y
 *   texto. `organization_id` y el autor salen del contexto, el contacto es
 *   el de la oportunidad y la fecha la pone la base: la policy de INSERT
 *   exige membership activa, `recorded_by = auth.uid()` y
 *   `created_at = now()`.
 * - La FK compuesta (organization_id, opportunity_id, contact_id) impide
 *   asociar el mensaje a una oportunidad de otra organización o de otro
 *   contacto; la lectura previa con filtro explícito lo resuelve antes como
 *   `not_found`, sin revelar si existe.
 * - Append-only: nunca se edita ni se borra un mensaje. Registrarlo no envía
 *   ni recibe nada. En la misma transacción, el trigger
 *   `messages_touch_activity` mueve el `last_activity_at` de la oportunidad
 *   (DEC-036 §1); la etapa, el cierre, la demanda y el stock no cambian.
 */

export type MessageWriteRequest = Readonly<{
  opportunityId: string;
  /** Ya validado y con el texto normalizado (domains/conversations). */
  message: NewMessage;
}>;

export type MessageWriteOutcome =
  | Readonly<{ outcome: "recorded"; opportunityId: string; messageId: string }>
  /** No existe, o no es de la organización activa. Nada se escribió. */
  | Readonly<{ outcome: "not_found" }>;

export async function insertOpportunityMessage(
  ctx: TenantContext,
  request: MessageWriteRequest,
): Promise<MessageWriteOutcome> {
  return withTenant(ctx, async (tx) => {
    // Ya validado por withTenant(): un contexto emitido por Tenant Resolution.
    const { organizationId, userId } = ctx;
    const { opportunityId, message } = request;

    const [opportunity] = await tx
      .select({ id: opportunities.id, contactId: opportunities.contactId })
      .from(opportunities)
      .where(
        and(
          eq(opportunities.id, opportunityId),
          eq(opportunities.organizationId, organizationId),
        ),
      )
      .limit(1);
    if (!opportunity) return { outcome: "not_found" };

    const [inserted] = await tx
      .insert(messages)
      .values({
        organizationId,
        contactId: opportunity.contactId,
        opportunityId,
        channel: message.channel,
        direction: message.direction,
        content: message.content,
        recordedBy: userId,
      })
      .returning({ id: messages.id });
    if (!inserted) throw new Error("message insert returned no row");
    return { outcome: "recorded", opportunityId, messageId: inserted.id };
  });
}
