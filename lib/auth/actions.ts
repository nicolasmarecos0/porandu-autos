"use server";

import { redirect } from "next/navigation";

import { createAuthClient } from "@/lib/supabase/server";
import { clearActiveOrganization } from "@/lib/tenant/cookie";

import {
  loginErrorFrom,
  parseLoginForm,
  type LoginError,
  type LoginFormState,
} from "./login";
import { HOME_PATH, LOGIN_PATH } from "./paths";

/*
 * Server Actions de sesión (H0.6). Son endpoints públicos: validan en el
 * servidor, solo leen email y password del formulario (cualquier otro campo,
 * como una organización o un destino, se ignora) y redirigen a rutas fijas.
 * No hay registro público, magic link, OAuth ni reset de password en B1.
 */

/*
 * Para diagnosticar fallas del proveedor sin exponer credenciales: solo
 * nombre, status y código del error, nunca el email, el password ni tokens.
 */
function logAuthFailure(operation: string, error: unknown): void {
  const { name, status, code } =
    typeof error === "object" && error !== null
      ? (error as { name?: unknown; status?: unknown; code?: unknown })
      : {};
  console.error(`[auth] ${operation} failed`, { name, status, code });
}

export async function signIn(
  _previous: LoginFormState,
  formData: FormData,
): Promise<LoginFormState> {
  const parsed = parseLoginForm(formData);
  if (!parsed.ok) return { error: parsed.error, email: parsed.email };

  const { email, password } = parsed.input;
  const auth = await createAuthClient();

  let failure: LoginError | null = null;
  try {
    const { error } = await auth.signInWithPassword({ email, password });
    if (error) {
      failure = loginErrorFrom(error);
      if (failure === "unavailable") logAuthFailure("signIn", error);
    }
  } catch (error) {
    failure = "unavailable";
    logAuthFailure("signIn", error);
  }
  if (failure) return { error: failure, email };

  // Fuera del try: redirect() lanza para cortar la acción.
  redirect(HOME_PATH);
}

export async function signOut(): Promise<void> {
  const auth = await createAuthClient();
  try {
    // `local`: revoca en Supabase Auth la sesión actual, sin cerrar las de
    // otros dispositivos. auth-js descarta la sesión local aunque la
    // revocación remota falle, y @supabase/ssr borra sus cookies (setAll).
    const { error } = await auth.signOut({ scope: "local" });
    if (error) logAuthFailure("signOut", error);
  } catch (error) {
    logAuthFailure("signOut", error);
  }
  // La preferencia de organización (H0.7) no sobrevive a la sesión: se
  // borra siempre, aunque la revocación remota haya fallado.
  await clearActiveOrganization();
  redirect(LOGIN_PATH);
}
