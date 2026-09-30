import "server-only";

import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

import { verifyAuthenticatedUser } from "@/lib/auth/claims";
import { isPublicPath, LOGIN_PATH } from "@/lib/auth/paths";
import { getPublicEnv } from "@/lib/env.public";

import { authCookieOptions } from "./cookies";

/*
 * Refresh de la sesión de Supabase Auth en proxy.ts (Next 16; antes
 * middleware.ts). Corre antes del render de cada ruta no estática.
 *
 * - `auth.getClaims()` refresca el access token vencido con el refresh token
 *   de la cookie. Las cookies nuevas se escriben en la request, para el
 *   render de esta misma request, y en la response, para el navegador, junto
 *   con las cabeceras anti-caché que indica @supabase/ssr.
 * - No consulta Postgres ni resuelve tenant.
 * - Redirect optimista: una navegación (GET/HEAD) sin usuario verificado a
 *   una ruta privada va a /login. /login es pública, así que no hay loop.
 *   Las Server Actions (POST) no se redirigen: cada una verifica su propia
 *   autorización.
 *
 * No es la barrera de autorización: el server code vuelve a verificar los
 * claims (requireUser() en H0.6; requireTenant() en H0.7).
 */

type CookieToSet = { name: string; value: string; options: CookieOptions };

function isNavigation(request: NextRequest): boolean {
  return request.method === "GET" || request.method === "HEAD";
}

export async function updateSession(
  request: NextRequest,
): Promise<NextResponse> {
  const { supabaseUrl, supabasePublishableKey } = getPublicEnv();
  const pendingCookies: CookieToSet[] = [];
  const cacheHeaders = new Headers();

  const supabase = createServerClient(supabaseUrl, supabasePublishableKey, {
    cookieOptions: authCookieOptions(),
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet, headers) {
        for (const { name, value } of cookiesToSet) {
          request.cookies.set(name, value);
        }
        pendingCookies.push(...cookiesToSet);
        for (const [key, value] of Object.entries(headers)) {
          cacheHeaders.set(key, value);
        }
      },
    },
  });

  // Nada entre createServerClient y getClaims(): el refresh tiene que
  // terminar antes de armar la respuesta (@supabase/ssr).
  const user = await verifyAuthenticatedUser(supabase.auth);

  const response =
    user || isPublicPath(request.nextUrl.pathname) || !isNavigation(request)
      ? NextResponse.next({ request })
      : NextResponse.redirect(new URL(LOGIN_PATH, request.url));

  // También en el redirect: si el refresh falló, @supabase/ssr borra la
  // sesión inválida y el navegador tiene que recibir ese borrado.
  for (const { name, value, options } of pendingCookies) {
    response.cookies.set(name, value, options);
  }
  cacheHeaders.forEach((value, key) => response.headers.set(key, value));

  return response;
}
