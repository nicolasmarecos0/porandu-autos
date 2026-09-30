import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import ts from "typescript";
import { describe, expect, it } from "vitest";

/*
 * Fronteras de H0.6 y H0.7, verificadas sobre el código fuente con el AST de
 * TypeScript (los comentarios no cuentan):
 * - nada que llegue al navegador alcanza Supabase, cookies de servidor,
 *   credenciales ni db/;
 * - la autorización server-side usa getClaims(), nunca getSession();
 * - ninguna credencial privilegiada se referencia, y la aplicación no importa
 *   el tooling de staging (scripts/), que sí maneja la secret key y la
 *   credencial de migración;
 * - el proxy y la autenticación no dependen de Postgres;
 * - db/client solo lo importa db/tenant.ts, withUser() solo lo llama la
 *   query de memberships propias y resolveTenant() solo requireTenant().
 * Next además falla el build si un Client Component importa un módulo con
 * `import "server-only"`.
 */

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const SOURCE_DIRS = ["app", "components", "lib", "db", "domains", "mocks"];
const SOURCE_FILES = ["proxy.ts"];

type ModuleInfo = {
  path: string;
  directive: "use client" | "use server" | null;
  /** Imports con valor en runtime (los `import type` se eliden). */
  imports: string[];
  source: ts.SourceFile;
};

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) return walk(path);
    return /\.tsx?$/.test(entry) ? [path] : [];
  });
}

const files = [
  ...SOURCE_DIRS.flatMap((dir) => walk(join(ROOT, dir))),
  ...SOURCE_FILES.map((file) => join(ROOT, file)),
];

function isTypeOnly(node: ts.ImportDeclaration | ts.ExportDeclaration) {
  if (ts.isExportDeclaration(node)) return node.isTypeOnly;
  const clause = node.importClause;
  if (!clause) return false;
  if (clause.isTypeOnly) return true;
  const bindings = clause.namedBindings;
  return (
    !clause.name &&
    bindings !== undefined &&
    ts.isNamedImports(bindings) &&
    bindings.elements.length > 0 &&
    bindings.elements.every((element) => element.isTypeOnly)
  );
}

function resolveImport(from: string, specifier: string): string {
  let base: string | null = null;
  if (specifier.startsWith("@/")) base = join(ROOT, specifier.slice(2));
  else if (specifier.startsWith(".")) base = resolve(dirname(from), specifier);
  if (base === null) return specifier; // paquete externo
  for (const candidate of [
    base,
    `${base}.ts`,
    `${base}.tsx`,
    join(base, "index.ts"),
    join(base, "index.tsx"),
  ]) {
    if (existsSync(candidate) && statSync(candidate).isFile()) {
      return candidate;
    }
  }
  return base;
}

function parse(path: string): ModuleInfo {
  const source = ts.createSourceFile(
    path,
    readFileSync(path, "utf8"),
    ts.ScriptTarget.Latest,
    true,
    path.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  const first = source.statements[0];
  const directive =
    first &&
    ts.isExpressionStatement(first) &&
    ts.isStringLiteral(first.expression) &&
    (first.expression.text === "use client" ||
      first.expression.text === "use server")
      ? first.expression.text
      : null;

  const imports: string[] = [];
  const visit = (node: ts.Node) => {
    if (
      (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
      node.moduleSpecifier &&
      ts.isStringLiteral(node.moduleSpecifier) &&
      !isTypeOnly(node)
    ) {
      imports.push(resolveImport(path, node.moduleSpecifier.text));
    } else if (
      ts.isCallExpression(node) &&
      node.expression.kind === ts.SyntaxKind.ImportKeyword &&
      node.arguments[0] &&
      ts.isStringLiteral(node.arguments[0])
    ) {
      imports.push(resolveImport(path, node.arguments[0].text));
    }
    ts.forEachChild(node, visit);
  };
  visit(source);

  return { path, directive, imports, source };
}

const modules = new Map(files.map((path) => [path, parse(path)]));

function rel(path: string): string {
  return path.startsWith(ROOT) ? relative(ROOT, path) : path;
}

/**
 * Módulos alcanzables en runtime desde `entry`. Con `stopAtServerActions`,
 * un módulo "use server" es una frontera: el cliente recibe una referencia a
 * la acción, no su código.
 */
function reachable(entry: string, stopAtServerActions: boolean): Set<string> {
  const seen = new Set<string>();
  const pending = [entry];
  while (pending.length > 0) {
    const current = pending.pop() as string;
    if (seen.has(current)) continue;
    seen.add(current);
    const info = modules.get(current);
    if (!info) continue; // paquete externo o archivo fuera del código fuente
    if (
      stopAtServerActions &&
      current !== entry &&
      info.directive === "use server"
    ) {
      continue;
    }
    pending.push(...info.imports);
  }
  return new Set([...seen].map(rel));
}

/** Llamadas `x.<method>(...)` en el código (no en comentarios). */
function methodCalls(info: ModuleInfo, method: string): number {
  let count = 0;
  const visit = (node: ts.Node) => {
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      node.expression.name.text === method
    ) {
      count += 1;
    }
    ts.forEachChild(node, visit);
  };
  visit(info.source);
  return count;
}

/** Llamadas directas `name(...)` en el código (no en comentarios). */
function functionCalls(info: ModuleInfo, name: string): number {
  let count = 0;
  const visit = (node: ts.Node) => {
    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === name
    ) {
      count += 1;
    }
    ts.forEachChild(node, visit);
  };
  visit(info.source);
  return count;
}

/** Identificadores, nombres de propiedad y strings del código. */
function codeTokens(info: ModuleInfo): string[] {
  const tokens: string[] = [];
  const visit = (node: ts.Node) => {
    if (ts.isIdentifier(node)) tokens.push(node.text);
    else if (ts.isStringLiteralLike(node)) tokens.push(node.text);
    else if (ts.isTemplateExpression(node)) tokens.push(node.getText());
    ts.forEachChild(node, visit);
  };
  visit(info.source);
  return tokens;
}

const SERVER_ONLY_TARGETS = [
  /^server-only$/,
  /^@supabase\//,
  /^next\/headers$/,
  /^postgres$/,
  /^drizzle-orm/,
  /^db\//,
  /^lib\/supabase\//,
  /^lib\/auth\/session\.ts$/,
  /^lib\/tenant\/session\.ts$/,
  /^lib\/tenant\/cookie\.ts$/,
  /^lib\/env\.server\.ts$/,
];

const clientModules = [...modules.values()].filter(
  (info) => info.directive === "use client",
);

describe("frontera cliente / servidor", () => {
  it("encuentra los Client Components, incluido el formulario de login", () => {
    expect(clientModules.map((info) => rel(info.path))).toContain(
      "components/auth/login-form.tsx",
    );
  });

  it.each(clientModules.map((info) => [rel(info.path), info.path]))(
    "%s no alcanza Supabase, cookies de servidor, credenciales ni db/",
    (_, path) => {
      const leaked = [...reachable(path, true)].filter((target) =>
        SERVER_ONLY_TARGETS.some((pattern) => pattern.test(target)),
      );
      expect(leaked).toEqual([]);
    },
  );

  it("encuentra el selector de organización", () => {
    expect(clientModules.map((info) => rel(info.path))).toContain(
      "components/tenant/organization-picker.tsx",
    );
  });

  it("el selector llega al servidor solo como referencia a una Server Action", () => {
    const picker = modules.get(
      join(ROOT, "components/tenant/organization-picker.tsx"),
    );
    const actions = modules.get(join(ROOT, "lib/tenant/actions.ts"));
    expect(picker?.imports).toContain(join(ROOT, "lib/tenant/actions.ts"));
    expect(actions?.directive).toBe("use server");
  });

  it("el login llega al servidor solo como referencia a una Server Action", () => {
    const form = modules.get(join(ROOT, "components/auth/login-form.tsx"));
    const actions = modules.get(join(ROOT, "lib/auth/actions.ts"));
    expect(form?.imports).toContain(join(ROOT, "lib/auth/actions.ts"));
    expect(actions?.directive).toBe("use server");
  });

  it.each([
    "lib/supabase/server.ts",
    "lib/supabase/proxy.ts",
    "lib/auth/session.ts",
    "lib/env.server.ts",
    "lib/tenant/session.ts",
    "lib/tenant/cookie.ts",
    "db/client.ts",
    "db/tenant.ts",
    "db/queries/memberships.ts",
  ])("%s es server-only", (path) => {
    expect(modules.get(join(ROOT, path))?.imports).toContain("server-only");
  });

  it("@supabase/* solo se importa en lib/supabase/", () => {
    for (const info of modules.values()) {
      const supabaseImports = info.imports.filter((target) =>
        target.startsWith("@supabase/"),
      );
      if (supabaseImports.length > 0) {
        expect(rel(info.path)).toMatch(/^lib\/supabase\//);
      }
    }
  });

  it("no existe un cliente de Supabase para el navegador", () => {
    for (const info of modules.values()) {
      expect(codeTokens(info)).not.toContain("createBrowserClient");
    }
  });
});

describe("autorización con claims verificados", () => {
  it("ningún código llama a getSession() ni a getUser()", () => {
    for (const info of modules.values()) {
      expect([rel(info.path), methodCalls(info, "getSession")]).toEqual([
        rel(info.path),
        0,
      ]);
      expect([rel(info.path), methodCalls(info, "getUser")]).toEqual([
        rel(info.path),
        0,
      ]);
    }
  });

  it("getClaims() se llama en un único lugar: la verificación de lib/auth/claims.ts", () => {
    const callers = [...modules.values()]
      .filter((info) => methodCalls(info, "getClaims") > 0)
      .map((info) => rel(info.path));
    expect(callers).toEqual(["lib/auth/claims.ts"]);
  });
});

describe("credenciales", () => {
  it("ninguna credencial privilegiada de Supabase se referencia", () => {
    for (const info of modules.values()) {
      const privileged = codeTokens(info).filter((token) =>
        /service_role|secret_key|sb_secret_/i.test(token),
      );
      expect([rel(info.path), privileged]).toEqual([rel(info.path), []]);
    }
  });

  it("ningún módulo de la aplicación importa el tooling de staging (scripts/)", () => {
    for (const info of modules.values()) {
      const tooling = info.imports
        .map(rel)
        .filter((target) => target.startsWith("scripts/"));
      expect([rel(info.path), tooling]).toEqual([rel(info.path), []]);
    }
  });

  it("solo NEXT_PUBLIC_SUPABASE_URL y la publishable key son públicas", () => {
    const publicVars = new Set(
      [...modules.values()].flatMap((info) =>
        codeTokens(info).filter((token) => /^NEXT_PUBLIC_\w+$/.test(token)),
      ),
    );
    expect([...publicVars].sort()).toEqual([
      "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
      "NEXT_PUBLIC_SUPABASE_URL",
    ]);
  });

  it.each([
    "proxy.ts",
    "lib/auth/actions.ts",
    "lib/auth/session.ts",
    "lib/supabase/server.ts",
  ])(
    "%s no depende de Postgres ni de credenciales de base de datos",
    (entry) => {
      const targets = [...reachable(join(ROOT, entry), false)];
      const database = targets.filter((target) =>
        /^(db\/|postgres$|drizzle-orm|lib\/env\.server\.ts$)/.test(target),
      );
      expect(database).toEqual([]);
    },
  );
});

describe("Tenant Resolution (H0.7)", () => {
  function importersOf(target: string): string[] {
    return [...modules.values()]
      .filter((info) => info.imports.includes(join(ROOT, target)))
      .map((info) => rel(info.path));
  }

  function callersOf(name: string): string[] {
    return [...modules.values()]
      .filter((info) => functionCalls(info, name) > 0)
      .map((info) => rel(info.path));
  }

  it("db/client solo lo importa db/tenant.ts: no hay bypass del boundary", () => {
    expect(importersOf("db/client.ts")).toEqual(["db/tenant.ts"]);
  });

  it("withUser() solo lo llama la query de memberships propias", () => {
    expect(callersOf("withUser")).toEqual(["db/queries/memberships.ts"]);
  });

  it("resolveTenant() (el único que emite TenantContext) solo lo llama requireTenant()", () => {
    expect(callersOf("resolveTenant")).toEqual(["lib/tenant/session.ts"]);
  });

  it("la cookie de organización solo se escribe en el selector y se borra en el logout", () => {
    expect(callersOf("writeActiveOrganization")).toEqual([
      "lib/tenant/actions.ts",
    ]);
    expect(callersOf("clearActiveOrganization")).toEqual([
      "lib/auth/actions.ts",
    ]);
  });

  it("el área (app) está detrás de requireTenant()", () => {
    const layout = modules.get(join(ROOT, "app/(app)/layout.tsx"));
    expect(layout && functionCalls(layout, "requireTenant")).toBe(1);
  });
});
