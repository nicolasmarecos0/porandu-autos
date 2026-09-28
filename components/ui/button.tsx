import type { ButtonHTMLAttributes } from "react";
import { cn } from "./cn";

const variantClasses = {
  primary:
    "bg-brand text-brand-contrast shadow-sm hover:bg-brand-hover focus-visible:outline-focus-ring",
  secondary:
    "border border-border-default bg-surface-1 text-text-primary hover:border-border-strong hover:bg-surface-2 focus-visible:outline-focus-ring",
} as const;

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: keyof typeof variantClasses;
};

/**
 * Botón base. Responde al presionar con una escala sutil (0.97) y ease-out
 * fuerte; solo transiciona transform y colores.
 */
export function Button({
  variant = "secondary",
  type = "button",
  className,
  ...props
}: ButtonProps) {
  return (
    <button
      type={type}
      className={cn(
        "inline-flex h-8 shrink-0 items-center justify-center gap-1.5 rounded-md px-3 text-label font-semibold transition-[transform,background-color,border-color,color] duration-150 ease-out-strong focus-visible:outline-2 focus-visible:outline-offset-2 active:scale-[0.97] motion-reduce:active:scale-100",
        variantClasses[variant],
        className,
      )}
      {...props}
    />
  );
}
