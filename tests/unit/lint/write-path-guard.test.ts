import { fileURLToPath } from "node:url";

import { ESLint } from "eslint";
import { describe, expect, it } from "vitest";

/*
 * Guardas de ESLint de las altas (H1.2 y H1.3B):
 * - la escritura de oportunidades (db/queries/create-opportunity) tiene una
 *   sola puerta: la Server Action createOpportunity()
 *   (lib/opportunities/actions.ts);
 * - la de unidades (db/queries/create-vehicle), también: la Server Action
 *   createVehicle() (lib/vehicles/actions.ts);
 * - ninguna escritura puede saltear el boundary: db/client sigue vedado;
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

const importVehicleWrite = `import { createVehicleInPreparation } from "@/db/queries/create-vehicle";\nexport const use = createVehicleInPreparation;\n`;

describe(
  "una sola puerta para el alta rápida de unidades (H1.3B)",
  { timeout: 30_000 },
  () => {
    it.each([
      "app/(app)/stock/page.tsx",
      "components/stock/new-vehicle-drawer.tsx",
      "components/stock/stock-view.tsx",
      "lib/vehicles/new-vehicle.ts",
      "lib/opportunities/actions.ts",
      "lib/tenant/session.ts",
      "db/queries/vehicles.ts",
      "db/queries/memberships.ts",
      "db/tenant.ts",
    ])("falla en %s", async (filePath) => {
      expect(await restrictedBy(filePath, importVehicleWrite)).toContain(
        "no-restricted-imports",
      );
    });

    it("también por ruta relativa dentro de db/queries", async () => {
      expect(
        await restrictedBy(
          "db/queries/vehicles.ts",
          `import { createVehicleInPreparation } from "./create-vehicle";\nexport const use = createVehicleInPreparation;\n`,
        ),
      ).toContain("no-restricted-imports");
    });

    it("se permite en la Server Action", async () => {
      expect(
        await restrictedBy("lib/vehicles/actions.ts", importVehicleWrite),
      ).toEqual([]);
    });

    it("la Server Action de unidades no importa la escritura de oportunidades", async () => {
      expect(
        await restrictedBy("lib/vehicles/actions.ts", importWrite),
      ).toContain("no-restricted-imports");
    });

    it("los tipos del alta sí se pueden importar (no escriben)", async () => {
      expect(
        await restrictedBy(
          "lib/vehicles/new-vehicle.ts",
          `import type { NewVehicle } from "@/db/queries/create-vehicle";\nexport type N = NewVehicle;\n`,
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
      ["db/queries/create-opportunity.ts"],
      ["db/queries/create-vehicle.ts"],
    ])("%s no importa db/client", async (filePath) => {
      for (const code of [
        `import { getDb } from "../client";\nexport const use = getDb;\n`,
        `import { getDb } from "@/db/client";\nexport const use = getDb;\n`,
        `export const use = () => import("../client");\n`,
      ]) {
        expect(await restrictedBy(filePath, code)).not.toEqual([]);
      }
    });

    it("db/queries/create-vehicle.ts no importa withUser() ni resolveTenant()", async () => {
      for (const code of [
        `import { withUser } from "../tenant";\nexport const use = withUser;\n`,
        `import { resolveTenant } from "@/lib/tenant/resolution";\nexport const use = resolveTenant;\n`,
      ]) {
        expect(
          await restrictedBy("db/queries/create-vehicle.ts", code),
        ).not.toEqual([]);
      }
    });
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
