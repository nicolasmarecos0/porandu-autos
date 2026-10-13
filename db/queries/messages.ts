import "server-only";

import { and, desc, eq } from "drizzle-orm";

import type { MessageRow } from "@/domains/conversations/messages";

import { messages } from "../schema";
import type { ScopedTransaction } from "../tenant";

/*
 * Lectura de los mensajes de una oportunidad (Hito 4, DEC-036 §11). Solo
 * lee: corre dentro de la transacción withTenant() que ya abrió el loader de
 * /opportunities/[id] y filtra siempre por la organización del contexto
 * (defensa en profundidad sobre RLS). La escritura vive aparte, en
 * record-message.ts, con su única puerta.
 *
 * Del mensaje más reciente al más viejo, servida por el índice
 * (organization_id, opportunity_id, created_at DESC). El muro que los
 * combina con las notas lo arma el dominio (activityTimeline()).
 */
export function selectOpportunityMessages(
  tx: ScopedTransaction,
  organizationId: string,
  opportunityId: string,
): Promise<MessageRow[]> {
  return tx
    .select({
      id: messages.id,
      channel: messages.channel,
      direction: messages.direction,
      content: messages.content,
      recordedBy: messages.recordedBy,
      createdAt: messages.createdAt,
    })
    .from(messages)
    .where(
      and(
        eq(messages.organizationId, organizationId),
        eq(messages.opportunityId, opportunityId),
      ),
    )
    .orderBy(desc(messages.createdAt), desc(messages.id));
}
