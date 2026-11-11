import "server-only";

import { and, eq } from "drizzle-orm";

import type {
  DeliveryChecklist,
  DeliveryChecklistItem,
} from "@/domains/opportunities/deliveries";
import type { DeliveryRow } from "@/domains/opportunities/delivery-presentation";

import {
  deliveries,
  type DeliveryChecklistDb,
  type DeliveryChecklistItemDb,
} from "../schema";
import type { ScopedTransaction } from "../tenant";

/*
 * Lectura de la entrega de una oportunidad (Hito 21, DEC-053), dentro de la
 * transacción del loader de /opportunities/[id] (requireTenant() →
 * withTenant()). Filtro explícito por la organización activa además de RLS
 * (ADR-001 §2). Solo lee.
 */

/** El ítem del dominio como lo guarda la base (el auxilio en snake_case). */
export const checklistItemToDb: Readonly<
  Record<DeliveryChecklistItem, DeliveryChecklistItemDb>
> = {
  keys: "keys",
  manuals: "manuals",
  spareTire: "spare_tire",
  cleaning: "cleaning",
  documents: "documents",
};

/** El checklist de la base → el del dominio. Pura. */
export function checklistFromDb(
  checklist: DeliveryChecklistDb,
): DeliveryChecklist {
  return {
    keys: checklist.keys,
    manuals: checklist.manuals,
    spareTire: checklist.spare_tire,
    cleaning: checklist.cleaning,
    documents: checklist.documents,
  };
}

/** El checklist del dominio → el de la base. Pura. */
export function checklistToDb(
  checklist: DeliveryChecklist,
): DeliveryChecklistDb {
  return {
    keys: checklist.keys,
    manuals: checklist.manuals,
    spare_tire: checklist.spareTire,
    cleaning: checklist.cleaning,
    documents: checklist.documents,
  };
}

/** La entrega de la oportunidad (a lo sumo una), o null. */
export async function selectOpportunityDelivery(
  tx: ScopedTransaction,
  organizationId: string,
  opportunityId: string,
): Promise<DeliveryRow | null> {
  const [row] = await tx
    .select({
      id: deliveries.id,
      status: deliveries.status,
      scheduledAt: deliveries.scheduledAt,
      checklist: deliveries.checklist,
      createdBy: deliveries.createdBy,
      createdAt: deliveries.createdAt,
      completedBy: deliveries.completedBy,
      completedAt: deliveries.completedAt,
    })
    .from(deliveries)
    .where(
      and(
        eq(deliveries.organizationId, organizationId),
        eq(deliveries.opportunityId, opportunityId),
      ),
    )
    .limit(1);
  return row ? { ...row, checklist: checklistFromDb(row.checklist) } : null;
}
