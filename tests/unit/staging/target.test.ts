import { describe, expect, it } from "vitest";

import { parseServerEnv } from "@/lib/env";

import { parseMigrationDatabaseUrl } from "../../../db/migration-env";
import {
  maskSecrets,
  migrationDatabaseUrl,
  parseStagingTarget,
  readMigrationPassword,
  readRuntimePassword,
  redact,
  runtimeDatabaseUrl,
  StagingConfigError,
} from "../../../scripts/staging/target.mts";

/*
 * Destino del workflow Staging DB (scripts/staging/target.mts): el project
 * ref tiene que coincidir en las cuatro fuentes, el pooler tiene que ser el
 * de Supabase en sa-east-1 y ningún error incluye un valor. Valores
 * ficticios.
 */

const REF = "abcdefghijklmnopqrst";
const OTHER = "zyxwvutsrqponmlkjihg";
const POOLER = `postgresql://postgres.${REF}:[YOUR-PASSWORD]@aws-1-sa-east-1.pooler.supabase.com:5432/postgres`;
const DB_PASSWORD = "p@ss/w:rd#?&=% 1";
const RUNTIME_PASSWORD = "a".repeat(8) + "0123456789abcdef0123456789abcdef";

const VALID = {
  STAGING_PROJECT_REF: REF,
  STAGING_CONFIRM_PROJECT_REF: REF,
  STAGING_SUPABASE_URL: `https://${REF}.supabase.co`,
  STAGING_SESSION_POOLER_URL: POOLER,
};

function issuesOf(fn: () => unknown): string[] {
  try {
    fn();
  } catch (error) {
    if (error instanceof StagingConfigError) return [...error.issues];
    throw error;
  }
  return [];
}

describe("parseStagingTarget", () => {
  it("acepta el proyecto de staging por el Session pooler de sa-east-1", () => {
    expect(parseStagingTarget(VALID)).toEqual({
      projectRef: REF,
      region: "sa-east-1",
      poolerHost: "aws-1-sa-east-1.pooler.supabase.com",
      database: "postgres",
      supabaseUrl: `https://${REF}.supabase.co`,
    });
    // Con barra final y con la password real en el string del pooler.
    expect(
      parseStagingTarget({
        ...VALID,
        STAGING_SUPABASE_URL: `https://${REF}.supabase.co/`,
        STAGING_SESSION_POOLER_URL: POOLER.replace(
          "[YOUR-PASSWORD]",
          DB_PASSWORD,
        ),
      }).supabaseUrl,
    ).toBe(`https://${REF}.supabase.co`);
  });

  it.each([
    [
      "falta la variable del environment",
      { STAGING_PROJECT_REF: undefined },
      "STAGING_PROJECT_REF is required.",
    ],
    [
      "la confirmación no coincide",
      { STAGING_CONFIRM_PROJECT_REF: OTHER },
      "STAGING_CONFIRM_PROJECT_REF (workflow input) does not match STAGING_PROJECT_REF.",
    ],
    [
      "falta la confirmación",
      { STAGING_CONFIRM_PROJECT_REF: "" },
      "STAGING_CONFIRM_PROJECT_REF is required.",
    ],
    [
      "la URL es de otro proyecto",
      { STAGING_SUPABASE_URL: `https://${OTHER}.supabase.co` },
      "STAGING_SUPABASE_URL does not belong to STAGING_PROJECT_REF.",
    ],
    [
      "la URL no es https://<ref>.supabase.co",
      { STAGING_SUPABASE_URL: `http://${REF}.supabase.co` },
      "STAGING_SUPABASE_URL must be https://<project_ref>.supabase.co.",
    ],
    [
      "el pooler es de otro proyecto",
      {
        STAGING_SESSION_POOLER_URL: POOLER.replace(
          `postgres.${REF}`,
          `postgres.${OTHER}`,
        ),
      },
      "STAGING_SESSION_POOLER_URL user must be postgres.<STAGING_PROJECT_REF>.",
    ],
    [
      "el pooler usa app_runtime",
      {
        STAGING_SESSION_POOLER_URL: POOLER.replace("postgres.", "app_runtime."),
      },
      "STAGING_SESSION_POOLER_URL user must be postgres.<STAGING_PROJECT_REF>.",
    ],
    [
      "otra región",
      { STAGING_SESSION_POOLER_URL: POOLER.replace("sa-east-1", "us-east-1") },
      "STAGING_SESSION_POOLER_URL must be in sa-east-1.",
    ],
    [
      "conexión directa en lugar del pooler",
      {
        STAGING_SESSION_POOLER_URL: `postgresql://postgres:[YOUR-PASSWORD]@db.${REF}.supabase.co:5432/postgres`,
      },
      "STAGING_SESSION_POOLER_URL user must be postgres.<STAGING_PROJECT_REF>.",
    ],
    [
      "Transaction pooler en lugar del Session pooler",
      { STAGING_SESSION_POOLER_URL: POOLER.replace(":5432/", ":6543/") },
      "STAGING_SESSION_POOLER_URL must use the Session pooler port 5432.",
    ],
    [
      "otra base",
      {
        STAGING_SESSION_POOLER_URL: POOLER.replace(
          ":5432/postgres",
          ":5432/other",
        ),
      },
      "STAGING_SESSION_POOLER_URL database must be postgres.",
    ],
  ])("rechaza: %s", (_, override, issue) => {
    expect(
      issuesOf(() => parseStagingTarget({ ...VALID, ...override })),
    ).toContain(issue);
  });

  it("los errores nombran variables, nunca valores", () => {
    const issues = issuesOf(() =>
      parseStagingTarget({
        STAGING_PROJECT_REF: REF,
        STAGING_CONFIRM_PROJECT_REF: OTHER,
        STAGING_SUPABASE_URL: `https://${OTHER}.supabase.co`,
        STAGING_SESSION_POOLER_URL: POOLER.replace(
          "[YOUR-PASSWORD]",
          DB_PASSWORD,
        ).replace("sa-east-1", "eu-west-1"),
      }),
    );
    expect(issues.length).toBeGreaterThan(0);
    const text = issues.join("\n");
    for (const value of [REF, OTHER, DB_PASSWORD, "eu-west-1"]) {
      expect(text).not.toContain(value);
    }
  });
});

describe("credenciales", () => {
  const target = parseStagingTarget(VALID);

  it("la de migración es postgres por el Session pooler, con la password codificada", () => {
    const url = new URL(migrationDatabaseUrl(target, DB_PASSWORD));
    expect(url.username).toBe(`postgres.${REF}`);
    expect(decodeURIComponent(url.password)).toBe(DB_PASSWORD);
    expect([url.hostname, url.port, url.pathname]).toEqual([
      "aws-1-sa-east-1.pooler.supabase.com",
      "5432",
      "/postgres",
    ]);
    expect(url.searchParams.get("sslmode")).toBe("require");
    // drizzle.config.ts la acepta como credencial de migración.
    expect(parseMigrationDatabaseUrl(url.toString())).toBe(url.toString());
  });

  it("la de runtime es app_runtime.<ref> por el Transaction pooler (6543)", () => {
    const raw = runtimeDatabaseUrl(target, RUNTIME_PASSWORD);
    const url = new URL(raw);
    expect(url.username).toBe(`app_runtime.${REF}`);
    expect(url.password).toBe(RUNTIME_PASSWORD);
    expect(url.port).toBe("6543");
    expect(url.searchParams.get("sslmode")).toBe("require");
    // El contrato de entorno del runtime la acepta; drizzle-kit no.
    expect(parseServerEnv({ RUNTIME_DATABASE_URL: raw })).toEqual({
      runtimeDatabaseUrl: raw,
    });
    expect(() => parseMigrationDatabaseUrl(raw)).toThrow(/postgres/);
  });

  it("la password de postgres no puede tener el placeholder", () => {
    expect(
      issuesOf(() =>
        readMigrationPassword({ STAGING_DB_PASSWORD: "[YOUR-PASSWORD]" }),
      ),
    ).toEqual([
      "STAGING_DB_PASSWORD still contains the [YOUR-PASSWORD] placeholder.",
    ]);
    expect(issuesOf(() => readMigrationPassword({}))).toEqual([
      "STAGING_DB_PASSWORD is required.",
    ]);
  });

  it.each([
    ["ausente", undefined, "STAGING_RUNTIME_DB_PASSWORD is required."],
    ["corta", "a".repeat(31), "must be 32–128 characters"],
    [
      "con caracteres que exigen codificación",
      `${"a".repeat(32)}@/`,
      "must be 32–128 characters",
    ],
  ])("la password de app_runtime se rechaza si está %s", (_, value, issue) => {
    expect(
      issuesOf(() =>
        readRuntimePassword({ STAGING_RUNTIME_DB_PASSWORD: value }),
      ).join(),
    ).toContain(issue);
  });

  it("la password de app_runtime nunca reutiliza la de postgres", () => {
    expect(
      issuesOf(() =>
        readRuntimePassword({
          STAGING_RUNTIME_DB_PASSWORD: RUNTIME_PASSWORD,
          STAGING_DB_PASSWORD: RUNTIME_PASSWORD,
        }),
      ),
    ).toEqual([
      "STAGING_RUNTIME_DB_PASSWORD must not reuse the postgres password (STAGING_DB_PASSWORD).",
    ]);
    expect(
      readRuntimePassword({
        STAGING_RUNTIME_DB_PASSWORD: RUNTIME_PASSWORD,
        STAGING_DB_PASSWORD: DB_PASSWORD,
      }),
    ).toBe(RUNTIME_PASSWORD);
  });
});

describe("salida sin secretos", () => {
  it("enmascara el valor literal y su forma URL-encoded", () => {
    const lines: string[] = [];
    maskSecrets([DB_PASSWORD, ""], (line) => lines.push(line));
    expect(lines.sort()).toEqual(
      [
        `::add-mask::${DB_PASSWORD}`,
        `::add-mask::${encodeURIComponent(DB_PASSWORD)}`,
      ].sort(),
    );
  });

  it("redact quita connection strings y secretos en cualquier forma", () => {
    const url = migrationDatabaseUrl(parseStagingTarget(VALID), DB_PASSWORD);
    const text = `failed: ${url}\npassword=${DB_PASSWORD} enc=${encodeURIComponent(DB_PASSWORD)}`;
    const clean = redact(text, [DB_PASSWORD]);
    expect(clean).not.toContain(DB_PASSWORD);
    expect(clean).not.toContain(encodeURIComponent(DB_PASSWORD));
    expect(clean).not.toContain("pooler.supabase.com");
    expect(clean).toContain("postgresql://***");
  });
});
