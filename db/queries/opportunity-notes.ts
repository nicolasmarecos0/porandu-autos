import "server-only";

import { and, desc, eq } from "drizzle-orm";

import type { NoteRow } from "@/domains/opportunities/notes";

import { opportunityNotes } from "../schema";
import type { ScopedTransaction } from "../tenant";

/*
 * Lectura de la bitácora comercial de una oportunidad (Hito 2, DEC-033 §1).
 * Solo lee: corre dentro de una transacción withTenant() que ya abrió quien
 * llama (el loader de /opportunities/[id]) y filtra siempre por la
 * organización del contexto (defensa en profundidad sobre RLS). La escritura
 * vive aparte, en record-opportunity-note.ts, con su única puerta.
 *
 * De la nota más reciente a la más vieja, servida por el índice
 * (organization_id, opportunity_id, recorded_at DESC). La presentación
 * (autor "Vos" u "Otro miembro", fecha de Asunción) la arma el dominio.
 */
export function selectOpportunityNotes(
  tx: ScopedTransaction,
  organizationId: string,
  opportunityId: string,
): Promise<NoteRow[]> {
  return tx
    .select({
      id: opportunityNotes.id,
      body: opportunityNotes.body,
      recordedBy: opportunityNotes.recordedBy,
      recordedAt: opportunityNotes.recordedAt,
    })
    .from(opportunityNotes)
    .where(
      and(
        eq(opportunityNotes.organizationId, organizationId),
        eq(opportunityNotes.opportunityId, opportunityId),
      ),
    )
    .orderBy(desc(opportunityNotes.recordedAt), desc(opportunityNotes.id));
}
