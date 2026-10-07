"use client";

import { useState } from "react";
import type { DemandSummary } from "@/domains/demand/presentation";

import { DemandEditDrawer, type DemandSaved } from "./demand-edit-drawer";

/*
 * "Editar" del encabezado de /opportunities/[id] (H1.4, DEC-030 §10): el
 * mismo drawer "Lo que busca" de la card "Busca". Al guardar, la Server
 * Action revalida la página y el detalle se vuelve a leer en el servidor;
 * acá solo queda el aviso.
 */

type OpportunityDemandEditProps = {
  opportunityId: string;
  summary: DemandSummary;
};

export function OpportunityDemandEdit({
  opportunityId,
  summary,
}: OpportunityDemandEditProps) {
  const [saved, setSaved] = useState<DemandSaved | null>(null);
  return (
    <>
      <p
        role="status"
        className={saved ? "text-caption text-success" : "sr-only"}
      >
        {saved
          ? saved.status === "saved"
            ? "Guardado."
            : "No había cambios para guardar."
          : null}
      </p>
      <DemandEditDrawer
        opportunityId={opportunityId}
        summary={summary}
        onSaved={setSaved}
      />
    </>
  );
}
