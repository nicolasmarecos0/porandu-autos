import { appendFileSync } from "node:fs";

/*
 * Resultado de cada verificación del tooling de staging. `detail` nunca
 * lleva secretos: solo versiones, nombres de objetos, contadores y códigos.
 */

export type Finding = Readonly<{
  check: string;
  ok: boolean;
  detail: string;
}>;

export function finding(check: string, ok: boolean, detail: string): Finding {
  return { check, ok, detail };
}

export function failed(findings: readonly Finding[]): Finding[] {
  return findings.filter((f) => !f.ok);
}

export function formatFindings(findings: readonly Finding[]): string {
  return findings
    .map((f) => `${f.ok ? "✓" : "✗"} ${f.check} — ${f.detail}`)
    .join("\n");
}

/** Resumen del job en GitHub Actions (si corre ahí). */
export function writeSummary(
  title: string,
  findings: readonly Finding[],
): void {
  const path = process.env.GITHUB_STEP_SUMMARY;
  if (!path) return;
  const escape = (text: string) =>
    text.replaceAll("|", "\\|").replaceAll("\n", " ");
  const rows = findings.map(
    (f) =>
      `| ${f.ok ? "✅" : "❌"} | \`${escape(f.check)}\` | ${escape(f.detail)} |`,
  );
  appendFileSync(
    path,
    [
      `### ${title}`,
      "",
      "| | Check | Detalle |",
      "|---|---|---|",
      ...rows,
      "",
      "",
    ].join("\n"),
  );
}
