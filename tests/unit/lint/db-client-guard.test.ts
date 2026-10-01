import { fileURLToPath } from "node:url";

import { ESLint } from "eslint";
import { describe, expect, it } from "vitest";

/*
 * Guarda de ESLint sobre db/client (DEC-006, ADR-001, Build Baseline §7.3):
 * solo db/tenant.ts accede al cliente de bajo nivel; en tests, la prueba
 * del propio cliente y tests/db/support/runtime.ts.
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

const USE = "\nexport const use = getDb;\n";

describe("guarda de imports de db/client", { timeout: 30_000 }, () => {
  it.each([
    ["app/page.tsx", `import { getDb } from "@/db/client";${USE}`],
    [
      "components/shell/rail.tsx",
      `import { getDb } from "../../db/client";${USE}`,
    ],
    ["mocks/opportunities.ts", `export { getDb } from "@/db/client";`],
    ["lib/logger.ts", `export const load = () => import("@/db/client");`],
    ["db/schema/profiles.ts", `import { getDb } from "../client";${USE}`],
    ["db/queries.ts", `import { getDb } from "./client";${USE}`],
    ["db/queries.ts", `export const load = () => import("./client");`],
    [
      "tests/db/tenant-isolation.test.ts",
      `import { getDb } from "@/db/client";${USE}`,
    ],
  ])("falla en %s: %s", async (filePath, code) => {
    expect(await restrictedBy(filePath, code)).not.toEqual([]);
  });

  it.each([
    ["db/tenant.ts", `import { getDb } from "./client";${USE}`],
    [
      "tests/unit/db/client.test.ts",
      `export const load = () => import("@/db/client");`,
    ],
    [
      "tests/db/support/runtime.ts",
      `import { getDb } from "@/db/client";${USE}`,
    ],
    [
      "db/queries/stock.ts",
      `import { withTenant } from "../tenant";\nexport const use = withTenant;\n`,
    ],
    [
      "app/page.tsx",
      `import type { RuntimeDatabase } from "@/db/client";\nexport type Db = RuntimeDatabase;\n`,
    ],
    [
      "components/shell/rail.tsx",
      `import { x } from "./client";\nexport const use = x;\n`,
    ],
  ])("se permite en %s: %s", async (filePath, code) => {
    expect(await restrictedBy(filePath, code)).toEqual([]);
  });

  it("las excepciones siguen sin poder leer MIGRATION_DATABASE_URL", async () => {
    expect(
      await restrictedBy(
        "db/tenant.ts",
        "export const url = process.env.MIGRATION_DATABASE_URL;\n",
      ),
    ).toEqual(["no-restricted-syntax"]);
  });
});
