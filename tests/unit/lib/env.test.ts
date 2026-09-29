import { describe, expect, it } from "vitest";

import { EnvValidationError, parsePublicEnv, parseServerEnv } from "@/lib/env";

/*
 * Valores ficticios: ninguno corresponde a un entorno real.
 */
const PUBLIC_OK = {
  NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321",
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_test",
};

function issuesOf(fn: () => unknown): readonly string[] {
  try {
    fn();
  } catch (error) {
    if (error instanceof EnvValidationError) return error.issues;
    throw error;
  }
  throw new Error("expected EnvValidationError");
}

describe("parsePublicEnv", () => {
  it("acepta URL y publishable key válidas", () => {
    expect(parsePublicEnv(PUBLIC_OK)).toEqual({
      supabaseUrl: "http://127.0.0.1:54321",
      supabasePublishableKey: "sb_publishable_test",
    });
  });

  it("exige ambas variables", () => {
    expect(issuesOf(() => parsePublicEnv({}))).toEqual([
      "NEXT_PUBLIC_SUPABASE_URL is required.",
      "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY is required.",
    ]);
  });

  it("rechaza una URL que no es http(s)", () => {
    expect(
      issuesOf(() =>
        parsePublicEnv({ ...PUBLIC_OK, NEXT_PUBLIC_SUPABASE_URL: "127.0.0.1" }),
      ),
    ).toEqual(["NEXT_PUBLIC_SUPABASE_URL must be an http(s) URL."]);
  });

  it.each(["sb_secret_test", "eyJhbGciOiJIUzI1NiJ9.e30.x"])(
    "rechaza una key que no es publishable (%s)",
    (key) => {
      const issues = issuesOf(() =>
        parsePublicEnv({
          ...PUBLIC_OK,
          NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: key,
        }),
      );
      expect(issues).toHaveLength(1);
      expect(issues[0]).toMatch(/publishable key/);
      expect(issues[0]).not.toContain(key);
    },
  );
});

describe("parseServerEnv", () => {
  it.each([
    "postgresql://app_runtime:pw@127.0.0.1:54322/postgres",
    "postgres://app_runtime.projectref:pw@pooler.example.com:6543/postgres",
  ])("acepta app_runtime (%s)", (url) => {
    expect(parseServerEnv({ RUNTIME_DATABASE_URL: url })).toEqual({
      runtimeDatabaseUrl: url,
    });
  });

  it("exige RUNTIME_DATABASE_URL", () => {
    expect(issuesOf(() => parseServerEnv({}))).toEqual([
      "RUNTIME_DATABASE_URL is required.",
    ]);
  });

  it("no toma la URL de migración ni un DATABASE_URL genérico", () => {
    expect(
      issuesOf(() =>
        parseServerEnv({
          DATABASE_URL: "postgresql://app_runtime:pw@127.0.0.1:54322/postgres",
          MIGRATION_DATABASE_URL:
            "postgresql://postgres:pw@127.0.0.1:54322/postgres",
        }),
      ),
    ).toEqual(["RUNTIME_DATABASE_URL is required."]);
  });

  it.each([
    "postgresql://postgres:secret-pw@127.0.0.1:54322/postgres",
    "postgresql://postgres.projectref:secret-pw@pooler.example.com:5432/postgres",
    "postgresql://app_runtime_admin:secret-pw@127.0.0.1:54322/postgres",
  ])(
    "rechaza un rol distinto de app_runtime sin exponer la URL (%s)",
    (url) => {
      const issues = issuesOf(() =>
        parseServerEnv({ RUNTIME_DATABASE_URL: url }),
      );
      expect(issues).toHaveLength(1);
      expect(issues[0]).toMatch(/must connect as app_runtime/);
      expect(issues[0]).not.toContain("secret-pw");
    },
  );

  it("rechaza una URL que no es postgres", () => {
    expect(
      issuesOf(() =>
        parseServerEnv({ RUNTIME_DATABASE_URL: "https://example.com" }),
      ),
    ).toEqual(["RUNTIME_DATABASE_URL must be a postgres:// URL."]);
  });
});
