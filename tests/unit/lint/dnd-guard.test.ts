import { fileURLToPath } from "node:url";

import { ESLint } from "eslint";
import { describe, expect, it } from "vitest";

/*
 * Guarda de ESLint del arrastre (propuesta DEC-048): @dnd-kit solo lo
 * importa el tablero del embudo (components/pipeline/). Ni el resto de la
 * UI, ni el dominio, ni el servidor: las reglas de movimiento son la
 * máquina de DEC-032. El tablero sigue sin conocer Drizzle ni el boundary.
 */

const eslint = new ESLint({
  cwd: fileURLToPath(new URL("../../../", import.meta.url)),
});

async function restrictedBy(filePath: string, code: string) {
  const [result] = await eslint.lintText(code, { filePath });
  return (result?.messages ?? [])
    .filter((m) => m.ruleId === "no-restricted-imports")
    .map((m) => m.message);
}

const IMPORT =
  'import { useDraggable } from "@dnd-kit/core";\nexport { useDraggable };\n';
const OTHER_PACKAGE =
  'import { CSS } from "@dnd-kit/utilities";\nexport { CSS };\n';

describe("guarda de @dnd-kit", () => {
  it.each([
    "components/pipeline/pipeline-board.tsx",
    "components/pipeline/pipeline-card.tsx",
    "components/pipeline/pipeline-column.tsx",
  ])("%s lo puede importar", async (filePath) => {
    expect(await restrictedBy(filePath, IMPORT)).toEqual([]);
  });

  it.each([
    "components/opportunities/opportunities-view.tsx",
    "components/calendar/week-grid.tsx",
    "app/(app)/opportunities/pipeline/page.tsx",
    "domains/opportunities/pipeline-moves.ts",
    "lib/opportunities/paths.ts",
    "db/queries/pipeline.ts",
  ])("%s no lo puede importar", async (filePath) => {
    for (const code of [IMPORT, OTHER_PACKAGE]) {
      const messages = await restrictedBy(filePath, code);
      expect(messages.join("\n")).toMatch(/components\/pipeline\//);
    }
  });

  it("el tablero sigue sin acceso directo a Drizzle ni al boundary", async () => {
    const messages = await restrictedBy(
      "components/pipeline/pipeline-board.tsx",
      'import { eq } from "drizzle-orm";\nexport { eq };\n',
    );
    expect(messages.join("\n")).toMatch(/loaders in db\/queries/);
  });
});
