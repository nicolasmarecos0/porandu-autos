import { cn } from "./cn";

const sizeClasses = {
  xs: "size-6 text-[0.625rem]",
  sm: "size-7 text-caption",
  md: "size-9 text-label",
  lg: "size-12 text-heading",
  xl: "size-14 text-title",
} as const;

const toneClasses = {
  neutral: "bg-surface-3 text-text-secondary",
  brand: "bg-brand-soft text-brand-strong",
  /** Sobre superficies de marca. */
  onBrand: "bg-surface-1 text-brand-strong",
} as const;

type AvatarProps = {
  initials: string;
  size?: keyof typeof sizeClasses;
  tone?: keyof typeof toneClasses;
  className?: string;
};

/** Avatar de iniciales. Decorativo: el nombre visible acompaña siempre. */
export function Avatar({
  initials,
  size = "sm",
  tone = "neutral",
  className,
}: AvatarProps) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "inline-flex shrink-0 items-center justify-center rounded-full font-semibold tracking-wide select-none",
        sizeClasses[size],
        toneClasses[tone],
        className,
      )}
    >
      {initials}
    </span>
  );
}
