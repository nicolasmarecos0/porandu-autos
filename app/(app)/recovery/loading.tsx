import { ModulePlaceholder } from "@/components/shell/module-placeholder";
import { getNavItem } from "@/components/shell/navigation";

const { label } = getNavItem("recovery");

/*
 * Estado de carga de /recovery (DEC-058). La página es el empty state del
 * módulo y no carga datos, pero el layout de (app) hace dinámica la ruta: sin
 * boundary, Next no la prefetchea. El fallback es la misma pantalla.
 */
export default function RecoveryLoading() {
  return <ModulePlaceholder title={label} />;
}
