import { vi } from "vitest";

import { describeAuthTenantAcceptance } from "./support/auth-tenant-spec";
import { stagingAuthTenantTarget } from "./support/target";

// `server-only` lo resuelve Next; en Vitest (entorno node) es un no-op.
vi.mock("server-only", () => ({}));
// cookies() y redirect() de Next: el navegador simulado del spec.
vi.mock("next/headers", async () => {
  const context = await import("./support/request-context");
  return { cookies: context.cookies };
});
vi.mock("next/navigation", async () => {
  const context = await import("./support/request-context");
  return { redirect: context.redirect };
});

/*
 * Acceptance Auth → Tenant contra staging, con usuarios y organizaciones
 * sintéticos de esta corrida (STAGING_SYNTHETIC_RUN_ID) que se borran al
 * terminar. Solo lo corre el workflow Staging DB (`pnpm test:staging`),
 * nunca CI.
 */
describeAuthTenantAcceptance(() => stagingAuthTenantTarget());
