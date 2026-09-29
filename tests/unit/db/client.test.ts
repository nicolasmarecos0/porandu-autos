import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// `server-only` lo resuelve Next; en Vitest (entorno node) es un no-op.
vi.mock("server-only", () => ({}));

/*
 * Valores ficticios: ninguno corresponde a un entorno real. postgres-js no
 * conecta hasta la primera query, y estos tests no ejecutan ninguna.
 */
const RUNTIME_URL =
  "postgresql://app_runtime.testref:runtime-secret@runtime.example.test:6543/postgres";
const MIGRATION_URL =
  "postgresql://postgres.testref:migration-secret@migration.example.test:5432/postgres";

async function loadClient() {
  vi.resetModules();
  return import("@/db/client");
}

beforeEach(() => {
  vi.stubEnv("RUNTIME_DATABASE_URL", undefined);
  vi.stubEnv("MIGRATION_DATABASE_URL", undefined);
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("db/client", () => {
  it("importar el módulo no lee el entorno ni abre conexiones", async () => {
    await expect(loadClient()).resolves.toHaveProperty("getDb");
  });

  it("se conecta con RUNTIME_DATABASE_URL aunque exista la de migración", async () => {
    vi.stubEnv("RUNTIME_DATABASE_URL", RUNTIME_URL);
    vi.stubEnv("MIGRATION_DATABASE_URL", MIGRATION_URL);

    const { getDb } = await loadClient();
    const client = getDb().$client;

    try {
      expect(client.options.host).toEqual(["runtime.example.test"]);
      expect(client.options.port).toEqual([6543]);
      expect(client.options.user).toBe("app_runtime.testref");
      expect(client.options.host).not.toContain("migration.example.test");
    } finally {
      await client.end();
    }
  });

  it("desactiva los prepared statements con nombre (Supavisor, modo transacción)", async () => {
    vi.stubEnv("RUNTIME_DATABASE_URL", RUNTIME_URL);

    const { getDb } = await loadClient();
    const client = getDb().$client;

    try {
      expect(client.options.prepare).toBe(false);
    } finally {
      await client.end();
    }
  });

  it("reutiliza la misma instancia", async () => {
    vi.stubEnv("RUNTIME_DATABASE_URL", RUNTIME_URL);

    const { getDb } = await loadClient();
    const db = getDb();

    try {
      expect(getDb()).toBe(db);
    } finally {
      await db.$client.end();
    }
  });

  it("no cae en MIGRATION_DATABASE_URL si falta la de runtime", async () => {
    vi.stubEnv("MIGRATION_DATABASE_URL", MIGRATION_URL);

    const { getDb } = await loadClient();

    expect(() => getDb()).toThrow("RUNTIME_DATABASE_URL is required.");
  });

  it("rechaza la credencial de migración usada como credencial de runtime", async () => {
    vi.stubEnv("RUNTIME_DATABASE_URL", MIGRATION_URL);

    const { getDb } = await loadClient();

    expect(() => getDb()).toThrow(/must connect as app_runtime/);
  });
});
