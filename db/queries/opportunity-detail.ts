import "server-only";

import { and, eq } from "drizzle-orm";

import {
  demandDetail,
  demandSummary,
  type DemandDetail,
  type DemandSummary,
  type LegacyInterest,
} from "@/domains/demand/presentation";
import { resolveDemand, type DemandRow } from "@/domains/demand/resolver";
import { demandSnapshot } from "@/domains/demand/snapshot";
import { findMatchesForDemand } from "@/domains/match/engine";
import { matchRail, type MatchRail } from "@/domains/match/presentation";
import {
  closureFromRow,
  closureSummary,
  type ClosureSummary,
} from "@/domains/opportunities/closure";
import { noteTimeline, type NoteEntry } from "@/domains/opportunities/notes";
import type { Stage } from "@/domains/opportunities/stages";
import {
  canChangeVehicleLink,
  linkedVehicleCard,
  type LinkedVehicleCard,
} from "@/domains/opportunities/vehicle-link";
import { requireTenant } from "@/lib/tenant/session";

import { contacts, opportunities } from "../schema";
import { withTenant } from "../tenant";
import { selectDemandRows } from "./demand-rows";
import { selectOpportunityNotes } from "./opportunity-notes";
import { stageFromDb } from "./opportunities";
import { selectMatchCandidates, selectVehicleById } from "./vehicles";

/*
 * Detalle de una oportunidad en /opportunities/[id] (H1.4, DEC-030 §10):
 * por qué Porandú cree que el cliente busca lo que busca.
 *
 *   request → requireTenant() → TenantContext → withTenant() → oportunidad
 *   y ledger filtrados por la organización activa → RLS → resolver →
 *   ViewModel
 *
 * - Un id que no es UUID no llega a la base. Uno de otra organización (aun
 *   con membership activa en ella) o inexistente da null: la página
 *   responde notFound() sin revelar cuál de los dos fue.
 * - La oportunidad y su ledger se leen en la misma transacción.
 * - El autor se presenta como "Vos" u "Otro miembro" contra el usuario de la
 *   request: ningún id de usuario llega a la página.
 * - Match v0 (H1.5, DEC-031 §5): en la misma transacción lee las unidades
 *   disponibles de la organización activa y calcula los matches en memoria
 *   con el DemandSnapshot de la oportunidad. No se persiste nada.
 * - Etapa (H1.6, DEC-032): lee la etapa; el panel de etapa ofrece solo las
 *   acciones que la máquina de estados permite.
 * - Cierre (DEC-034): con `won` o `lost`, lee sus metadatos y arma el
 *   resumen de la tarjeta "Cierre" (precio, forma de pago y entrega, o
 *   motivo y notas).
 * - Bitácora y unidad vinculada (Hito 2, DEC-033): en la misma transacción
 *   lee las notas de la oportunidad y la unidad vinculada (de la
 *   organización activa, en cualquier estado), y dice si la etapa admite
 *   cambiarla. Las notas llegan con autor "Vos" u "Otro miembro".
 * - Solo lee: no toca `last_activity_at`, el ledger, las notas ni el stock.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Lo que la página recibe: encabezado, detalle y el resumen para editar. */
export type OpportunityDetail = Readonly<{
  id: string;
  contactName: string;
  stage: Stage;
  /** Resumen del cierre (DEC-034): solo con `won` o `lost`. */
  closure: ClosureSummary | null;
  demand: DemandDetail;
  /** Lo mismo que recibe la card "Busca": lo que necesita el drawer. */
  summary: DemandSummary;
  /** Top Match y alternativa del stock disponible, o por qué no hay. */
  matches: MatchRail;
  /** Unidad vinculada a la negociación (Hito 2) y si se puede cambiar. */
  vehicleLink: Readonly<{
    /** La etapa admite elegir, cambiar o quitar la unidad. */
    canChange: boolean;
    linked: LinkedVehicleCard | null;
  }>;
  /** Bitácora comercial, de la nota más reciente a la más vieja. */
  notes: readonly NoteEntry[];
}>;

/** Texto opcional del legado: vacío o en blanco no cuenta. */
function present(value: string | null): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

/** Loader de /opportunities/[id]: null si no es de la organización activa. */
export async function getOpportunityDetail(
  id: string,
): Promise<OpportunityDetail | null> {
  const ctx = await requireTenant();
  if (!UUID.test(id)) return null;
  const opportunityId = id.toLowerCase();

  const found = await withTenant(ctx, async (tx) => {
    const [opportunity] = await tx
      .select({
        id: opportunities.id,
        stage: opportunities.stage,
        lossReason: opportunities.lossReason,
        lossNotes: opportunities.lossNotes,
        salePrice: opportunities.salePrice,
        saleCurrency: opportunities.saleCurrency,
        paymentMethod: opportunities.paymentMethod,
        deliveryStatus: opportunities.deliveryStatus,
        deliveryDate: opportunities.deliveryDate,
        vehicleId: opportunities.vehicleId,
        createdAt: opportunities.createdAt,
        interestModel: opportunities.interestModel,
        interestVersion: opportunities.interestVersion,
        contactName: contacts.name,
      })
      .from(opportunities)
      .innerJoin(
        contacts,
        and(
          eq(contacts.organizationId, opportunities.organizationId),
          eq(contacts.id, opportunities.contactId),
        ),
      )
      .where(
        and(
          eq(opportunities.organizationId, ctx.organizationId),
          eq(opportunities.id, opportunityId),
        ),
      )
      .limit(1);
    if (!opportunity) return null;
    const ledger = await selectDemandRows(tx, ctx.organizationId, [
      opportunity.id,
    ]);
    const rows: readonly DemandRow[] = ledger.get(opportunity.id) ?? [];
    const candidates = await selectMatchCandidates(tx, ctx.organizationId);
    const linked = opportunity.vehicleId
      ? await selectVehicleById(tx, ctx.organizationId, opportunity.vehicleId)
      : null;
    const notes = await selectOpportunityNotes(
      tx,
      ctx.organizationId,
      opportunity.id,
    );
    return { opportunity, rows, candidates, linked, notes };
  });
  if (!found) return null;

  const { opportunity, rows, candidates, linked, notes } = found;
  const stage = stageFromDb[opportunity.stage];
  const closure = closureFromRow({ ...opportunity, stage });
  const truth = resolveDemand(rows);
  const snapshot = demandSnapshot(truth);
  const matches = findMatchesForDemand(snapshot, candidates);
  const model = present(opportunity.interestModel);
  const version = present(opportunity.interestVersion);
  const legacy: LegacyInterest = {
    ...(model ? { model } : {}),
    ...(version ? { version } : {}),
  };
  return {
    id: opportunity.id,
    contactName: opportunity.contactName,
    stage,
    closure: closure ? closureSummary(closure) : null,
    demand: demandDetail(truth, {
      viewerUserId: ctx.userId,
      createdAt: opportunity.createdAt,
      legacy,
    }),
    summary: demandSummary(truth, legacy),
    matches: matchRail(snapshot, candidates, matches),
    vehicleLink: {
      canChange: canChangeVehicleLink(stage),
      linked: linked ? linkedVehicleCard(linked) : null,
    },
    notes: noteTimeline(notes, ctx.userId),
  };
}
