import "server-only";

import { and, desc, eq, inArray, max } from "drizzle-orm";

import type { NoteRow } from "@/domains/opportunities/notes";

import { opportunityNotes } from "../schema";
import type { ScopedTransaction } from "../tenant";

/*
 * Lectura de la bitácora comercial de una oportunidad (Hito 2, DEC-033 §1).
 * Solo lee: corre dentro de una transacción withTenant() que ya abrió quien
 * llama (el loader de /opportunities/[id] o, para la última nota de cada
 * oportunidad, el de la cola) y filtra siempre por la
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

/**
 * Nota más reciente de cada oportunidad (Hito 3, DEC-035 §5): lo único que
 * la Next Best Action de la cola necesita de la bitácora. Solo el momento,
 * sin texto ni autor. Mismo boundary que la bitácora: corre dentro de la
 * transacción withTenant() del loader y filtra por la organización del
 * contexto (defensa en profundidad sobre RLS), servida por el índice
 * (organization_id, opportunity_id, recorded_at DESC).
 *
 * Una oportunidad sin notas no aparece en el mapa.
 */
export async function selectLastNoteTimes(
  tx: ScopedTransaction,
  organizationId: string,
  opportunityIds: readonly string[],
): Promise<Map<string, Date>> {
  const byOpportunity = new Map<string, Date>();
  if (opportunityIds.length === 0) return byOpportunity;
  const rows = await tx
    .select({
      opportunityId: opportunityNotes.opportunityId,
      lastNoteAt: max(opportunityNotes.recordedAt),
    })
    .from(opportunityNotes)
    .where(
      and(
        eq(opportunityNotes.organizationId, organizationId),
        inArray(opportunityNotes.opportunityId, [...opportunityIds]),
      ),
    )
    .groupBy(opportunityNotes.opportunityId);
  for (const row of rows) {
    if (row.lastNoteAt) byOpportunity.set(row.opportunityId, row.lastNoteAt);
  }
  return byOpportunity;
}
