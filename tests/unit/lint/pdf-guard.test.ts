import { fileURLToPath } from "node:url";

import { ESLint } from "eslint";
import { describe, expect, it } from "vitest";

/*
 * Guarda de ESLint del generador de PDF (Hito 14, DEC-046 §4): pdf-lib
 * solo lo importa lib/quotes/pdf.ts (server-only). Ni la UI, ni el dominio,
 * ni otro módulo de lib/ o db/: el PDF se genera en el servidor, desde la
 * base, y la librería no llega al bundle del navegador.
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
  'import { PDFDocument } from "pdf-lib";\nexport { PDFDocument };\n';
const SUBPATH =
  'import { rgb } from "pdf-lib/cjs/api/colors";\nexport { rgb };\n';

describe("guarda de pdf-lib", () => {
  it("el generador del presupuesto lo puede importar", async () => {
    expect(await restrictedBy("lib/quotes/pdf.ts", IMPORT)).toEqual([]);
  });

  it.each([
    "components/quotes/download-quote-pdf.tsx",
    "app/api/quotes/[quoteId]/pdf/route.ts",
    "domains/quotes/document.ts",
    "lib/quotes/pdf-download.ts",
    "lib/pdf/text.ts",
    "db/queries/quote-document.ts",
  ])("%s no lo puede importar", async (filePath) => {
    for (const code of [IMPORT, SUBPATH]) {
      const messages = await restrictedBy(filePath, code);
      expect(messages.join("\n")).toMatch(/lib\/quotes\/pdf\.ts/);
    }
  });
});
