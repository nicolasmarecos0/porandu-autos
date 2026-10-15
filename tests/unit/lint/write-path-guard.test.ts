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
 * - la bitácora (db/queries/record-opportunity-note) y la unidad vinculada
 *   (db/queries/link-opportunity-vehicle) de una oportunidad (Hito 2),
 *   también: las Server Actions addOpportunityNote() y
 *   linkOpportunityVehicle() (lib/opportunities/actions.ts);
 * - el cambio de etapa de una oportunidad (H1.6)
 *   (db/queries/change-opportunity-stage), también: la Server Action
 *   changeOpportunityStage() (lib/opportunities/actions.ts);
 * - el cierre comercial con sus metadatos (DEC-034)
 *   (db/queries/close-opportunity), también: la Server Action
 *   closeOpportunity() (lib/opportunities/actions.ts);
 * - el registro de mensajes (Hito 4) (db/queries/record-message), también:
 *   la Server Action addMessage() (lib/conversations/actions.ts);
 * - la configuración y el equipo (Hito 6) (db/queries/settings-write),
 *   también: las Server Actions de lib/settings/actions.ts;
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

const importStageWrite = `import { transitionOpportunityStage } from "@/db/queries/change-opportunity-stage";\nexport const use = transitionOpportunityStage;\n`;

describe(
  "una sola puerta para el cambio de etapa de una oportunidad (H1.6)",
  { timeout: 30_000 },
  () => {
    it.each([
      "app/(app)/opportunities/page.tsx",
      "app/(app)/opportunities/[id]/page.tsx",
      "components/opportunities/opportunity-stage-panel.tsx",
      "components/opportunities/stage-close-dialog.tsx",
      "lib/opportunities/stage-change.ts",
      "lib/vehicles/actions.ts",
      "lib/tenant/session.ts",
      "db/queries/opportunities.ts",
      "db/queries/opportunity-detail.ts",
      "db/queries/create-opportunity.ts",
      "db/queries/demand-facts.ts",
      "db/queries/memberships.ts",
      "db/tenant.ts",
    ])("falla en %s", async (filePath) => {
      expect(await restrictedBy(filePath, importStageWrite)).toContain(
        "no-restricted-imports",
      );
    });

    it("también por ruta relativa dentro de db/queries", async () => {
      expect(
        await restrictedBy(
          "db/queries/opportunity-detail.ts",
          `import { transitionOpportunityStage } from "./change-opportunity-stage";\nexport const use = transitionOpportunityStage;\n`,
        ),
      ).toContain("no-restricted-imports");
    });

    it("se permite en la Server Action", async () => {
      expect(
        await restrictedBy("lib/opportunities/actions.ts", importStageWrite),
      ).toEqual([]);
    });

    it("los tipos del resultado sí se pueden importar (no escriben)", async () => {
      expect(
        await restrictedBy(
          "lib/opportunities/stage-change.ts",
          `import type { StageChangeOutcome } from "@/db/queries/change-opportunity-stage";\nexport type T = StageChangeOutcome;\n`,
        ),
      ).toEqual([]);
    });
  },
);

const importCloseWrite = `import { closeOpportunityWithMetadata } from "@/db/queries/close-opportunity";\nexport const use = closeOpportunityWithMetadata;\n`;

describe(
  "una sola puerta para el cierre comercial (DEC-034)",
  { timeout: 30_000 },
  () => {
    it.each([
      "app/(app)/opportunities/page.tsx",
      "app/(app)/opportunities/[id]/page.tsx",
      "components/opportunities/opportunity-stage-panel.tsx",
      "components/opportunities/stage-close-dialog.tsx",
      "components/opportunities/closure-fields.tsx",
      "components/opportunities/closure-summary.tsx",
      "domains/opportunities/closure.ts",
      "lib/opportunities/closure.ts",
      "lib/opportunities/stage-change.ts",
      "lib/vehicles/actions.ts",
      "lib/tenant/session.ts",
      "lib/contacts/phone.ts",
      "db/queries/opportunities.ts",
      "db/queries/opportunity-detail.ts",
      "db/queries/change-opportunity-stage.ts",
      "db/queries/link-opportunity-vehicle.ts",
      "db/queries/create-opportunity.ts",
      "db/queries/memberships.ts",
      "db/tenant.ts",
    ])("falla en %s", async (filePath) => {
      expect(await restrictedBy(filePath, importCloseWrite)).toContain(
        "no-restricted-imports",
      );
    });

    it("también por ruta relativa dentro de db/queries", async () => {
      expect(
        await restrictedBy(
          "db/queries/change-opportunity-stage.ts",
          `import { closeOpportunityWithMetadata } from "./close-opportunity";\nexport const use = closeOpportunityWithMetadata;\n`,
        ),
      ).toContain("no-restricted-imports");
    });

    it("se permite en la Server Action", async () => {
      expect(
        await restrictedBy("lib/opportunities/actions.ts", importCloseWrite),
      ).toEqual([]);
    });

    it("los tipos del resultado sí se pueden importar (no escriben)", async () => {
      expect(
        await restrictedBy(
          "lib/opportunities/closure.ts",
          `import type { CloseOpportunityOutcome } from "@/db/queries/close-opportunity";\nexport type T = CloseOpportunityOutcome;\n`,
        ),
      ).toEqual([]);
    });

    it("db/queries/close-opportunity.ts no importa db/client, withUser() ni resolveTenant()", async () => {
      for (const code of [
        `import { getDb } from "../client";\nexport const use = getDb;\n`,
        `import { getDb } from "@/db/client";\nexport const use = getDb;\n`,
        `export const use = () => import("../client");\n`,
        `import { withUser } from "../tenant";\nexport const use = withUser;\n`,
        `import { resolveTenant } from "@/lib/tenant/resolution";\nexport const use = resolveTenant;\n`,
      ]) {
        expect(
          await restrictedBy("db/queries/close-opportunity.ts", code),
        ).not.toEqual([]);
      }
    });
  },
);

/*
 * Hito 2 (DEC-033 §4): la bitácora y la unidad vinculada tienen cada una un
 * único módulo de escritura, que solo importa su Server Action
 * (lib/opportunities/actions.ts).
 */
const HITO_2_WRITES = [
  {
    name: "el alta de notas",
    module: "record-opportunity-note",
    fn: "insertOpportunityNote",
    type: "NoteWriteOutcome",
  },
  {
    name: "la unidad vinculada",
    module: "link-opportunity-vehicle",
    fn: "setOpportunityVehicle",
    type: "VehicleLinkOutcome",
  },
] as const;

describe.each(HITO_2_WRITES)(
  "una sola puerta para $name (Hito 2)",
  { timeout: 30_000 },
  ({ module, fn, type }) => {
    const importWrite = `import { ${fn} } from "@/db/queries/${module}";\nexport const use = ${fn};\n`;

    it.each([
      "app/(app)/opportunities/page.tsx",
      "app/(app)/opportunities/[id]/page.tsx",
      "components/opportunities/opportunity-detail.tsx",
      "components/opportunities/note-form.tsx",
      "components/opportunities/vehicle-link.tsx",
      "lib/opportunities/note.ts",
      "lib/opportunities/vehicle-link.ts",
      "lib/vehicles/actions.ts",
      "lib/tenant/session.ts",
      "lib/contacts/phone.ts",
      "db/queries/opportunities.ts",
      "db/queries/opportunity-detail.ts",
      "db/queries/opportunity-notes.ts",
      "db/queries/vehicles.ts",
      "db/queries/change-opportunity-stage.ts",
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
          "db/queries/opportunity-detail.ts",
          `import { ${fn} } from "./${module}";\nexport const use = ${fn};\n`,
        ),
      ).toContain("no-restricted-imports");
    });

    it("se permite en la Server Action", async () => {
      expect(
        await restrictedBy("lib/opportunities/actions.ts", importWrite),
      ).toEqual([]);
    });

    it("los tipos del resultado sí se pueden importar (no escriben)", async () => {
      expect(
        await restrictedBy(
          "lib/opportunities/note.ts",
          `import type { ${type} } from "@/db/queries/${module}";\nexport type T = ${type};\n`,
        ),
      ).toEqual([]);
    });
  },
);

const importMessageWrite = `import { insertOpportunityMessage } from "@/db/queries/record-message";\nexport const use = insertOpportunityMessage;\n`;

/*
 * Hito 4 (DEC-036 §6): los mensajes tienen un único módulo de escritura,
 * que solo importa su Server Action (lib/conversations/actions.ts).
 */
describe(
  "una sola puerta para el registro de mensajes (Hito 4)",
  { timeout: 30_000 },
  () => {
    it.each([
      "app/(app)/opportunities/[id]/page.tsx",
      "components/opportunities/opportunity-detail.tsx",
      "components/conversations/message-form.tsx",
      "lib/conversations/message.ts",
      "lib/opportunities/actions.ts",
      "lib/vehicles/actions.ts",
      "lib/tenant/session.ts",
      "lib/contacts/phone.ts",
      "db/queries/opportunity-detail.ts",
      "db/queries/messages.ts",
      "db/queries/record-opportunity-note.ts",
      "db/queries/memberships.ts",
      "db/tenant.ts",
    ])("falla en %s", async (filePath) => {
      expect(await restrictedBy(filePath, importMessageWrite)).toContain(
        "no-restricted-imports",
      );
    });

    it("también por ruta relativa dentro de db/queries", async () => {
      expect(
        await restrictedBy(
          "db/queries/opportunity-detail.ts",
          `import { insertOpportunityMessage } from "./record-message";\nexport const use = insertOpportunityMessage;\n`,
        ),
      ).toContain("no-restricted-imports");
    });

    it("se permite en la Server Action", async () => {
      expect(
        await restrictedBy("lib/conversations/actions.ts", importMessageWrite),
      ).toEqual([]);
    });

    it("la Server Action de mensajes no importa otras escrituras ni el cliente", async () => {
      for (const code of [
        importWrite,
        `import { insertOpportunityNote } from "@/db/queries/record-opportunity-note";\nexport const use = insertOpportunityNote;\n`,
        `import { getDb } from "@/db/client";\nexport const use = getDb;\n`,
      ]) {
        expect(
          await restrictedBy("lib/conversations/actions.ts", code),
        ).toContain("no-restricted-imports");
      }
    });

    it("los tipos del resultado sí se pueden importar (no escriben)", async () => {
      expect(
        await restrictedBy(
          "lib/conversations/message.ts",
          `import type { MessageWriteOutcome } from "@/db/queries/record-message";\nexport type T = MessageWriteOutcome;\n`,
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

const importSettingsWrite = `import { inviteMemberByEmail } from "@/db/queries/settings-write";\nexport const use = inviteMemberByEmail;\n`;

describe(
  "una sola puerta para la configuración y el equipo (Hito 6)",
  { timeout: 30_000 },
  () => {
    it.each([
      "app/(app)/settings/page.tsx",
      "app/(app)/settings/team/page.tsx",
      "components/settings/team-panel.tsx",
      "lib/settings/requests.ts",
      "lib/opportunities/actions.ts",
      "lib/vehicles/actions.ts",
      "lib/conversations/actions.ts",
      "lib/tenant/session.ts",
      "db/queries/settings.ts",
      "db/queries/memberships.ts",
      "db/tenant.ts",
    ])("falla en %s", async (filePath) => {
      expect(await restrictedBy(filePath, importSettingsWrite)).toContain(
        "no-restricted-imports",
      );
    });

    it("también por ruta relativa dentro de db/queries", async () => {
      expect(
        await restrictedBy(
          "db/queries/settings.ts",
          `import { inviteMemberByEmail } from "./settings-write";\nexport const use = inviteMemberByEmail;\n`,
        ),
      ).toContain("no-restricted-imports");
    });

    it("se permite en las Server Actions de lib/settings/actions.ts", async () => {
      expect(
        await restrictedBy("lib/settings/actions.ts", importSettingsWrite),
      ).toEqual([]);
    });

    it("los tipos de los resultados sí se pueden importar (no escriben)", async () => {
      expect(
        await restrictedBy(
          "lib/settings/requests.ts",
          `import type { InviteOutcome } from "@/db/queries/settings-write";\nexport type I = InviteOutcome;\n`,
        ),
      ).toEqual([]);
    });
  },
);
