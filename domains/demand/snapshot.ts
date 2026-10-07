import type { DemandFact, DemandValues } from "./facts";
import type { CurrentStatus, DemandTruth } from "./resolver";

/*
 * Match Contract (H1.4, DEC-030 §11; spec §11): lo que H1.5 (Match v0)
 * recibe de la demanda de una oportunidad. Por cada fact, el valor vigente,
 * su estado y la fila que lo sustenta; sin historial ni evidencia.
 *
 * Garantías de H1.4:
 * - un valor rechazado, quitado, descartado o inconsistente llega como
 *   `unknown`, sin valor;
 * - un pendiente nunca es el valor;
 * - el legado `interest_model` / `interest_version` nunca se incluye;
 * - no hay FX: cada monto conserva su moneda;
 * - `detected` identifica un valor no confirmado por un humano.
 *
 * Cómo pesa cada estado, las monedas distintas y la fórmula son decisiones
 * de H1.5, con su propia DEC.
 */

export type DemandSnapshotFact<F extends DemandFact> = Readonly<{
  value: DemandValues[F] | null;
  status: CurrentStatus;
  factId: string | null;
}>;

export type DemandSnapshot = Readonly<{
  [F in DemandFact]: DemandSnapshotFact<F>;
}>;

function snapshotOf<F extends DemandFact>(
  truth: DemandTruth[F],
): DemandSnapshotFact<F> {
  return truth.status === "unknown"
    ? { value: null, status: "unknown", factId: null }
    : {
        value: truth.value as DemandValues[F],
        status: truth.status,
        factId: truth.factId,
      };
}

export function demandSnapshot(truth: DemandTruth): DemandSnapshot {
  return {
    desired_vehicle: snapshotOf<"desired_vehicle">(truth.desired_vehicle),
    year_range: snapshotOf<"year_range">(truth.year_range),
    budget_max: snapshotOf<"budget_max">(truth.budget_max),
    purchase_type: snapshotOf<"purchase_type">(truth.purchase_type),
    trade_in_intent: snapshotOf<"trade_in_intent">(truth.trade_in_intent),
    down_payment: snapshotOf<"down_payment">(truth.down_payment),
  };
}
