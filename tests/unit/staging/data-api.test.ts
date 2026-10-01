import { afterEach, describe, expect, it, vi } from "vitest";

import {
  exposesPoranduData,
  probeDataApi,
  responseCategory,
} from "../../../scripts/staging/verify.mts";

/*
 * Sonda de la Data API (ADR-001 §3.3 y §3.4, DEC-022). El contrato no es un
 * status concreto: ninguna respuesta exitosa puede exponer tablas, datos o
 * schema de Porandú, con la publishable key ni con el token de un usuario
 * sintético. Respuestas simuladas; solo se registran status y categoría.
 */

const URL = "https://abcdefghijklmnopqrst.supabase.co";
const KEY = "sb_publishable_test";

function respond(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("probeDataApi", () => {
  it.each([
    [503, { code: "PGRST002", message: "Could not query the database" }],
    [404, { code: "PGRST205" }],
    [401, { message: "Invalid API key" }],
    [403, { message: "permission denied" }],
    [400, { code: "PGRST106" }],
    [502, "Bad gateway"],
  ])(
    "API deshabilitada, no disponible o no autorizada (%i): pasa",
    async (status, body) => {
      vi.stubGlobal(
        "fetch",
        vi.fn(async () => respond(status, body)),
      );
      for (const token of [undefined, "synthetic.user.token"]) {
        const results = await probeDataApi(URL, KEY, token);
        expect(results.map((r) => r.ok)).toEqual([true, true]);
      }
    },
  );

  it("consulta REST y GraphQL de cada tabla (H0 y H1.1), con la key y el token", async () => {
    const fetch = vi.fn(async () => respond(503, {}));
    vi.stubGlobal("fetch", fetch);
    const [rest, graphql] = await probeDataApi(
      URL,
      KEY,
      "synthetic.user.token",
    );
    expect(rest?.check).toBe("data-api.rest (authenticated)");
    expect(graphql?.check).toBe("data-api.graphql (authenticated)");

    const calls = fetch.mock.calls as unknown as [string, RequestInit][];
    expect(calls.map(([url]) => url)).toEqual(
      expect.arrayContaining([
        `${URL}/rest/v1/`,
        `${URL}/rest/v1/organizations?select=*&limit=1`,
        `${URL}/rest/v1/profiles?select=*&limit=1`,
        `${URL}/rest/v1/memberships?select=*&limit=1`,
        `${URL}/rest/v1/contacts?select=*&limit=1`,
        `${URL}/rest/v1/opportunities?select=*&limit=1`,
        `${URL}/graphql/v1`,
      ]),
    );
    for (const [, init] of calls) {
      expect(init.headers).toMatchObject({
        apikey: KEY,
        Authorization: "Bearer synthetic.user.token",
      });
    }
  });

  it("registra solo status y categoría, nunca el cuerpo", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => respond(503, { message: "internal-detail-xyz" })),
    );
    const [rest] = await probeDataApi(URL, KEY);
    expect(rest?.detail).toContain("organizations: 503 unavailable");
    expect(rest?.detail).not.toContain("internal-detail-xyz");
  });

  it("falla si una tabla de la app responde con éxito, aunque sea vacía", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) =>
        url.includes("/rest/v1/profiles") ? respond(200, []) : respond(503, {}),
      ),
    );
    const [rest, graphql] = await probeDataApi(URL, KEY);
    expect(rest).toMatchObject({ ok: false });
    expect(rest?.detail).toContain(
      "profiles: 200 success (EXPOSES PORANDÚ DATA)",
    );
    expect(graphql).toMatchObject({ ok: true });
  });

  it("falla si GraphQL devuelve una colección de la app", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) =>
        url.endsWith("/graphql/v1") &&
        String(init?.body).includes("membershipsCollection")
          ? respond(200, { data: { membershipsCollection: { edges: [] } } })
          : respond(404, {}),
      ),
    );
    const [rest, graphql] = await probeDataApi(
      URL,
      KEY,
      "synthetic.user.token",
    );
    expect(rest).toMatchObject({ ok: true });
    expect(graphql).toMatchObject({ ok: false });
  });
});

describe("exposesPoranduData", () => {
  it("una respuesta no exitosa nunca expone, diga lo que diga el cuerpo", () => {
    for (const status of [301, 400, 401, 403, 404, 500, 503]) {
      expect(exposesPoranduData("rest-table", status, "[{}]")).toBe(false);
      expect(exposesPoranduData("rest-root", status, "organizations")).toBe(
        false,
      );
    }
  });

  it("REST raíz: expone solo si el schema menciona una tabla de la app", () => {
    expect(exposesPoranduData("rest-root", 200, '{"paths":{"/":{}}}')).toBe(
      false,
    );
    expect(
      exposesPoranduData("rest-root", 200, '{"paths":{"/organizations":{}}}'),
    ).toBe(true);
  });

  it("GraphQL: errores sin datos no exponen; una colección o un tipo de la app sí", () => {
    const error = JSON.stringify({
      data: null,
      errors: [{ message: "Unknown field organizationsCollection" }],
    });
    expect(
      exposesPoranduData("graphql-collection", 200, error, "organizations"),
    ).toBe(false);
    expect(
      exposesPoranduData(
        "graphql-collection",
        200,
        JSON.stringify({ data: { organizationsCollection: { edges: [] } } }),
        "organizations",
      ),
    ).toBe(true);
    const schema = (names: string[]) =>
      JSON.stringify({
        data: { __schema: { types: names.map((name) => ({ name })) } },
      });
    expect(
      exposesPoranduData("graphql-schema", 200, schema(["Query", "String"])),
    ).toBe(false);
    expect(
      exposesPoranduData(
        "graphql-schema",
        200,
        schema(["Query", "Organizations"]),
      ),
    ).toBe(true);
    expect(exposesPoranduData("graphql-schema", 200, "not json")).toBe(false);
  });

  it("categorías de respuesta", () => {
    expect([200, 302, 401, 403, 404, 422, 503].map(responseCategory)).toEqual([
      "success",
      "redirect",
      "unauthorized",
      "unauthorized",
      "not found",
      "rejected",
      "unavailable",
    ]);
  });
});
