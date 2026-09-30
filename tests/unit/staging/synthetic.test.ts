import { describe, expect, it, vi } from "vitest";

import {
  isSyntheticUser,
  parseRunId,
  readSecretKey,
  syntheticAppMetadata,
  syntheticEmail,
  syntheticOrganizationName,
  wrapAuthAdmin,
} from "../../../scripts/staging/synthetic.mts";

/*
 * Marcas de los datos sintéticos del acceptance Auth → Tenant
 * (scripts/staging/synthetic.mts). El listado por SQL y la limpieza contra
 * la base están en tests/db/staging-tooling.test.ts.
 */

describe("marcas", () => {
  it("emails en un TLD reservado y organizaciones con prefijo, por corrida", () => {
    expect(syntheticEmail("gh-123-1", "ab")).toBe(
      "synthetic-ab-gh-123-1@porandu-synthetic.test",
    );
    expect(syntheticOrganizationName("gh-123-1", "A")).toBe(
      "SYNTHETIC H0 gh-123-1 · A",
    );
    expect(syntheticAppMetadata("gh-123-1")).toEqual({
      porandu_synthetic: "h0-staging-rollout",
      run_id: "gh-123-1",
    });
  });

  it.each(["", "GH-1", "a b", "x".repeat(41), "../x"])(
    "rechaza el run id %j",
    (runId) => {
      expect(() => parseRunId(runId)).toThrow(/run id/);
    },
  );

  it("un usuario es sintético solo con el dominio y la marca de app_metadata", () => {
    const marked = {
      id: "1",
      email: syntheticEmail("r1", "a"),
      app_metadata: syntheticAppMetadata("r1"),
    };
    expect(isSyntheticUser(marked)).toBe(true);
    expect(isSyntheticUser(marked, "r1")).toBe(true);
    expect(isSyntheticUser(marked, "r2")).toBe(false);
    expect(isSyntheticUser({ ...marked, app_metadata: {} })).toBe(false);
    expect(isSyntheticUser({ ...marked, app_metadata: null })).toBe(false);
    expect(isSyntheticUser({ ...marked, email: "vendedor@example.test" })).toBe(
      false,
    );
    // Un usuario puede editar user_metadata, no app_metadata.
    expect(
      isSyntheticUser({
        ...marked,
        app_metadata: { porandu_synthetic: "otro" },
      }),
    ).toBe(false);
  });
});

describe("wrapAuthAdmin (STAGING_SECRET_KEY, DEC-022)", () => {
  it("solo crea usuarios con las dos marcas sintéticas, confirmados", async () => {
    const createUser = vi.fn(async () => ({
      data: { user: { id: "u1" } },
      error: null,
    }));
    const admin = wrapAuthAdmin({ createUser, deleteUser: vi.fn() });
    expect(Object.keys(admin).sort()).toEqual(["createUser", "deleteUser"]);
    expect(
      await admin.createUser({ runId: "r1", key: "a", password: "pw" }),
    ).toEqual({ id: "u1", email: syntheticEmail("r1", "a") });
    expect(createUser).toHaveBeenCalledWith({
      email: "synthetic-a-r1@porandu-synthetic.test",
      password: "pw",
      email_confirm: true,
      app_metadata: { porandu_synthetic: "h0-staging-rollout", run_id: "r1" },
    });
  });

  it("rechaza claves o corridas inválidas antes de llamar a la API", async () => {
    const createUser = vi.fn();
    const admin = wrapAuthAdmin({ createUser, deleteUser: vi.fn() });
    await expect(
      admin.createUser({ runId: "r1", key: "../x", password: "pw" }),
    ).rejects.toThrow();
    await expect(
      admin.createUser({ runId: "R 1", key: "a", password: "pw" }),
    ).rejects.toThrow();
    expect(createUser).not.toHaveBeenCalled();
  });

  it("un error de la API nombra solo el código", async () => {
    const admin = wrapAuthAdmin({
      createUser: async () => ({
        data: { user: null },
        error: { code: "email_exists" },
      }),
      deleteUser: vi.fn(),
    });
    await expect(
      admin.createUser({ runId: "r1", key: "a", password: "pw-secret" }),
    ).rejects.toThrow("Auth Admin API: createUser failed (email_exists).");
  });
});

describe("readSecretKey", () => {
  it("solo acepta una secret key nueva de Supabase y no la incluye en el error", () => {
    expect(readSecretKey({ STAGING_SECRET_KEY: "sb_secret_abc" })).toBe(
      "sb_secret_abc",
    );
    for (const value of [
      undefined,
      "eyJhbGciOi.legacy.service_role",
      "sb_publishable_x",
    ]) {
      expect(() => readSecretKey({ STAGING_SECRET_KEY: value })).toThrow(
        /STAGING_SECRET_KEY/,
      );
    }
    expect(() =>
      readSecretKey({ STAGING_SECRET_KEY: "eyJsecret" }),
    ).not.toThrow(/eyJsecret/);
  });
});
