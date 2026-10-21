import "server-only";

import { sql } from "drizzle-orm";

import { withIngestion } from "../tenant";

/*
 * Ingesta de un mensaje entrante de WhatsApp (Hito 7, DEC-039 §7). La única
 * puerta es el webhook (lib/whatsapp/webhook.ts), que verifica la firma y
 * valida el payload antes de llegar acá; ESLint impide importar este módulo
 * desde cualquier otro lado, y withIngestion() solo se importa acá.
 *
 *   withIngestion() (authenticated sin claims) →
 *   private.ingest_whatsapp_message() (SECURITY DEFINER): la organización de
 *   la línea → contacto → conversación abierta → oportunidad abierta única →
 *   INSERT del mensaje (idempotente) → último mensaje de la conversación →
 *   trigger de actividad → COMMIT
 *
 * - El llamador no elige la organización: la resuelve la base a partir de
 *   la línea receptora (`whatsapp_lines`). Sin claims, RLS no le deja leer
 *   ni escribir ninguna fila por sí mismo.
 * - Un mensaje por transacción: si uno falla, los anteriores ya quedaron y
 *   un reintento del proveedor los encuentra como `duplicate`.
 * - Los instantes viajan como texto ISO con cast explícito a timestamptz.
 */

export type InboundMessageWrite = Readonly<{
  /** `phone_number_id` de la línea receptora. */
  lineId: string;
  /** Id del mensaje en el proveedor. */
  externalId: string;
  /** El número tal como llegó, con "+". */
  phone: string;
  /** El mismo número en E.164, normalizado en el servidor (DEC-024 §2). */
  phoneNormalized: string;
  /** Nombre de un contacto nuevo. Uno existente no cambia. */
  contactName: string;
  /** Texto normalizado (1 a 4096 caracteres). */
  content: string;
  /** El texto en una línea, para la conversación (1 a 160 caracteres). */
  preview: string;
  sentAt: Date;
}>;

export type InboundMessageOutcome =
  | Readonly<{
      /** Registrado, o ya registrado antes (entrega repetida). */
      outcome: "recorded" | "duplicate";
      organizationId: string;
      contactId: string;
      conversationId: string;
      /** La oportunidad abierta única del contacto, o null (DEC-039 §9). */
      opportunityId: string | null;
      messageId: string;
    }>
  /** La línea no existe o está inactiva. Nada se escribió. */
  | Readonly<{ outcome: "unknown_line" }>;

type IngestRow = {
  outcome: string;
  organization_id: string | null;
  contact_id: string | null;
  conversation_id: string | null;
  opportunity_id: string | null;
  message_id: string | null;
};

export async function ingestInboundMessage(
  message: InboundMessageWrite,
): Promise<InboundMessageOutcome> {
  return withIngestion(async (tx) => {
    const [row] = await tx.execute<IngestRow>(
      sql`SELECT * FROM private.ingest_whatsapp_message(${message.lineId}, ${message.externalId}, ${message.phone}, ${message.phoneNormalized}, ${message.contactName}, ${message.content}, ${message.preview}, ${message.sentAt.toISOString()}::timestamptz)`,
    );
    if (!row) throw new Error("ingest returned no row");
    if (row.outcome === "unknown_line") return { outcome: "unknown_line" };
    if (
      (row.outcome !== "recorded" && row.outcome !== "duplicate") ||
      !row.organization_id ||
      !row.contact_id ||
      !row.conversation_id ||
      !row.message_id
    ) {
      throw new Error("ingest returned an unexpected row");
    }
    return {
      outcome: row.outcome,
      organizationId: row.organization_id,
      contactId: row.contact_id,
      conversationId: row.conversation_id,
      opportunityId: row.opportunity_id,
      messageId: row.message_id,
    };
  });
}
