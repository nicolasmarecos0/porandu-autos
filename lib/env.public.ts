import { parsePublicEnv, type PublicEnv } from "@/lib/env";

/*
 * Variables públicas: se incrustan en el bundle del navegador en build.
 * Next solo las reemplaza si se leen como `process.env.NEXT_PUBLIC_*`
 * literal, por eso no se pasa `process.env` completo.
 */
export function getPublicEnv(): PublicEnv {
  return parsePublicEnv({
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY:
      process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
  });
}
