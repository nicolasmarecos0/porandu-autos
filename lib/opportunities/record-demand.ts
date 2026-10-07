import type { DemandFact } from "@/domains/demand/facts";
import type { DemandFormErrors, DemandFormValues } from "@/domains/demand/form";

/*
 * Estado del formulario "Lo que busca" en /opportunities que devuelve la
 * Server Action recordDemand() (H1.4). Nada de esto expone la base: ni
 * SQLSTATE, ni constraints, ni valores de otra organización.
 */
export type RecordDemandState =
  /** Se agregaron actos al ledger. */
  | Readonly<{
      status: "saved";
      opportunityId: string;
      facts: readonly DemandFact[];
    }>
  /** Lo pedido ya era lo vigente: no se escribió nada. */
  | Readonly<{ status: "unchanged"; opportunityId: string }>
  | Readonly<{
      status: "invalid";
      errors: DemandFormErrors;
      values: DemandFormValues;
      note: string;
    }>
  /**
   * Otro miembro cambió estos facts mientras se editaba: nada se escribió.
   * Lo tipeado vuelve; los valores vigentes se refrescan.
   */
  | Readonly<{
      status: "stale";
      facts: readonly DemandFact[];
      values: DemandFormValues;
      note: string;
    }>
  /** Hay un dato detectado sin revisar en estos facts (H2a+). */
  | Readonly<{
      status: "pending";
      facts: readonly DemandFact[];
      values: DemandFormValues;
      note: string;
    }>
  /** El historial de estos facts no se puede leer (fail-closed). */
  | Readonly<{ status: "inconsistent"; facts: readonly DemandFact[] }>
  /** La oportunidad no existe o no es de la organización activa. */
  | Readonly<{ status: "not_found" }>
  /** Falla inesperada: nada quedó escrito y se puede reintentar. */
  | Readonly<{ status: "failed"; values: DemandFormValues; note: string }>
  | null;
