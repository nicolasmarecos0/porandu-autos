/*
 * Resume los resultados del spike (vitest.json + JSON del harness) en Markdown.
 * Lo usa el workflow de E1: `node spikes/adr-001/scripts/summarize.mts`.
 * Solo builtins de Node y sintaxis TS borrable (Node 24 ejecuta TS directo).
 */
import { appendFileSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

type Assertion = {
  fullName: string;
  status: string;
  failureMessages?: string[];
};
type VitestJson = {
  numTotalTests: number;
  numPassedTests: number;
  numFailedTests: number;
  numPendingTests: number;
  testResults: { name: string; assertionResults: Assertion[] }[];
};

const dir = process.env.SPIKE_RESULTS_DIR ?? "";
const lines: string[] = [];

function readJson<T>(file: string): T | undefined {
  const path = join(dir, file);
  if (!existsSync(path)) return undefined;
  return JSON.parse(readFileSync(path, "utf8")) as T;
}

const target = readJson<{ target?: string }>("meta.json")?.target ?? "?";
lines.push(`# Spike ADR-001 · resultados ${target.toUpperCase()}`, "");

const vitest = readJson<VitestJson>("vitest.json");
if (vitest) {
  lines.push(
    `**Tests:** ${vitest.numPassedTests} pass · ${vitest.numFailedTests} fail · ${vitest.numPendingTests} skip · ${vitest.numTotalTests} total`,
    "",
    "| Estado | Test |",
    "|---|---|",
  );
  for (const file of vitest.testResults) {
    for (const a of file.assertionResults) {
      const icon =
        a.status === "passed"
          ? "PASS"
          : a.status === "failed"
            ? "FAIL"
            : a.status.toUpperCase();
      lines.push(`| ${icon} | ${a.fullName.replaceAll("|", "\\|")} |`);
    }
  }
  const failures = vitest.testResults.flatMap((f) =>
    f.assertionResults.filter((a) => a.status === "failed"),
  );
  if (failures.length > 0) {
    lines.push("", "## Fallas", "");
    for (const f of failures) {
      lines.push(
        `### ${f.fullName}`,
        "",
        "```",
        (f.failureMessages ?? []).join("\n").slice(0, 3000),
        "```",
        "",
      );
    }
  }
} else {
  lines.push("_No hay vitest.json (los tests no llegaron a correr)._");
}

for (const file of [
  "meta.json",
  "leak-directa.json",
  "leak-pooler.json",
  "latency.json",
  "negative-control-pooler.json",
]) {
  const data = readJson<unknown>(file);
  if (data !== undefined) {
    lines.push(
      "",
      `## ${file}`,
      "",
      "```json",
      JSON.stringify(data, null, 2),
      "```",
    );
  }
}

const dataApi = readJson<
  {
    path: string;
    principal: string;
    method: string;
    headers: Record<string, string>;
    status: number;
    body: unknown;
  }[]
>("data-api.json");
if (dataApi) {
  lines.push(
    "",
    "## data-api.json (resumen)",
    "",
    "| Principal | Método | Path | Headers | Status | Respuesta |",
    "|---|---|---|---|---|---|",
  );
  for (const o of dataApi) {
    const body = JSON.stringify(o.body).slice(0, 140).replaceAll("|", "\\|");
    lines.push(
      `| ${o.principal} | ${o.method} | ${o.path} | ${JSON.stringify(o.headers).replaceAll("|", "\\|")} | ${o.status} | ${body} |`,
    );
  }
}

const markdown = `${lines.join("\n")}\n`;
process.stdout.write(markdown);
if (process.env.GITHUB_STEP_SUMMARY)
  appendFileSync(process.env.GITHUB_STEP_SUMMARY, markdown);
