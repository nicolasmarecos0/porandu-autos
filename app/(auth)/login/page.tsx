import type { Metadata } from "next";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { LoginCard } from "@/components/auth/login-card";
import { LoginForm } from "@/components/auth/login-form";
import {
  LoginCompactIntro,
  LoginShowcase,
} from "@/components/auth/login-showcase";
import { TopBar } from "@/components/shell/top-bar";
import { HOME_PATH } from "@/lib/auth/paths";
import { isSecureRequest } from "@/lib/auth/secure-connection";
import { getAuthenticatedUser } from "@/lib/auth/session";

export const metadata: Metadata = { title: "Iniciar sesión" };

/*
 * Login con email + password (DEC-012). Server Component: el formulario
 * llama a la Server Action `signIn`. No hay registro público, magic link,
 * OAuth ni reset de password en B1.
 *
 * Composición ejecutiva (DEC-057): desde `lg`, split-screen 42 / 58 con el
 * formulario a la izquierda y "El Núcleo Porandú" a la derecha. Debajo de
 * `lg`, el formulario primero, con un encabezado compacto del eslogan.
 */
export default async function LoginPage() {
  // Con un usuario ya verificado, el login no tiene nada que hacer.
  if (await getAuthenticatedUser()) redirect(HOME_PATH);

  const secureConnection = isSecureRequest(await headers());

  return (
    <div className="flex min-h-dvh flex-col">
      <TopBar />
      <main className="grid flex-1 lg:grid-cols-[42fr_58fr]">
        <div className="flex flex-col items-center gap-4 px-gutter py-5 sm:justify-center sm:gap-5 sm:py-12 lg:border-r lg:border-border-subtle lg:bg-surface-1 lg:px-12">
          <LoginCompactIntro />
          <LoginCard secureConnection={secureConnection}>
            <LoginForm />
          </LoginCard>
        </div>
        <LoginShowcase />
      </main>
    </div>
  );
}
