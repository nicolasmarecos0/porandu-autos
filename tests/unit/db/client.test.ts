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

  it("rechaza la conexión directa de Supabase antes de intentar resolverla", async () => {
    vi.stubEnv(
      "RUNTIME_DATABASE_URL",
      "postgresql://app_runtime:runtime-secret@db.testref.supabase.co:5432/postgres",
    );

    const { getDb } = await loadClient();

    expect(() => getDb()).toThrow(/direct Supabase connection/);
  });

  it("pool chico, conexiones ociosas que se cierran y timeout corto (serverless)", async () => {
    vi.stubEnv("RUNTIME_DATABASE_URL", RUNTIME_URL);

    const { getDb } = await loadClient();
    const client = getDb().$client;

    try {
      expect(client.options.max).toBe(5);
      expect(client.options.idle_timeout).toBe(20);
      expect(client.options.connect_timeout).toBe(10);
      expect(client.options.connection.application_name).toBe(
        "porandu-runtime",
      );
    } finally {
      await client.end();
    }
  });
});

describe("runtimeClientOptions: TLS", () => {
  it("exige TLS fuera de loopback si la URL no dice sslmode", async () => {
    const { runtimeClientOptions } = await loadClient();
    expect(runtimeClientOptions(RUNTIME_URL).ssl).toBe("require");
  });

  it("respeta un sslmode explícito de la URL", async () => {
    const { runtimeClientOptions } = await loadClient();
    expect(
      runtimeClientOptions(`${RUNTIME_URL}?sslmode=verify-full`),
    ).not.toHaveProperty("ssl");
  });

  it.each([
    "postgresql://app_runtime:pw@127.0.0.1:54322/postgres",
    "postgresql://app_runtime:pw@localhost:54322/postgres",
    "postgresql://app_runtime:pw@[::1]:54322/postgres",
  ])("sin TLS en loopback (%s)", async (url) => {
    const { runtimeClientOptions } = await loadClient();
    expect(runtimeClientOptions(url)).not.toHaveProperty("ssl");
  });

  it("siempre sin prepared statements con nombre", async () => {
    const { runtimeClientOptions } = await loadClient();
    expect(runtimeClientOptions(RUNTIME_URL).prepare).toBe(false);
  });
});
