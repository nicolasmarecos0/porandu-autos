import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { LoginForm } from "@/components/auth/login-form";
import { TopBar } from "@/components/shell/top-bar";
import { Panel, PanelHeader } from "@/components/ui/panel";
import { HOME_PATH } from "@/lib/auth/paths";
import { getAuthenticatedUser } from "@/lib/auth/session";

export const metadata: Metadata = { title: "Iniciar sesión" };

/*
 * Login con email + password (DEC-012). Server Component: el formulario
 * llama a la Server Action `signIn`. No hay registro público, magic link,
 * OAuth ni reset de password en B1.
 */
export default async function LoginPage() {
  // Con un usuario ya verificado, el login no tiene nada que hacer.
  if (await getAuthenticatedUser()) redirect(HOME_PATH);

  return (
    <div className="flex min-h-dvh flex-col">
      <TopBar />
      <main className="flex flex-1 items-start justify-center px-gutter py-16">
        <Panel className="w-full max-w-sm">
          <PanelHeader>
            <h1 className="text-heading text-text-primary">Iniciar sesión</h1>
          </PanelHeader>
          <div className="p-4">
            <LoginForm />
          </div>
        </Panel>
      </main>
    </div>
  );
}
