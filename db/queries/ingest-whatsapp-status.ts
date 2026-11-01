import "server-only";

import { sql } from "drizzle-orm";

import type { DeliveryStatus } from "@/domains/conversations/delivery";

import { withIngestion } from "../tenant";

/*
 * Ingesta de un estado de entrega de WhatsApp (Hito 12C, DEC-044 §3.3). La
 * única puerta es el webhook (lib/whatsapp/webhook.ts), que verifica la
 * firma y valida el payload antes de llegar acá; ESLint impide importar este
 * módulo desde cualquier otro lado, y withIngestion() solo se importa acá y
 * en la ingesta de mensajes.
 *
 *   withIngestion() (authenticated sin claims) →
 *   private.ingest_whatsapp_status() (SECURITY DEFINER): la organización de
 *   la línea → el saliente con ese id del proveedor → INSERT del estado
 *   (idempotente) → COMMIT
 *
 * - El llamador no elige la organización: la resuelve la base a partir de
 *   la línea receptora (`whatsapp_lines`). Sin claims, RLS no le deja leer
 *   ni escribir ninguna fila por sí mismo.
 * - El mensaje no cambia (C-11): cada estado es una fila de
 *   `message_statuses`, y el vigente lo decide el dominio por precedencia
 *   (domains/conversations/delivery.ts). Un estado inferior que llega tarde
 *   se registra sin pisar uno superior.
 * - Un estado por transacción: si uno falla, los anteriores ya quedaron y
 *   un reintento del proveedor los encuentra como `duplicate`.
 * - El instante viaja como texto ISO con cast explícito a timestamptz.
 */

export type DeliveryStatusWrite = Readonly<{
  /** `phone_number_id` de la línea que envió el mensaje. */
  lineId: string;
  /** Id del saliente en el proveedor (el wamid). */
  externalId: string;
  status: DeliveryStatus;
  /** Cuándo ocurrió, según el proveedor. */
  occurredAt: Date;
}>;

export type DeliveryStatusOutcome =
  | Readonly<{
      /** Registrado, o ya registrado antes (entrega repetida). */
      outcome: "recorded" | "duplicate";
      organizationId: string;
      messageId: string;
    }>
  /**
   * La línea no existe o está inactiva, o la organización no tiene un
   * saliente con ese id. Nada se escribió.
   */
  | Readonly<{ outcome: "unknown_line" | "unknown_message" }>;

type IngestStatusRow = {
  outcome: string;
  organization_id: string | null;
  message_id: string | null;
};

export async function ingestDeliveryStatus(
  status: DeliveryStatusWrite,
): Promise<DeliveryStatusOutcome> {
  return withIngestion(async (tx) => {
    const [row] = await tx.execute<IngestStatusRow>(
      sql`SELECT * FROM private.ingest_whatsapp_status(${status.lineId}, ${status.externalId}, ${status.status}, ${status.occurredAt.toISOString()}::timestamptz)`,
    );
    if (!row) throw new Error("status ingest returned no row");
    if (row.outcome === "unknown_line" || row.outcome === "unknown_message") {
      return { outcome: row.outcome };
    }
    if (
      (row.outcome !== "recorded" && row.outcome !== "duplicate") ||
      !row.organization_id ||
      !row.message_id
    ) {
      throw new Error("status ingest returned an unexpected row");
    }
    return {
      outcome: row.outcome,
      organizationId: row.organization_id,
      messageId: row.message_id,
    };
  });
}
