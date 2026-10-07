import { fileURLToPath } from "node:url";

import { ESLint } from "eslint";
import { describe, expect, it } from "vitest";

/*
 * Guardas de ESLint de las escrituras (H1.2, H1.3B y H1.3C):
 * - la escritura de oportunidades (db/queries/create-opportunity) tiene una
 *   sola puerta: la Server Action createOpportunity()
 *   (lib/opportunities/actions.ts);
 * - la de unidades (db/queries/create-vehicle), también: la Server Action
 *   createVehicle() (lib/vehicles/actions.ts);
 * - la disponibilidad de una unidad (db/queries/mark-vehicle-available),
 *   también: la Server Action markVehicleAvailable() (lib/vehicles/actions.ts);
 * - ninguna escritura puede saltear el boundary: db/client sigue vedado;
 * - la demanda (H1.4) tiene un único módulo de escritura
 *   (db/queries/demand-facts), que solo usan el alta
 *   (db/queries/create-opportunity) y la Server Action recordDemand()
 *   (lib/opportunities/actions.ts), y que nunca usa ON CONFLICT;
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

const importAvailabilityWrite = `import { transitionVehicleToAvailable } from "@/db/queries/mark-vehicle-available";\nexport const use = transitionVehicleToAvailable;\n`;

describe(
  "una sola puerta para la disponibilidad de unidades (H1.3C)",
  { timeout: 30_000 },
  () => {
    it.each([
      "app/(app)/stock/page.tsx",
      "components/stock/stock-view.tsx",
      "components/stock/unit-context.tsx",
      "components/stock/mark-available-dialog.tsx",
      "lib/vehicles/availability.ts",
      "lib/vehicles/new-vehicle.ts",
      "lib/opportunities/actions.ts",
      "lib/tenant/session.ts",
      "db/queries/vehicles.ts",
      "db/queries/create-vehicle.ts",
      "db/queries/memberships.ts",
      "db/tenant.ts",
    ])("falla en %s", async (filePath) => {
      expect(await restrictedBy(filePath, importAvailabilityWrite)).toContain(
        "no-restricted-imports",
      );
    });

    it("también por ruta relativa dentro de db/queries", async () => {
      expect(
        await restrictedBy(
          "db/queries/vehicles.ts",
          `import { transitionVehicleToAvailable } from "./mark-vehicle-available";\nexport const use = transitionVehicleToAvailable;\n`,
        ),
      ).toContain("no-restricted-imports");
    });

    it("se permite en la Server Action", async () => {
      expect(
        await restrictedBy("lib/vehicles/actions.ts", importAvailabilityWrite),
      ).toEqual([]);
    });

    it("los tipos del resultado sí se pueden importar (no escriben)", async () => {
      expect(
        await restrictedBy(
          "lib/vehicles/availability.ts",
          `import type { AvailabilityTransition } from "@/db/queries/mark-vehicle-available";\nexport type T = AvailabilityTransition;\n`,
        ),
      ).toEqual([]);
    });
  },
);

const importDemandWrite = `import { recordDemandCapture } from "@/db/queries/demand-facts";\nexport const use = recordDemandCapture;\n`;

describe(
  "un único módulo de escritura para la demanda (H1.4, C-8)",
  { timeout: 30_000 },
  () => {
    it.each([
      "app/(app)/opportunities/page.tsx",
      "components/opportunities/opportunities-view.tsx",
      "components/opportunities/new-opportunity-drawer.tsx",
      "domains/demand/planner.ts",
      "lib/opportunities/new-opportunity.ts",
      "lib/opportunities/demand-form.ts",
      "lib/vehicles/actions.ts",
      "lib/tenant/session.ts",
      "lib/contacts/phone.ts",
      "db/queries/opportunities.ts",
      "db/queries/demand-rows.ts",
      "db/queries/create-vehicle.ts",
      "db/queries/memberships.ts",
      "db/tenant.ts",
    ])("falla en %s", async (filePath) => {
      expect(await restrictedBy(filePath, importDemandWrite)).toContain(
        "no-restricted-imports",
      );
    });

    it("también por ruta relativa dentro de db/queries", async () => {
      expect(
        await restrictedBy(
          "db/queries/opportunities.ts",
          `import { appendDemand } from "./demand-facts";\nexport const use = appendDemand;\n`,
        ),
      ).toContain("no-restricted-imports");
    });

    it("se permite en el alta (misma transacción) y en la Server Action recordDemand()", async () => {
      expect(
        await restrictedBy(
          "db/queries/create-opportunity.ts",
          `import { appendDemand } from "./demand-facts";\nexport const use = appendDemand;\n`,
        ),
      ).toEqual([]);
      expect(
        await restrictedBy("lib/opportunities/actions.ts", importDemandWrite),
      ).toEqual([]);
    });

    it("los tipos del resultado sí se pueden importar (no escriben)", async () => {
      expect(
        await restrictedBy(
          "lib/opportunities/record-demand.ts",
          `import type { DemandWriteOutcome } from "@/db/queries/demand-facts";\nexport type O = DemandWriteOutcome;\n`,
        ),
      ).toEqual([]);
    });

    it("el schema puede exportar su tabla: el guard es del módulo de escritura", async () => {
      expect(
        await restrictedBy(
          "db/schema/index.ts",
          `export * from "./opportunity-demand-facts";\n`,
        ),
      ).toEqual([]);
    });

    it.each(["onConflictDoNothing", "onConflictDoUpdate"])(
      "el módulo de escritura no usa %s (append-only, compare-and-set)",
      async (method) => {
        expect(
          await restrictedBy(
            "db/queries/demand-facts.ts",
            `export const run = (q: { ${method}: (x?: unknown) => unknown }) => q.${method}();\n`,
          ),
        ).toContain("no-restricted-syntax");
      },
    );

    it("db/queries/demand-facts.ts no importa db/client", async () => {
      for (const code of [
        `import { getDb } from "../client";\nexport const use = getDb;\n`,
        `export const use = () => import("../client");\n`,
      ]) {
        expect(
          await restrictedBy("db/queries/demand-facts.ts", code),
        ).not.toEqual([]);
      }
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
      ["db/queries/mark-vehicle-available.ts"],
    ])("%s no importa db/client", async (filePath) => {
      for (const code of [
        `import { getDb } from "../client";\nexport const use = getDb;\n`,
        `import { getDb } from "@/db/client";\nexport const use = getDb;\n`,
        `export const use = () => import("../client");\n`,
      ]) {
        expect(await restrictedBy(filePath, code)).not.toEqual([]);
      }
    });

    it.each([
      ["db/queries/create-vehicle.ts"],
      ["db/queries/mark-vehicle-available.ts"],
    ])("%s no importa withUser() ni resolveTenant()", async (filePath) => {
      for (const code of [
        `import { withUser } from "../tenant";\nexport const use = withUser;\n`,
        `import { resolveTenant } from "@/lib/tenant/resolution";\nexport const use = resolveTenant;\n`,
      ]) {
        expect(await restrictedBy(filePath, code)).not.toEqual([]);
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
