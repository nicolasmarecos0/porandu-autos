import { AppShell } from "@/components/shell/app-shell";

// El auth guard y el tenant context se suman acá en el commit 8 de B1.
export default function AppLayout({ children }: LayoutProps<"/">) {
  return <AppShell>{children}</AppShell>;
}
