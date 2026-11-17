"use client";

import { useEffect, useRef, useState } from "react";
import { cn } from "./cn";
import { PersonIcon } from "./icons";

const sizeClasses = {
  xs: "size-6 text-[0.625rem]",
  sm: "size-7 text-caption",
  md: "size-9 text-label",
  lg: "size-12 text-heading",
  xl: "size-14 text-title",
  "2xl": "size-16 text-title",
} as const;

const toneClasses = {
  neutral: "bg-surface-3 text-text-secondary",
  brand: "bg-brand-soft text-brand-strong",
  /** Sobre la tarjeta del prospecto en azul marino (DEC-055). */
  onNavy: "bg-surface-1 text-navy ring-2 ring-surface-1/20",
} as const;

type AvatarProps = {
  initials: string;
  /**
   * Avatar ilustrado (DEC-058): un retrato genérico, no una foto de la
   * persona. Si no carga, se ven las iniciales.
   */
  src?: string;
  size?: keyof typeof sizeClasses;
  tone?: keyof typeof toneClasses;
  className?: string;
};

/**
 * Avatar de iniciales o ilustrado. Decorativo: el nombre visible acompaña
 * siempre. Sin iniciales (un nombre sin letras), muestra una silueta: nunca
 * un círculo vacío. La ilustración se pinta sobre las iniciales, que quedan
 * como respaldo si la imagen falla (también si falló antes de hidratar).
 */
export function Avatar({
  initials,
  src,
  size = "sm",
  tone = "neutral",
  className,
}: AvatarProps) {
  const [failed, setFailed] = useState<string | null>(null);
  const imageRef = useRef<HTMLImageElement>(null);
  const showImage = src !== undefined && failed !== src;

  // Una imagen que falló antes de hidratar no dispara onError.
  useEffect(() => {
    const image = imageRef.current;
    if (src && image?.complete && image.naturalWidth === 0) setFailed(src);
  }, [src]);

  return (
    <span
      aria-hidden="true"
      className={cn(
        "relative inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full font-semibold tracking-wide select-none",
        sizeClasses[size],
        toneClasses[tone],
        className,
      )}
    >
      {initials.trim() === "" ? (
        <PersonIcon className="size-[55%]" />
      ) : (
        initials
      )}
      {showImage ? (
        // Ilustración local y estática (public/avatars): next/image no
        // aporta nada a un SVG de pocos KB.
        // eslint-disable-next-line @next/next/no-img-element
        <img
          ref={imageRef}
          src={src}
          alt=""
          draggable={false}
          decoding="async"
          onError={() => setFailed(src)}
          className="absolute inset-0 size-full rounded-full object-cover"
        />
      ) : null}
    </span>
  );
}
