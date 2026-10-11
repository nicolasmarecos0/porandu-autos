import {
  isLossReason,
  isStage,
  STAGE_CHANGE_FIELDS,
  type LossReason,
  type Stage,
} from "@/domains/opportunities/stages";

/*
 * Pedido y respuesta de la Server Action changeOpportunityStage() (H1.6,
 * DEC-032). El pedido solo identifica la oportunidad, la etapa de destino
 * y, para `lost`, el motivo: cualquier otro campo (organización, usuario,
 * etapa de origen, reloj) se ignora porque no tiene adónde ir. Nada de esto
 * expone la base: ni SQLSTATE, ni constraints, ni datos de otra organización.
 */

/** Respuesta de changeOpportunityStage(). */
export type ChangeStageState =
  /** El pedido hizo la transición. */
  | Readonly<{
      status: "changed";
      opportunityId: string;
      from: Stage;
      to: Stage;
    }>
  /** Ya estaba en la etapa pedida (p. ej. otra persona la movió antes). */
  | Readonly<{ status: "unchanged"; opportunityId: string; stage: Stage }>
  /** La máquina de estados no permite ese pase. `current` es la etapa real. */
  | Readonly<{
      status: "invalid_transition";
      opportunityId: string;
      current: Stage;
    }>
  /** Pasar a `lost` exige un motivo válido. Nada cambió. */
  | Readonly<{ status: "loss_reason_required" }>
  /** El pedido no es una etapa reconocida. Nada cambió. */
  | Readonly<{ status: "invalid" }>
  /** La oportunidad no existe o no es de la organización activa. */
  | Readonly<{ status: "not_found" }>
  /** Falla inesperada: nada cambió y se puede reintentar. */
  | Readonly<{ status: "failed" }>
  | null;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type ParsedStageChange =
  | Readonly<{
      kind: "ok";
      opportunityId: string;
      to: Stage;
      lossReason: LossReason | null;
    }>
  /** El id no es un UUID: no llega a la base. */
  | Readonly<{ kind: "not_found" }>
  /** La etapa pedida no existe. */
  | Readonly<{ kind: "invalid" }>;

function text(value: FormDataEntryValue | null): string {
  return typeof value === "string" ? value.trim() : "";
}

/**
 * Lee el pedido, que es input no confiable. Que el id sea un UUID no
 * significa que la oportunidad sea de la organización activa: eso lo deciden
 * el filtro explícito y RLS. Un motivo ausente o desconocido es `null`: el
 * dominio lo exige solo si el pase es a `lost`.
 */
export function parseStageChange(formData: FormData): ParsedStageChange {
  const id = text(formData.get(STAGE_CHANGE_FIELDS.opportunityId));
  if (!UUID.test(id)) return { kind: "not_found" };

  const to = text(formData.get(STAGE_CHANGE_FIELDS.stage));
  if (!isStage(to)) return { kind: "invalid" };

  const reason = text(formData.get(STAGE_CHANGE_FIELDS.lossReason));
  return {
    kind: "ok",
    opportunityId: id.toLowerCase(),
    to,
    lossReason: isLossReason(reason) ? reason : null,
  };
}
