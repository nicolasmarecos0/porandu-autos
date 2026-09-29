import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { parseMigrationDatabaseUrl } from "@/db/migration-env";
import { EnvValidationError } from "@/lib/env";

/*
 * Valores ficticios: ninguno corresponde a un entorno real. Cargar la
 * configuración de drizzle-kit no abre conexiones.
 */
const RUNTIME_URL =
  "postgresql://app_runtime.testref:runtime-secret@runtime.example.test:6543/postgres";
const MIGRATION_URL =
  "postgresql://postgres.testref:migration-secret@migration.example.test:5432/postgres";

function issuesOf(fn: () => unknown): readonly string[] {
  try {
    fn();
  } catch (error) {
    if (error instanceof EnvValidationError) return error.issues;
    throw error;
  }
  throw new Error("expected EnvValidationError");
}

describe("parseMigrationDatabaseUrl", () => {
  it.each([
    MIGRATION_URL,
    "postgres://postgres:postgres@127.0.0.1:54322/postgres",
  ])("acepta una URL postgres:// con rol postgres (%s)", (url) => {
    expect(parseMigrationDatabaseUrl(url)).toBe(url);
  });

  it.each([undefined, "", "   "])("exige la variable (%j)", (value) => {
    expect(issuesOf(() => parseMigrationDatabaseUrl(value))).toEqual([
      "MIGRATION_DATABASE_URL is required.",
    ]);
  });

  it.each(["not a url", "https://postgres@example.test/postgres"])(
    "rechaza lo que no es una URL postgres:// (%s)",
    (value) => {
      expect(issuesOf(() => parseMigrationDatabaseUrl(value))).toEqual([
        "MIGRATION_DATABASE_URL must be a postgres:// URL.",
      ]);
    },
  );

  it("rechaza la credencial de runtime sin exponer su valor", () => {
    const issues = issuesOf(() => parseMigrationDatabaseUrl(RUNTIME_URL));
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatch(/must connect as postgres/);
    expect(issues[0]).not.toContain("runtime-secret");
  });
});

describe("drizzle.config.ts", () => {
  async function loadConfig() {
    vi.resetModules();
    return (await import("@/drizzle.config")).default;
  }

  beforeEach(() => {
    vi.stubEnv("RUNTIME_DATABASE_URL", undefined);
    vi.stubEnv("MIGRATION_DATABASE_URL", undefined);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("usa MIGRATION_DATABASE_URL aunque exista la de runtime", async () => {
    vi.stubEnv("RUNTIME_DATABASE_URL", RUNTIME_URL);
    vi.stubEnv("MIGRATION_DATABASE_URL", MIGRATION_URL);

    expect(await loadConfig()).toMatchObject({
      dialect: "postgresql",
      schema: "./db/schema/index.ts",
      out: "./db/migrations",
      dbCredentials: { url: MIGRATION_URL },
    });
  });

  it("no cae en RUNTIME_DATABASE_URL si falta la de migración", async () => {
    vi.stubEnv("RUNTIME_DATABASE_URL", RUNTIME_URL);

    await expect(loadConfig()).rejects.toThrow(
      "MIGRATION_DATABASE_URL is required.",
    );
  });

  it("rechaza la credencial de runtime usada como credencial de migración", async () => {
    vi.stubEnv("MIGRATION_DATABASE_URL", RUNTIME_URL);

    await expect(loadConfig()).rejects.toThrow(/must connect as postgres/);
  });
});
