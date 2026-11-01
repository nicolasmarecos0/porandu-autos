"use server";

import { revalidatePath } from "next/cache";

import {
  recordConversationRead,
  type ConversationReadOutcome,
} from "@/db/queries/conversation-reads";
import { parseMarkRead } from "@/domains/conversations/read-state";
import { requireTenant } from "@/lib/tenant/session";

import type { MarkConversationReadState } from "./mark-read";

/*
 * Marcar visto una conversación de la bandeja (Hito 12B, DEC-044 §2.7),
 * markConversationRead(): la única puerta del cursor de leído.
 *
 *   requireTenant() → validar el pedido (Zod, parseMarkRead()) →
 *   recordConversationRead() (withTenant() →
 *   private.mark_conversation_read(): usuario, membership activa,
 *   conversación abierta y mensaje de ella, cursor con GREATEST) →
 *   revalidar /conversations si el cursor avanzó
 *
 * 1. La dispara el historial en el navegador cuando la conversación está a
 *    la vista (components/inbox/thread-log.tsx), nunca un GET: un prefetch,
 *    un enlace compartido o una pestaña en segundo plano no marcan.
 * 2. El TenantContext sale de requireTenant(), como en toda acción
 *    tenant-scoped (DEC-021). Cualquier membership activa marca lo suyo
 *    (DEC-044 §2.1 y §7): el cursor es del usuario de los claims, nunca del
 *    pedido.
 * 3. El pedido solo trae la conversación y el mensaje más nuevo en
 *    pantalla. Organización, usuario y cursor no salen de él: el cursor es
 *    el `created_at` de ese mensaje, que resuelve la base. Un pedido
 *    inválido se ignora sin error (`ignored`) y no llega a la base; uno de
 *    otra organización, de una conversación cerrada o con un mensaje ajeno
 *    también es `ignored`, sin revelar cuál.
 * 4. Marcar visto no le informa nada al cliente (DEC-044 §3.4) ni escribe
 *    hacia el proveedor: es interno del equipo.
 * 5. Si el cursor avanzó, revalida /conversations: el contador de la lista
 *    se actualiza y el caché del router no vuelve a mostrar la conversación
 *    sin leer con el botón atrás. El separador "Mensajes nuevos" queda donde
 *    estaba mientras la conversación sigue abierta (lo recuerda el
 *    historial). Si no avanzó, no hay nada que refrescar.
 * 6. Una falla inesperada no expone detalles de la base: el leído no es
 *    crítico y se vuelve a intentar la próxima vez que la conversación
 *    esté a la vista.
 */

const CONVERSATIONS_PATH = "/conversations";

/*
 * Para diagnosticar sin exponer datos: solo el tipo de error, el SQLSTATE y
 * la constraint. El mensaje de Drizzle incluye la query y sus parámetros.
 */
function logFailure(error: unknown): void {
  const { name, cause } =
    error instanceof Error ? error : { name: undefined, cause: undefined };
  const detail = (key: "code" | "constraint_name") =>
    typeof cause === "object" && cause !== null && key in cause
      ? (cause as Record<typeof key, unknown>)[key]
      : undefined;
  console.error("[conversations] mark read failed", {
    name,
    code: detail("code"),
    constraint_name: detail("constraint_name"),
  });
}

export async function markConversationRead(
  input: unknown,
): Promise<MarkConversationReadState> {
  const ctx = await requireTenant();

  const request = parseMarkRead(input);
  if (request === null) return { status: "ignored" };

  let outcome: ConversationReadOutcome;
  try {
    outcome = await recordConversationRead(ctx, request);
  } catch (error) {
    logFailure(error);
    return { status: "failed" };
  }

  switch (outcome.outcome) {
    case "marked":
      revalidatePath(CONVERSATIONS_PATH);
      return { status: "marked" };
    case "unchanged":
      return { status: "unchanged" };
    case "not_found":
      return { status: "ignored" };
  }
}
