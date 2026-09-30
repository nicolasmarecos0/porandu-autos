import "server-only";

import { createServerClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";

import { getPublicEnv } from "@/lib/env.public";

import { authCookieOptions } from "./cookies";

/*
 * Cliente de Supabase Auth para Server Components y Server Actions (H0.6).
 *
 * - Usa solo NEXT_PUBLIC_SUPABASE_URL y la publishable key. Ninguna secret
 *   key, service role ni credencial de Postgres (ADR-001 §8).
 * - Expone solo `auth`. La aplicación no usa la Data API de Supabase
 *   (deshabilitada en H0, ADR-001 §3.3): los datos pasan por db/tenant.ts.
 * - Un cliente nuevo por llamada, nunca compartido entre requests, con el
 *   contrato getAll/setAll de @supabase/ssr sobre `cookies()` de Next.
 * - No hay cliente de Supabase en el navegador.
 */

export type AuthClient = SupabaseClient["auth"];

export async function createAuthClient(): Promise<AuthClient> {
  // Primero cookies(): marca la ruta como dinámica, así el build no la
  // prerenderiza ni necesita el entorno de Supabase.
  const cookieStore = await cookies();
  const { supabaseUrl, supabasePublishableKey } = getPublicEnv();

  const supabase = createServerClient(supabaseUrl, supabasePublishableKey, {
    cookieOptions: authCookieOptions(),
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      // Las cabeceras anti-caché que @supabase/ssr pasa como segundo
      // argumento las aplica proxy.ts. Una Server Action o una página
      // dinámica no se cachean.
      setAll(cookiesToSet) {
        try {
          for (const { name, value, options } of cookiesToSet) {
            cookieStore.set(name, value, options);
          }
        } catch {
          // Un Server Component no puede escribir cookies (solo Server
          // Actions y Route Handlers). El refresh de la sesión ya lo
          // persistió proxy.ts antes del render.
        }
      },
    },
  });

  return supabase.auth;
}
