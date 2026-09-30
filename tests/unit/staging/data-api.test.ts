import { afterEach, describe, expect, it, vi } from "vitest";

import { probeDataApi } from "../../../scripts/staging/verify.mts";

/*
 * Sonda de la Data API (ADR-001 §3.3 y §3.4): /rest/v1 y /graphql/v1 no
 * pueden devolver datos. Staging la tiene deshabilitada y responde
 * `503 PGRST002` (ADR-001 §5, Hallazgo 4). Respuestas simuladas.
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
  it("Data API deshabilitada (503 PGRST002): pasa, como anon y con token", async () => {
    const fetch = vi.fn(async () =>
      respond(503, {
        code: "PGRST002",
        message: "Could not query the database",
      }),
    );
    vi.stubGlobal("fetch", fetch);

    expect(await probeDataApi(URL, KEY)).toEqual([
      expect.objectContaining({ check: "data-api.rest (anon)", ok: true }),
      expect.objectContaining({ check: "data-api.graphql (anon)", ok: true }),
    ]);
    const results = await probeDataApi(URL, KEY, "user.jwt.token");
    expect(results.every((r) => r.ok)).toBe(true);
    expect(results[0]?.check).toBe("data-api.rest (authenticated)");

    const [restUrl, restInit] = fetch.mock.calls[2] as unknown as [
      string,
      RequestInit,
    ];
    expect(restUrl).toBe(`${URL}/rest/v1/organizations?select=id`);
    expect(restInit.headers).toMatchObject({
      apikey: KEY,
      Authorization: "Bearer user.jwt.token",
    });
  });

  it("falla si la Data API devuelve datos", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) =>
        url.endsWith("/graphql/v1")
          ? respond(200, { data: { organizationsCollection: { edges: [{}] } } })
          : respond(200, [{ id: "org" }]),
      ),
    );
    const results = await probeDataApi(URL, KEY, "user.jwt.token");
    expect(results.map((r) => r.ok)).toEqual([false, false]);
    expect(results[0]?.detail).toContain("HTTP 200, 1 rows");
  });

  it("falla ante una respuesta distinta de 'deshabilitada', aunque no haya datos", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => respond(404, { code: "PGRST205" })),
    );
    const [rest] = await probeDataApi(URL, KEY);
    expect(rest).toMatchObject({ ok: false });
    expect(rest?.detail).toContain("HTTP 404 PGRST205");
  });
});
