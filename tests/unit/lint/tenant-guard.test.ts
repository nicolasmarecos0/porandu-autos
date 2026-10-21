import { fileURLToPath } from "node:url";

import { ESLint } from "eslint";
import { describe, expect, it } from "vitest";

/*
 * Guardas de ESLint de Tenant Resolution (H0.7):
 * - withUser() (sin organización) solo lo importa la query de memberships
 *   propias, db/queries/memberships.ts;
 * - resolveTenant(), el único que emite un TenantContext, solo lo importa
 *   requireTenant() (lib/tenant/session.ts);
 * - withIngestion() (Hito 7, DEC-039 §4), la puerta del sistema sin
 *   usuario, solo lo importa db/queries/ingest-whatsapp-message.ts.
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
const useIngestion = "\nexport const use = withIngestion;\n";

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
      "db/queries/opportunities.ts",
      `import { withTenant } from "../tenant";\nexport const use = withTenant;\n`,
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

describe("guarda de withIngestion() (Hito 7)", { timeout: 30_000 }, () => {
  it.each([
    [
      "app/api/webhooks/whatsapp/route.ts",
      `import { withIngestion } from "@/db/tenant";${useIngestion}`,
    ],
    [
      "lib/whatsapp/webhook.ts",
      `import { withIngestion } from "@/db/tenant";${useIngestion}`,
    ],
    [
      "db/queries/record-message.ts",
      `import { withIngestion } from "../tenant";${useIngestion}`,
    ],
    [
      "db/queries/memberships.ts",
      `import { withIngestion } from "../tenant";${useIngestion}`,
    ],
    [
      "lib/opportunities/actions.ts",
      `import { withIngestion } from "@/db/tenant";${useIngestion}`,
    ],
    ["lib/data.ts", `export { withIngestion } from "@/db/tenant";`],
  ])("falla en %s: %s", async (filePath, code) => {
    expect(await restrictedBy(filePath, code)).toContain(
      "no-restricted-imports",
    );
  });

  it.each([
    [
      "db/queries/ingest-whatsapp-message.ts",
      `import { withIngestion } from "../tenant";${useIngestion}`,
    ],
    [
      "tests/db/whatsapp-ingestion.test.ts",
      `import { withIngestion } from "@/db/tenant";${useIngestion}`,
    ],
  ])("se permite en %s: %s", async (filePath, code) => {
    expect(await restrictedBy(filePath, code)).toEqual([]);
  });

  it("el módulo de ingesta no importa withUser() ni db/client", async () => {
    for (const code of [
      `import { withUser } from "../tenant";${useWithUser}`,
      `import { getDb } from "../client";\nexport const use = getDb;\n`,
      `import { getDb } from "@/db/client";\nexport const use = getDb;\n`,
    ]) {
      expect(
        await restrictedBy("db/queries/ingest-whatsapp-message.ts", code),
      ).toContain("no-restricted-imports");
    }
  });
});
