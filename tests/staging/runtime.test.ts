import { vi } from "vitest";

import { describeRuntimeAcceptance } from "./support/runtime-spec";
import { stagingRuntimeTarget } from "./support/target";

// `server-only` lo resuelve Next; en Vitest (entorno node) es un no-op.
vi.mock("server-only", () => ({}));

/*
 * Acceptance del runtime contra staging: app_runtime por Supavisor en modo
 * transacción (6543), con la password de STAGING_RUNTIME_DB_PASSWORD. Solo
 * lo corre el workflow Staging DB (`pnpm test:staging`), nunca CI.
 */
describeRuntimeAcceptance({
  runtimeUrl: () => stagingRuntimeTarget().runtimeUrl,
  iterations: 30,
});
