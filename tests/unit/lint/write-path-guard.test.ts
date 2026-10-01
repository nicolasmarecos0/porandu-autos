import { fileURLToPath } from "node:url";

import { ESLint } from "eslint";
import { describe, expect, it } from "vitest";

/*
 * Guardas de ESLint del alta de oportunidades (H1.2):
 * - la escritura (db/queries/create-opportunity) tiene una sola puerta: la
 *   Server Action createOpportunity() (lib/opportunities/actions.ts);
 * - la escritura no puede saltear el boundary: db/client sigue vedado;
 * - libphonenumber-js (y su metadata) solo vive detrás de
 *   lib/contacts/phone.ts, que es server-only.
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

const importWrite = `import { createOpportunityWithContact } from "@/db/queries/create-opportunity";\nexport const use = createOpportunityWithContact;\n`;
const importPhoneLibrary = `import { parsePhoneNumberWithError } from "libphonenumber-js/max";\nexport const use = parsePhoneNumberWithError;\n`;

describe(
  "una sola puerta para el alta de oportunidades",
  { timeout: 30_000 },
  () => {
    it.each([
      "app/(app)/opportunities/page.tsx",
      "components/opportunities/new-opportunity-drawer.tsx",
      "components/opportunities/opportunities-view.tsx",
      "lib/opportunities/new-opportunity.ts",
      "lib/tenant/session.ts",
      "lib/auth/actions.ts",
      "db/queries/opportunities.ts",
      "db/queries/memberships.ts",
      "db/tenant.ts",
    ])("falla en %s", async (filePath) => {
      expect(await restrictedBy(filePath, importWrite)).toContain(
        "no-restricted-imports",
      );
    });

    it("también por ruta relativa dentro de db/queries", async () => {
      expect(
        await restrictedBy(
          "db/queries/opportunities.ts",
          `import { createOpportunityWithContact } from "./create-opportunity";\nexport const use = createOpportunityWithContact;\n`,
        ),
      ).toContain("no-restricted-imports");
    });

    it("se permite en la Server Action", async () => {
      expect(
        await restrictedBy("lib/opportunities/actions.ts", importWrite),
      ).toEqual([]);
    });

    it("los tipos del alta sí se pueden importar (no escriben)", async () => {
      expect(
        await restrictedBy(
          "lib/opportunities/new-opportunity.ts",
          `import type { NewOpportunity } from "@/db/queries/create-opportunity";\nexport type N = NewOpportunity;\n`,
        ),
      ).toEqual([]);
    });
  },
);

describe(
  "la escritura no saltea el boundary (withTenant())",
  { timeout: 30_000 },
  () => {
    it.each([
      `import { getDb } from "../client";\nexport const use = getDb;\n`,
      `import { getDb } from "@/db/client";\nexport const use = getDb;\n`,
      `export const use = () => import("../client");\n`,
    ])(
      "db/queries/create-opportunity.ts no importa db/client: %s",
      async (code) => {
        expect(
          await restrictedBy("db/queries/create-opportunity.ts", code),
        ).not.toEqual([]);
      },
    );
  },
);

describe(
  "libphonenumber-js es server-only, detrás de lib/contacts/phone.ts",
  { timeout: 30_000 },
  () => {
    it.each([
      "components/opportunities/new-opportunity-drawer.tsx",
      "app/(app)/opportunities/page.tsx",
      "domains/opportunities/new-opportunity.ts",
      "lib/opportunities/new-opportunity.ts",
      "lib/opportunities/actions.ts",
      "db/queries/create-opportunity.ts",
    ])("falla en %s", async (filePath) => {
      expect(await restrictedBy(filePath, importPhoneLibrary)).toContain(
        "no-restricted-imports",
      );
    });

    it("se permite en lib/contacts/phone.ts", async () => {
      expect(
        await restrictedBy("lib/contacts/phone.ts", importPhoneLibrary),
      ).toEqual([]);
    });
  },
);
