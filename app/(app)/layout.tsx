import { AppShell } from "@/components/shell/app-shell";
import { requireTenant } from "@/lib/tenant/session";

/*
 * Gate de Tenant Resolution (H0.7) para el área (app):
 * - sin usuario verificado → /login;
 * - usuario sin memberships activas → /no-access;
 * - varias organizaciones y ninguna elección válida → /select-organization;
 * - tenant válido → el producto.
 *
 * Es un gate de UX, NO la autorización sobre los datos. Un layout no se
 * vuelve a renderizar en las navegaciones del cliente (partial rendering) y
 * no le pasa el contexto a las páginas. Todo loader o Server Action
 * tenant-scoped (Hito 1) llama a `requireTenant()` junto a sus queries y le
 * pasa ese TenantContext a `withTenant()`, que no acepta ningún otro. Dentro
 * de una misma request, `cache()` hace que esa segunda llamada no repita la
 * verificación ni las queries. En H0 las páginas muestran mock data y no
 * hacen queries tenant-scoped.
 */
export default async function AppLayout({ children }: LayoutProps<"/">) {
  await requireTenant();
  return <AppShell>{children}</AppShell>;
}
