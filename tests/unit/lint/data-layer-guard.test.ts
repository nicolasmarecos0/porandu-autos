import { fileURLToPath } from "node:url";

import { ESLint } from "eslint";
import { describe, expect, it } from "vitest";

/*
 * Guardas de ESLint de la capa de datos (H1.1, DEC-016 y DEC-021):
 * - páginas y componentes no conocen Drizzle, db/schema ni el boundary: leen
 *   con los loaders de db/queries/, que llaman a requireTenant() y
 *   withTenant();
 * - domains/ no depende de db/, mocks/, Drizzle, React ni Next;
 * - la cola de Opportunities tiene una sola fuente: el fixture de B1
 *   (mocks/opportunities) solo se importa desde tests/.
 */

const eslint = new ESLint({
  cwd: fileURLToPath(new URL("../../../", import.meta.url)),
});

async function restrictedBy(filePath: string, code: string) {
  const [result] = await eslint.lintText(code, { filePath });
  return (result?.messages ?? [])
    .map((m) => m.ruleId)
    .filter((rule) => rule === "no-restricted-imports");
}

const PAGE = "app/(app)/opportunities/page.tsx";
const COMPONENT = "components/opportunities/opportunity-queue.tsx";
const DOMAIN = "domains/opportunities/queue.ts";

describe(
  "páginas y componentes no conocen la capa de datos",
  { timeout: 30_000 },
  () => {
    it.each([
      [PAGE, `import { eq } from "drizzle-orm";\nexport const use = eq;\n`],
      [
        PAGE,
        `import { sql } from "drizzle-orm/sql";\nexport const use = sql;\n`,
      ],
      [
        PAGE,
        `import { opportunities } from "@/db/schema";\nexport const use = opportunities;\n`,
      ],
      [
        PAGE,
        `import { withTenant } from "@/db/tenant";\nexport const use = withTenant;\n`,
      ],
      [
        COMPONENT,
        `import { contacts } from "../../db/schema/contacts";\nexport const use = contacts;\n`,
      ],
      [
        COMPONENT,
        `import { withTenant } from "@/db/tenant";\nexport const use = withTenant;\n`,
      ],
    ])("falla en %s: %s", async (filePath, code) => {
      expect(await restrictedBy(filePath, code)).toContain(
        "no-restricted-imports",
      );
    });

    it.each([
      [
        PAGE,
        `import { getOpportunityQueue } from "@/db/queries/opportunities";\nexport const use = getOpportunityQueue;\n`,
      ],
      [
        COMPONENT,
        `import type { Opportunity } from "@/domains/opportunities/types";\nexport type O = Opportunity;\n`,
      ],
      [
        "db/queries/opportunities.ts",
        `import { and } from "drizzle-orm";\nimport { opportunities } from "../schema";\nimport { withTenant } from "../tenant";\nexport const use = [and, opportunities, withTenant];\n`,
      ],
    ])("se permite en %s: %s", async (filePath, code) => {
      expect(await restrictedBy(filePath, code)).toEqual([]);
    });
  },
);

describe("domains/ es lógica pura (DEC-016)", { timeout: 30_000 }, () => {
  it.each([
    `import { getOpportunityQueue } from "@/db/queries/opportunities";\nexport const use = getOpportunityQueue;\n`,
    `import { opportunities } from "../../db/schema";\nexport const use = opportunities;\n`,
    `import { OPPORTUNITY_FIXTURES } from "@/mocks/opportunities";\nexport const use = OPPORTUNITY_FIXTURES;\n`,
    `import { eq } from "drizzle-orm";\nexport const use = eq;\n`,
    `import { useState } from "react";\nexport const use = useState;\n`,
    `import { redirect } from "next/navigation";\nexport const use = redirect;\n`,
  ])("falla: %s", async (code) => {
    expect(await restrictedBy(DOMAIN, code)).toContain("no-restricted-imports");
  });

  it("se permiten otros módulos de domains/", async () => {
    expect(
      await restrictedBy(
        DOMAIN,
        `import { UNSCORED } from "@/domains/scoring/types";\nimport { RECENCY_BANDS } from "./recency";\nexport const use = [UNSCORED, RECENCY_BANDS];\n`,
      ),
    ).toEqual([]);
  });
});

describe(
  "una sola fuente para la cola de Opportunities",
  { timeout: 30_000 },
  () => {
    const importFixtures = `import { OPPORTUNITY_FIXTURES } from "@/mocks/opportunities";\nexport const use = OPPORTUNITY_FIXTURES;\n`;

    it.each([
      PAGE,
      COMPONENT,
      "lib/tenant/session.ts",
      "db/queries/opportunities.ts",
      "db/queries/memberships.ts",
      "db/tenant.ts",
    ])("falla en %s", async (filePath) => {
      expect(await restrictedBy(filePath, importFixtures)).toContain(
        "no-restricted-imports",
      );
    });

    it("los tests lo usan como referencia del contrato visual", async () => {
      expect(
        await restrictedBy(
          "tests/unit/db/opportunities.test.ts",
          importFixtures,
        ),
      ).toEqual([]);
    });
  },
);
