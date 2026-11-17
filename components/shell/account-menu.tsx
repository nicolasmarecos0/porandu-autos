"use client";

import { useTransition } from "react";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { MenuIcon } from "@/components/ui/icons";
import { signOut } from "@/lib/auth/actions";

/**
 * Menú de la cuenta en la banda superior (DEC-055): reemplaza al botón
 * suelto "Cerrar sesión". Muestra con qué cuenta se entró (el email de los
 * claims verificados, sin otra lectura) y cierra la sesión con la misma
 * Server Action `signOut`. Menú de Radix: teclado, foco y Escape incluidos.
 */
export function AccountMenu({ email }: { email: string | null }) {
  const [pending, startTransition] = useTransition();
  const name = email ? email.split("@")[0] : null;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label={email ? `Cuenta: ${email}` : "Cuenta"}
        className="inline-flex h-8 items-center gap-2 rounded-md px-2.5 text-label font-semibold text-text-inverse transition-colors hover:bg-surface-1/10 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring-inverse data-[state=open]:bg-surface-1/10"
      >
        <MenuIcon className="size-4.5" />
        {name ? (
          <span className="hidden max-w-40 truncate sm:inline">{name}</span>
        ) : null}
      </DropdownMenuTrigger>
      <DropdownMenuContent>
        {email ? (
          <>
            <DropdownMenuLabel>{email}</DropdownMenuLabel>
            <DropdownMenuSeparator />
          </>
        ) : null}
        <DropdownMenuItem onSelect={() => startTransition(() => signOut())}>
          {pending ? "Cerrando sesión…" : "Cerrar sesión"}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
