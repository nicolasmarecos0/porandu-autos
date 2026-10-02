import type { Metadata } from "next";

import { PROTOTYPE_STOCK } from "./_data";
import { Harness } from "./harness";

/*
 * PROTOTIPO — exploración visual de la Stock List (checkpoint de diseño de
 * H1.3A, autorizada por el fundador; CLAUDE.md §7). No es producto: datos
 * sintéticos, sin base ni tenant. `?empty=1` muestra el estado vacío. Se
 * elimina al promover la variante elegida.
 */

export const metadata: Metadata = { title: "Prototipo · Stock" };

export default async function StockPrototypePage({
  searchParams,
}: PageProps<"/prototypes/stock">) {
  const { empty, v } = await searchParams;
  return (
    <Harness
      vehicles={empty === "1" ? [] : PROTOTYPE_STOCK}
      initial={(parseInt(String(v ?? "1"), 10) || 1) - 1}
    />
  );
}
