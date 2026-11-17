import { PipelineSkeleton } from "@/components/shell/route-skeletons";

/** Estado de carga de /opportunities/pipeline (DEC-058). */
export default function PipelineLoading() {
  return <PipelineSkeleton title="Embudo de ventas" />;
}
