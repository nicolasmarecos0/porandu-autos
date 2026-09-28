import { cn } from "./cn";

type SkeletonTone = "default" | "strong" | "brand" | "inverse";

const toneClasses: Record<SkeletonTone, string> = {
  default: "bg-skeleton",
  strong: "bg-skeleton-strong",
  brand: "bg-brand-border",
  inverse: "bg-skeleton-inverse",
};

type SkeletonRadius = "sm" | "md" | "full";

const radiusClasses: Record<SkeletonRadius, string> = {
  sm: "rounded-sm",
  md: "rounded-md",
  full: "rounded-full",
};

type SkeletonProps = {
  tone?: SkeletonTone;
  radius?: SkeletonRadius;
  /** Tamaño: p. ej. `h-3 w-24` o `size-9`. */
  className?: string;
};

/** Bloque de estructura sin datos. Decorativo: oculto para lectores de pantalla. */
export function Skeleton({
  tone = "default",
  radius = "sm",
  className,
}: SkeletonProps) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "block shrink-0",
        toneClasses[tone],
        radiusClasses[radius],
        className,
      )}
    />
  );
}
