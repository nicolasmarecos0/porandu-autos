import type { ReactNode } from "react";
import { LockIcon } from "@/components/ui/icons";

type LoginCardProps = {
  /**
   * La request llegó por HTTPS (`isSecureRequest()`). Sin eso no se muestra
   * "Conexión segura verificada": el indicador nunca afirma algo que no se
   * comprobó (DEC-057).
   */
  secureConnection: boolean;
  children: ReactNode;
};

/**
 * Tarjeta del login (DEC-057): superficie blanca con borde y sombra suaves y
 * un acento superior del azul marino al azul acero de la marca (DEC-055).
 */
export function LoginCard({ secureConnection, children }: LoginCardProps) {
  return (
    <section
      aria-labelledby="login-title"
      className="w-full max-w-md overflow-hidden rounded-xl border border-border-subtle bg-surface-1 shadow-lg"
    >
      <div
        aria-hidden="true"
        className="h-1 bg-linear-to-r from-navy via-navy-hover to-brand"
      />
      <div className="flex flex-col gap-5 px-5 py-5 sm:gap-6 sm:px-8 sm:py-8">
        <header className="flex flex-col gap-1.5">
          <h1 id="login-title" className="text-title font-bold text-navy">
            Iniciar sesión
          </h1>
          <p className="text-body text-text-secondary">
            Ingresá a tu sala de ventas inteligente con tu email y contraseña.
          </p>
        </header>
        {children}
      </div>
      {secureConnection ? (
        <p className="flex items-center justify-center gap-1.5 border-t border-border-subtle bg-surface-2 px-5 py-3 text-caption text-text-muted">
          <LockIcon width={14} height={14} className="text-success" />
          Conexión segura verificada · Porandú Autos
        </p>
      ) : null}
    </section>
  );
}
