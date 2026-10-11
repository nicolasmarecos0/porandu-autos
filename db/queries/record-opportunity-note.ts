import "server-only";

import { and, eq } from "drizzle-orm";

import { opportunities, opportunityNotes } from "../schema";
import { withTenant, type TenantContext } from "../tenant";

/*
 * Alta de una nota en la bitácora comercial (Hito 2, DEC-033 §1). La única
 * puerta es la Server Action addOpportunityNote()
 * (lib/opportunities/actions.ts), que obtiene el contexto con
 * requireTenant() y normaliza y valida el texto antes de llegar acá; ESLint
 * impide importar este módulo desde cualquier otro lado.
 *
 *   TenantContext → withTenant() → la oportunidad en la organización activa
 *   → INSERT (append-only) → RLS (WITH CHECK) + FK compuesta → COMMIT
 *
 * - El cliente solo identifica la oportunidad y aporta el texto.
 *   `organization_id` y el autor salen del contexto, y la fecha la pone la
 *   base: la policy de INSERT exige membership activa,
 *   `recorded_by = auth.uid()` y `recorded_at = now()`.
 * - La FK compuesta (organization_id, opportunity_id) impide anotar en una
 *   oportunidad de otra organización; la lectura previa con filtro explícito
 *   lo resuelve antes como `not_found`, sin revelar si existe.
 * - Append-only: nunca se edita ni se borra una nota. No toca
 *   `last_activity_at` (DEC-033 §6), la etapa, la demanda ni el stock.
 */

export type NoteWriteRequest = Readonly<{
  opportunityId: string;
  /** Texto ya normalizado y validado (domains/opportunities/notes.ts). */
  body: string;
}>;

export type NoteWriteOutcome =
  | Readonly<{ outcome: "recorded"; opportunityId: string; noteId: string }>
  /** No existe, o no es de la organización activa. Nada se escribió. */
  | Readonly<{ outcome: "not_found" }>;

export async function insertOpportunityNote(
  ctx: TenantContext,
  request: NoteWriteRequest,
): Promise<NoteWriteOutcome> {
  return withTenant(ctx, async (tx) => {
    // Ya validado por withTenant(): un contexto emitido por Tenant Resolution.
    const { organizationId, userId } = ctx;
    const { opportunityId } = request;

    const [opportunity] = await tx
      .select({ id: opportunities.id })
      .from(opportunities)
      .where(
        and(
          eq(opportunities.id, opportunityId),
          eq(opportunities.organizationId, organizationId),
        ),
      )
      .limit(1);
    if (!opportunity) return { outcome: "not_found" };

    const [note] = await tx
      .insert(opportunityNotes)
      .values({
        organizationId,
        opportunityId,
        body: request.body,
        recordedBy: userId,
      })
      .returning({ id: opportunityNotes.id });
    if (!note) throw new Error("opportunity note insert returned no row");
    return { outcome: "recorded", opportunityId, noteId: note.id };
  });
}
