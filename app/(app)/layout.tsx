import { AppShell } from "@/components/shell/app-shell";
import { requireUser } from "@/lib/auth/session";

/*
 * Auth guard de H0.6: sin usuario verificado (claims de `auth.getClaims()`),
 * redirect a /login.
 *
 * Es SOLO autenticación: NO valida membership ni organización. Tenant
 * Resolution (H0.7) suma `requireTenant()` y el selector de organización. En
 * H0.6 las páginas muestran mock data y no hacen queries tenant-scoped.
 *
 * Un layout no se vuelve a renderizar en las navegaciones del cliente
 * (partial rendering). Esas navegaciones pasan por el redirect optimista de
 * proxy.ts, y la autorización sobre datos se verifica junto a los datos
 * (`requireTenant()` en H0.7).
 */
export default async function AppLayout({ children }: LayoutProps<"/">) {
  await requireUser();
  return <AppShell>{children}</AppShell>;
}
