import { fileURLToPath } from "node:url";

import { ESLint } from "eslint";
import { describe, expect, it } from "vitest";

/*
 * Guardas de ESLint de Stock (H1.3A, H1.3B):
 * - una sola fuente: ni la página /stock, ni sus componentes, ni su loader
 *   (db/queries/vehicles.ts), ni el alta rápida (lib/vehicles/,
 *   db/queries/create-vehicle.ts) importan mocks/;
 * - la página y los componentes no conocen Drizzle, db/schema ni el
 *   boundary: leen con getStockList();
 * - el loader no puede saltear withTenant(): no importa db/client ni
 *   withUser().
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

const PAGE = "app/(app)/stock/page.tsx";
const COMPONENT = "components/stock/stock-view.tsx";
const LOADER = "db/queries/vehicles.ts";

const use = (name: string) => `\nexport const use = ${name};\n`;

describe("una sola fuente para la Stock List", { timeout: 30_000 }, () => {
  it.each([
    [PAGE, `import { VEHICLES } from "@/mocks/vehicles";${use("VEHICLES")}`],
    [PAGE, `import * as stock from "../../../mocks/stock";${use("stock")}`],
    [
      COMPONENT,
      `import { OPPORTUNITY_FIXTURES } from "@/mocks/opportunities";${use("OPPORTUNITY_FIXTURES")}`,
    ],
    [
      COMPONENT,
      `import { VEHICLES } from "@/mocks/vehicles";${use("VEHICLES")}`,
    ],
    [LOADER, `import { VEHICLES } from "@/mocks/vehicles";${use("VEHICLES")}`],
    [LOADER, `import { STOCK } from "../../mocks/stock";${use("STOCK")}`],
    [
      "components/stock/new-vehicle-drawer.tsx",
      `import { VEHICLES } from "@/mocks/vehicles";${use("VEHICLES")}`,
    ],
    [
      "db/queries/create-vehicle.ts",
      `import { VEHICLES } from "../../mocks/vehicles";${use("VEHICLES")}`,
    ],
    [
      "lib/vehicles/actions.ts",
      `import { VEHICLES } from "@/mocks/vehicles";${use("VEHICLES")}`,
    ],
    [
      "lib/vehicles/new-vehicle.ts",
      `import { VEHICLES } from "@/mocks/vehicles";${use("VEHICLES")}`,
    ],
  ])("falla en %s: %s", async (filePath, code) => {
    expect(await restrictedBy(filePath, code)).toContain(
      "no-restricted-imports",
    );
  });
});

describe(
  "la página y los componentes de Stock no conocen la capa de datos",
  { timeout: 30_000 },
  () => {
    it.each([
      [PAGE, `import { desc } from "drizzle-orm";${use("desc")}`],
      [PAGE, `import { vehicles } from "@/db/schema";${use("vehicles")}`],
      [PAGE, `import { withTenant } from "@/db/tenant";${use("withTenant")}`],
      [
        COMPONENT,
        `import { vehicles } from "../../db/schema/vehicles";${use("vehicles")}`,
      ],
      [COMPONENT, `import { getDb } from "@/db/client";${use("getDb")}`],
    ])("falla en %s: %s", async (filePath, code) => {
      expect(await restrictedBy(filePath, code)).toContain(
        "no-restricted-imports",
      );
    });

    it.each([
      [
        PAGE,
        `import { getStockList } from "@/db/queries/vehicles";${use("getStockList")}`,
      ],
      [
        COMPONENT,
        `import { formatPrice, type StockVehicle } from "@/domains/vehicles/stock";\nexport type S = StockVehicle;${use("formatPrice")}`,
      ],
    ])("se permite en %s: %s", async (filePath, code) => {
      expect(await restrictedBy(filePath, code)).toEqual([]);
    });
  },
);

describe(
  "el loader de Stock no saltea withTenant()",
  { timeout: 30_000 },
  () => {
    it.each([
      [LOADER, `import { getDb } from "../client";${use("getDb")}`],
      [LOADER, `import { getDb } from "@/db/client";${use("getDb")}`],
      [LOADER, `export const db = () => import("../client");`],
      [LOADER, `import { withUser } from "../tenant";${use("withUser")}`],
      [
        LOADER,
        `import { resolveTenant } from "@/lib/tenant/resolution";${use("resolveTenant")}`,
      ],
    ])("falla en %s: %s", async (filePath, code) => {
      expect(await restrictedBy(filePath, code)).not.toEqual([]);
    });

    it("usa drizzle-orm, db/schema, withTenant() y requireTenant()", async () => {
      expect(
        await restrictedBy(
          LOADER,
          `import { asc } from "drizzle-orm";\nimport { requireTenant } from "@/lib/tenant/session";\nimport { vehicles } from "../schema";\nimport { withTenant } from "../tenant";${use("[asc, requireTenant, vehicles, withTenant]")}`,
        ),
      ).toEqual([]);
    });
  },
);
