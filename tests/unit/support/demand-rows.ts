import type { DemandFact, DemandValues } from "@/domains/demand/facts";
import type {
  DemandFactStatus,
  DemandRowOf,
  DemandSourceKind,
} from "@/domains/demand/resolver";

/*
 * Filas sintéticas del ledger de demanda para los tests del dominio. Las
 * humanas son las que H1.4 escribe; las detecciones (`detected`) son
 * sintéticas: la base de H1.4 las prohíbe, y existen para fijar el contrato
 * que consumirán H2a/H2b (criterio F1).
 *
 * Notación de la spec: `hN` = acto humano, `dN` = detección.
 */

export const SELLER = "00000000-0000-4000-8000-00000000000a";
export const OTHER_SELLER = "00000000-0000-4000-8000-00000000000c";

/** Hora del 6 oct 2026 en UTC ("14:05" → 2026-10-06T14:05:00Z). */
export function at(time: string): Date {
  return new Date(`2026-10-06T${time}:00Z`);
}

export const PYG = (amount: string) =>
  ({ amount: `${amount}.00`, currency: "PYG" }) as const;

type HumanOptions = Readonly<{
  target?: string | null;
  previous?: string | null;
  at?: string;
  by?: string;
  note?: string | null;
}>;

export function human<F extends DemandFact>(
  id: string,
  fact: F,
  status: Exclude<DemandFactStatus, "detected">,
  value: DemandValues[F] | null,
  options: HumanOptions = {},
): DemandRowOf<F> {
  return {
    id,
    fact,
    status,
    sourceKind: "member",
    recordedBy: options.by ?? SELLER,
    recordedAt: at(options.at ?? "14:05"),
    observedAt: null,
    targetFactId: options.target ?? null,
    previousMemberFactId: options.previous ?? null,
    value,
    evidenceText: options.note ?? null,
  };
}

type DetectionOptions = Readonly<{
  at?: string;
  observed?: string;
  source?: Exclude<DemandSourceKind, "member">;
  note?: string;
}>;

export function detection<F extends DemandFact>(
  id: string,
  fact: F,
  value: DemandValues[F],
  options: DetectionOptions = {},
): DemandRowOf<F> {
  return {
    id,
    fact,
    status: "detected",
    sourceKind: options.source ?? "extractor",
    recordedBy: null,
    recordedAt: at(options.at ?? "14:00"),
    observedAt: options.observed ? at(options.observed) : null,
    targetFactId: null,
    previousMemberFactId: null,
    value,
    evidenceText: options.note ?? "mensaje del cliente",
  };
}

/** Id legible y ordenable (`hN` y `dN` como en la spec). */
export function id(name: string): string {
  const [kind, n] = [name[0], name.slice(1).padStart(4, "0")];
  return `${kind === "h" ? "1" : "2"}0000000-0000-4000-8000-00000000${n}`;
}
