import { OpportunityDetailSkeleton } from "@/components/shell/route-skeletons";

/*
 * Estado de carga de /opportunities/[id] y de su cotización (DEC-058). El
 * nombre del prospecto todavía no se conoce: el anuncio dice "la
 * oportunidad".
 */
export default function OpportunityDetailLoading() {
  return <OpportunityDetailSkeleton label="la oportunidad" />;
}
