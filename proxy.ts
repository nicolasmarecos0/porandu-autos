import type { NextRequest } from "next/server";

import { updateSession } from "@/lib/supabase/proxy";

/*
 * Proxy de Next 16 (la convención que reemplaza a middleware.ts). Refresca la
 * sesión de Supabase Auth y manda a /login las navegaciones sin usuario
 * verificado. No consulta Postgres, no resuelve tenant y no es la barrera de
 * autorización (ver lib/supabase/proxy.ts).
 */
export async function proxy(request: NextRequest) {
  return updateSession(request);
}

export const config = {
  matcher: [
    /*
     * Todo menos los assets: _next/static, _next/image y archivos de imagen o
     * ícono (favicon.ico, el icon.svg de app/).
     */
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
};
