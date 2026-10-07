import { DEMAND_FACTS, type DemandFact } from "./facts";
import {
  DEMAND_FORM_FIELDS_BY_FACT,
  EMPTY_DEMAND_FORM_VALUES,
  type DemandFormField,
  type DemandFormValues,
} from "./form";
import type { DemandSummary } from "./presentation";

/*
 * Edición de "Lo que busca" desde /opportunities (H1.4, DEC-030 §10): qué
 * facts modificó el usuario respecto del valor vigente. Pura y apta para el
 * navegador; el servidor vuelve a validar todo.
 *
 * - Los campos se precargan con el valor vigente, nunca con el legado.
 * - Solo se envían los facts modificados.
 * - Vaciar un fact que tenía valor es Quitar ("error de carga", C-3).
 * - Junto a un valor humano que cambia se ofrece "Fue un error de carga",
 *   destildado: por defecto, el cliente cambió (C-2).
 */

/** Valores iniciales del formulario: los vigentes de cada fact. */
export function demandFormBaseline(summary: DemandSummary): DemandFormValues {
  const values: Record<DemandFormField, string> = {
    ...EMPTY_DEMAND_FORM_VALUES,
  };
  for (const fact of DEMAND_FACTS) {
    Object.assign(values, summary.facts[fact].input);
  }
  return values;
}

/** Texto de un campo como lo leerá el servidor (espacios normalizados). */
function normalized(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}

export type DemandEditChange = Readonly<{
  fact: DemandFact;
  /** `remove`: el fact tenía valor y quedó vacío. */
  kind: "set" | "remove";
  /** Reemplaza un valor humano: puede marcarse como error de carga. */
  canBeLoadError: boolean;
}>;

/** Facts modificados respecto del valor vigente, en el orden canónico. */
export function demandEditChanges(
  summary: DemandSummary,
  values: DemandFormValues,
): readonly DemandEditChange[] {
  const baseline = demandFormBaseline(summary);
  return DEMAND_FACTS.flatMap((fact): DemandEditChange[] => {
    const fields = DEMAND_FORM_FIELDS_BY_FACT[fact];
    const changed = fields.some(
      (field) => normalized(values[field]) !== normalized(baseline[field]),
    );
    if (!changed) return [];
    const current = summary.facts[fact];
    const emptied = fields.every((field) => normalized(values[field]) === "");
    if (emptied) {
      // Vaciar algo que ya era Sin dato no cambia nada.
      return current.status === "unknown"
        ? []
        : [{ fact, kind: "remove", canBeLoadError: false }];
    }
    return [
      {
        fact,
        kind: "set",
        canBeLoadError:
          current.status === "confirmed" || current.status === "corrected",
      },
    ];
  });
}
