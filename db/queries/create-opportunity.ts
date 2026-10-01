import "server-only";

import { and, eq, sql } from "drizzle-orm";

import { contacts, opportunities } from "../schema";
import {
  withTenant,
  type ScopedTransaction,
  type TenantContext,
} from "../tenant";

/*
 * Alta de una oportunidad con su contacto (H1.2): la primera escritura de
 * producto. La única puerta es la Server Action createOpportunity()
 * (lib/opportunities/actions.ts), que obtiene el contexto con
 * requireTenant() y valida el formulario antes de llegar acá; ESLint impide
 * importar este módulo desde cualquier otro lado.
 *
 *   TenantContext → withTenant() → contacto (resuelto o nuevo) →
 *   oportunidad → COMMIT
 *
 * - Una sola transacción withTenant(): si la oportunidad no se crea, el
 *   contacto nuevo de esta operación tampoco queda (ROLLBACK).
 * - `organization_id` sale siempre del contexto, nunca del input. Las
 *   policies de INSERT (WITH CHECK) rechazan igualmente una organización sin
 *   membership activa del usuario de la request.
 * - Identidad por teléfono: `phone_normalized` (E.164) es único por
 *   organización. El alta intenta insertar el contacto con
 *   `ON CONFLICT DO NOTHING` sobre ese índice y, si ya existía, lo lee. La
 *   unicidad de la base es la autoridad final: dos altas concurrentes con el
 *   mismo teléfono terminan en un solo contacto (la segunda espera a la
 *   primera y reutiliza su fila).
 * - Un contacto existente se reutiliza tal cual: su nombre y su ciudad no
 *   se actualizan (no hay edición de contactos en H1.2).
 * - La oportunidad nace en la etapa `new`, con la recencia y los timestamps
 *   de la base. Un mismo contacto puede tener varias oportunidades.
 */

type OpportunityRecord = typeof opportunities.$inferInsert;

/** Datos ya validados y normalizados (lib/opportunities/new-opportunity.ts). */
export type NewOpportunity = Readonly<{
  contact: Readonly<{
    name: string;
    /** Tal como se cargó (se muestra enmascarado). */
    phone: string;
    /** E.164: la identidad del contacto dentro de la organización. */
    phoneNormalized: string;
    city: string | null;
  }>;
  source: OpportunityRecord["source"];
  interestModel: string | null;
  interestVersion: string | null;
}>;

export type CreatedOpportunity = Readonly<{
  opportunityId: string;
  contact: Readonly<{
    id: string;
    name: string;
    /** El teléfono ya era de un contacto de la organización. */
    reused: boolean;
  }>;
}>;

/** Etapa inicial de toda oportunidad creada a mano. No la elige el cliente. */
const INITIAL_STAGE = "new" satisfies OpportunityRecord["stage"];

export class ContactResolutionError extends Error {
  constructor() {
    super("Could not resolve the contact for this phone in the organization");
    this.name = "ContactResolutionError";
  }
}

async function resolveContact(
  tx: ScopedTransaction,
  organizationId: string,
  contact: NewOpportunity["contact"],
): Promise<CreatedOpportunity["contact"]> {
  const [created] = await tx
    .insert(contacts)
    .values({
      organizationId,
      name: contact.name,
      phone: contact.phone,
      phoneNormalized: contact.phoneNormalized,
      city: contact.city,
    })
    // Inferencia del índice único parcial
    // contacts_organization_id_phone_normalized_key.
    .onConflictDoNothing({
      target: [contacts.organizationId, contacts.phoneNormalized],
      where: sql`${contacts.phoneNormalized} IS NOT NULL`,
    })
    .returning({ id: contacts.id, name: contacts.name });
  if (created) return { ...created, reused: false };

  // El teléfono ya tiene contacto en la organización: en READ COMMITTED
  // este statement ve la fila que causó el conflicto, aunque la haya
  // confirmado otra transacción concurrente.
  const [existing] = await tx
    .select({ id: contacts.id, name: contacts.name })
    .from(contacts)
    .where(
      and(
        eq(contacts.organizationId, organizationId),
        eq(contacts.phoneNormalized, contact.phoneNormalized),
      ),
    );
  if (!existing) throw new ContactResolutionError();
  return { ...existing, reused: true };
}

export async function createOpportunityWithContact(
  ctx: TenantContext,
  input: NewOpportunity,
): Promise<CreatedOpportunity> {
  return withTenant(ctx, async (tx) => {
    // Ya validado por withTenant(): un contexto emitido por Tenant Resolution.
    const { organizationId } = ctx;
    const contact = await resolveContact(tx, organizationId, input.contact);
    const [opportunity] = await tx
      .insert(opportunities)
      .values({
        organizationId,
        contactId: contact.id,
        stage: INITIAL_STAGE,
        source: input.source,
        interestModel: input.interestModel,
        interestVersion: input.interestVersion,
      })
      .returning({ id: opportunities.id });
    if (!opportunity) throw new Error("INSERT … RETURNING returned no row");
    return { opportunityId: opportunity.id, contact };
  });
}
