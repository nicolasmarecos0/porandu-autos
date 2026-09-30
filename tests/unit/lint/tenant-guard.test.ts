import { fileURLToPath } from "node:url";

import { ESLint } from "eslint";
import { describe, expect, it } from "vitest";

/*
 * Guardas de ESLint de Tenant Resolution (H0.7):
 * - withUser() (sin organización) solo lo importa la query de memberships
 *   propias, db/queries/memberships.ts;
 * - resolveTenant(), el único que emite un TenantContext, solo lo importa
 *   requireTenant() (lib/tenant/session.ts).
 * Los tests pueden usar ambos para armar escenarios. db/client sigue
 * restringido en todos estos módulos (db-client-guard.test.ts).
 */

const eslint = new ESLint({
  cwd: fileURLToPath(new URL("../../../", import.meta.url)),
});

async function restrictedBy(filePath: string, code: string) {
  const [result] = await eslint.lintText(code, { filePath });
  return (result?.messages ?? [])
    .map((m) => m.ruleId)
    .filter(
      (rule) =>
        rule === "no-restricted-imports" || rule === "no-restricted-syntax",
    );
}

const useWithUser = "\nexport const use = withUser;\n";
const useResolve = "\nexport const use = resolveTenant;\n";

describe("guarda de withUser()", { timeout: 30_000 }, () => {
  it.each([
    [
      "app/(app)/cockpit/page.tsx",
      `import { withUser } from "@/db/tenant";${useWithUser}`,
    ],
    [
      "mocks/opportunities.ts",
      `import * as tenant from "@/db/tenant";\nexport const use = tenant;\n`,
    ],
    [
      "lib/tenant/session.ts",
      `import { withUser } from "@/db/tenant";${useWithUser}`,
    ],
    [
      "db/queries/stock.ts",
      `import { withUser } from "../tenant";${useWithUser}`,
    ],
    ["db/loaders.ts", `import { withUser } from "./tenant";${useWithUser}`],
    ["lib/data.ts", `export { withUser } from "@/db/tenant";`],
  ])("falla en %s: %s", async (filePath, code) => {
    expect(await restrictedBy(filePath, code)).toContain(
      "no-restricted-imports",
    );
  });

  it.each([
    [
      "db/queries/memberships.ts",
      `import { withUser } from "../tenant";${useWithUser}`,
    ],
    [
      "tests/db/tenant-resolution.test.ts",
      `import { withUser } from "@/db/tenant";${useWithUser}`,
    ],
    [
      "app/(app)/cockpit/page.tsx",
      `import { withTenant } from "@/db/tenant";\nexport const use = withTenant;\n`,
    ],
  ])("se permite en %s: %s", async (filePath, code) => {
    expect(await restrictedBy(filePath, code)).toEqual([]);
  });
});

describe("guarda de resolveTenant()", { timeout: 30_000 }, () => {
  it.each([
    [
      "app/(app)/cockpit/page.tsx",
      `import { resolveTenant } from "@/lib/tenant/resolution";${useResolve}`,
    ],
    [
      "lib/tenant/actions.ts",
      `import { resolveTenant } from "./resolution";${useResolve}`,
    ],
    [
      "lib/auth/session.ts",
      `import { resolveTenant } from "../tenant/resolution";${useResolve}`,
    ],
    [
      "db/tenant.ts",
      `import { resolveTenant } from "@/lib/tenant/resolution";${useResolve}`,
    ],
    [
      "db/queries/memberships.ts",
      `import { resolveTenant } from "@/lib/tenant/resolution";${useResolve}`,
    ],
    [
      "components/tenant/organization-picker.tsx",
      `import * as resolution from "@/lib/tenant/resolution";\nexport const use = resolution;\n`,
    ],
  ])("falla en %s: %s", async (filePath, code) => {
    expect(await restrictedBy(filePath, code)).toContain(
      "no-restricted-imports",
    );
  });

  it.each([
    [
      "lib/tenant/session.ts",
      `import { resolveTenant } from "./resolution";${useResolve}`,
    ],
    [
      "tests/db/support/tenants.ts",
      `import { resolveTenant } from "@/lib/tenant/resolution";${useResolve}`,
    ],
    [
      "db/tenant.ts",
      `import { isTenantContext } from "@/lib/tenant/resolution";\nexport const use = isTenantContext;\n`,
    ],
    [
      "lib/tenant/actions.ts",
      `import { parseOrganizationId } from "./resolution";\nexport const use = parseOrganizationId;\n`,
    ],
  ])("se permite en %s: %s", async (filePath, code) => {
    expect(await restrictedBy(filePath, code)).toEqual([]);
  });
});

describe("las excepciones no abren db/client", { timeout: 30_000 }, () => {
  it.each([
    ["db/queries/memberships.ts", `import { getDb } from "../client";`],
    ["lib/tenant/session.ts", `import { getDb } from "@/db/client";`],
    [
      "tests/db/tenant-resolution.test.ts",
      `import { getDb } from "@/db/client";`,
    ],
  ])("%s no importa db/client", async (filePath, code) => {
    expect(
      await restrictedBy(filePath, `${code}\nexport const use = getDb;\n`),
    ).toContain("no-restricted-imports");
  });
});
