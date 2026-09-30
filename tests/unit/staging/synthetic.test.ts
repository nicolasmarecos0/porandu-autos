import { describe, expect, it } from "vitest";

import {
  isSyntheticUser,
  listSyntheticUsers,
  parseRunId,
  readSecretKey,
  syntheticAppMetadata,
  syntheticEmail,
  syntheticOrganizationName,
  type AdminAuth,
  type SyntheticCandidate,
} from "../../../scripts/staging/synthetic.mts";

/*
 * Marcas de los datos sintéticos del acceptance Auth → Tenant
 * (scripts/staging/synthetic.mts). La limpieza contra la base está en
 * tests/db/staging-tooling.test.ts.
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

describe("listSyntheticUsers", () => {
  it("recorre todas las páginas de la Admin API y filtra por marca", async () => {
    const pages: SyntheticCandidate[][] = [
      Array.from({ length: 1000 }, (_, i) => ({
        id: `real-${i}`,
        email: `u${i}@example.test`,
        app_metadata: {},
      })),
      [
        {
          id: "s1",
          email: syntheticEmail("r1", "a"),
          app_metadata: syntheticAppMetadata("r1"),
        },
        {
          id: "s2",
          email: syntheticEmail("r2", "a"),
          app_metadata: syntheticAppMetadata("r2"),
        },
      ],
    ];
    const admin: AdminAuth = {
      async listUsers({ page }) {
        return { data: { users: pages[page - 1] ?? [] }, error: null };
      },
      async deleteUser() {
        throw new Error("not used");
      },
    };
    expect((await listSyntheticUsers(admin)).map((u) => u.id)).toEqual([
      "s1",
      "s2",
    ]);
    expect((await listSyntheticUsers(admin, "r2")).map((u) => u.id)).toEqual([
      "s2",
    ]);
  });

  it("falla si la Admin API falla", async () => {
    const admin: AdminAuth = {
      async listUsers() {
        return { data: null, error: new Error("401") };
      },
      async deleteUser() {
        return { error: null };
      },
    };
    await expect(listSyntheticUsers(admin)).rejects.toThrow(/listUsers failed/);
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
